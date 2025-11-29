import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/config/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  uploadTextContent,
  deleteFile,
  waitForFileProcessing,
} from '@/lib/gemini-file-api';

/**
 * ナレッジ同期APIエンドポイント
 *
 * orgLearningDocsをGemini File APIにアップロードし、
 * syncStatusとfileIdを更新します。
 */
export async function POST(request: NextRequest) {
  try {
    // 認証チェック
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: '認証が必要です' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    let userId: string;
    try {
      const decodedToken = await adminAuth().verifyIdToken(token);
      userId = decodedToken.uid;
    } catch {
      return NextResponse.json(
        { success: false, error: '無効な認証トークンです' },
        { status: 401 }
      );
    }

    // リクエストボディの検証
    const body = await request.json();
    const { orgId, forceResync = false } = body;

    if (!orgId) {
      return NextResponse.json(
        { success: false, error: 'orgId は必須です' },
        { status: 400 }
      );
    }

    console.log(`ナレッジ同期開始: orgId=${orgId}, userId=${userId}, forceResync=${forceResync}`);

    const db = adminDb();
    const startTime = Date.now();

    // 組織の確認
    const orgDoc = await db.collection('organizations').doc(orgId).get();
    if (!orgDoc.exists) {
      return NextResponse.json(
        { success: false, error: '組織が見つかりません' },
        { status: 404 }
      );
    }

    const orgData = orgDoc.data();
    if (orgData?.owner_id !== userId) {
      return NextResponse.json(
        { success: false, error: 'この組織の同期権限がありません' },
        { status: 403 }
      );
    }

    // 同期対象のドキュメントを取得
    let docsQuery = db.collection('orgLearningDocs')
      .where('orgId', '==', orgId);

    if (!forceResync) {
      // forceResyncでない場合は pending または failed のみ
      docsQuery = docsQuery.where('syncStatus', 'in', ['pending', 'failed']);
    }

    const docsSnapshot = await docsQuery.get();

    const stats = {
      totalDocs: docsSnapshot.size,
      syncedDocs: 0,
      failedDocs: 0,
      skippedDocs: 0,
    };

    const syncedDocIds: string[] = [];
    const failedDocs: Array<{ docId: string; error: string }> = [];

    // 各ドキュメントを同期
    for (const docSnapshot of docsSnapshot.docs) {
      const docId = docSnapshot.id;
      const docData = docSnapshot.data();

      try {
        // contentが空の場合はスキップ
        if (!docData.content || docData.content.trim().length === 0) {
          stats.skippedDocs++;
          continue;
        }

        // syncingステータスに更新
        await docSnapshot.ref.update({
          syncStatus: 'syncing',
        });

        // 既存のfileIdがある場合は削除を試みる
        if (docData.fileId) {
          try {
            await deleteFile(docData.fileId);
            console.log(`既存ファイル削除: ${docData.fileId}`);
          } catch (deleteError) {
            // 削除エラーは無視（既に削除済みの可能性）
            console.log(`既存ファイル削除スキップ: ${docData.fileId}`, deleteError);
          }
        }

        // Gemini File APIにアップロード
        const displayName = `[org:${orgId}] ${docData.title} (${docId})`;
        const uploadResult = await uploadTextContent(
          docData.content,
          displayName,
          docId
        );

        // ファイル処理完了を待機
        await waitForFileProcessing(uploadResult.name, 30000);

        console.log(`ファイルアップロード成功: ${uploadResult.name}`);

        // 成功ステータスに更新
        await docSnapshot.ref.update({
          syncStatus: 'synced',
          fileId: uploadResult.name,
          syncedAt: FieldValue.serverTimestamp(),
          syncError: null,
          syncRetryCount: 0,
        });

        syncedDocIds.push(docId);
        stats.syncedDocs++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`同期エラー (${docId}):`, errorMessage);
        failedDocs.push({ docId, error: errorMessage });
        stats.failedDocs++;

        // 失敗ステータスに更新
        await docSnapshot.ref.update({
          syncStatus: 'failed',
          syncError: errorMessage,
          syncRetryCount: FieldValue.increment(1),
        });
      }
    }

    const durationMs = Date.now() - startTime;

    // 同期履歴を保存
    await db.collection('org_learning_sync_history').add({
      orgId,
      executedAt: Timestamp.now(),
      executionType: 'manual',
      stats,
      durationMs,
      syncedDocIds,
      failedDocs,
    });

    console.log(`ナレッジ同期完了: ${stats.syncedDocs}件成功, ${stats.failedDocs}件失敗, ${durationMs}ms`);

    return NextResponse.json({
      success: true,
      result: {
        stats,
        durationMs,
        syncedDocIds,
        failedDocs,
      },
    });
  } catch (error) {
    console.error('ナレッジ同期エラー:', error);
    const errorMessage = error instanceof Error ? error.message : '同期に失敗しました';
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/config/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  getOrCreateStoreForOrg,
  importFileToStore,
  waitForUpload,
  deleteDocument,
} from '@/lib/gemini-file-search-store';
import { uploadTextContent, deleteFile } from '@/lib/gemini-file-api';

/**
 * ナレッジ同期APIエンドポイント
 *
 * orgLearningDocsをGemini File Search Stores APIにアップロードし、
 * syncStatusとfileIdを更新します。
 *
 * File Search Stores API を使用することで:
 * - 永続的なストレージ（48時間制限なし）
 * - 自動チャンク化とベクトル化
 * - セマンティック検索（RAG）が可能
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

    // 組織用の FileSearchStore を取得または作成
    console.log('FileSearchStore を取得/作成中...');
    const store = await getOrCreateStoreForOrg(orgId, orgData?.name);
    console.log(`FileSearchStore: ${store.name}`);

    // FileSearchStore IDをorganizationに保存
    if (!orgData?.fileSearchStoreId || orgData.fileSearchStoreId !== store.name) {
      await orgDoc.ref.update({
        fileSearchStoreId: store.name,
        fileSearchStoreUpdatedAt: FieldValue.serverTimestamp(),
      });
    }

    // 同期対象のドキュメントを取得
    // syncEnabled が true のドキュメントのみ（未設定の場合は従来互換で同期する）
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
        // syncEnabled が false の場合はスキップ
        if (docData.syncEnabled === false) {
          stats.skippedDocs++;
          continue;
        }

        // contentが空の場合はスキップ
        if (!docData.content || docData.content.trim().length === 0) {
          stats.skippedDocs++;
          continue;
        }

        // syncingステータスに更新
        await docSnapshot.ref.update({
          syncStatus: 'syncing',
        });

        // 既存のdocumentNameがある場合は削除を試みる
        if (docData.documentName) {
          try {
            await deleteDocument(docData.documentName, true);
            console.log(`既存ドキュメント削除: ${docData.documentName}`);
          } catch (deleteError) {
            // 削除エラーは無視（既に削除済みの可能性）
            console.log(`既存ドキュメント削除スキップ: ${docData.documentName}`, deleteError);
          }
        }

        // Step 1: File API にアップロード
        const displayName = `${docData.title || 'Untitled'}`;
        const metadata = {
          docId: docId,
          orgId: orgId,
          title: docData.title || '',
          sourceType: docData.sourceType || 'manual',
        };

        console.log(`File APIにアップロード中: ${displayName}`);
        const fileApiResult = await uploadTextContent(
          docData.content,
          displayName,
          docId
        );
        console.log(`File APIアップロード完了: ${fileApiResult.name}`);

        // Step 2: File Search Store にインポート
        console.log(`FileSearchStoreにインポート中: ${fileApiResult.name} → ${store.name}`);
        const importResult = await importFileToStore(
          store.name,
          fileApiResult.name,
          metadata
        );

        // インポート完了を待機
        console.log(`インポート待機中: ${importResult.name}`);
        const completedOp = await waitForUpload(importResult.name, 60000);

        // デバッグ: Operation レスポンス全体をログ
        console.log('Operation完了レスポンス:', JSON.stringify(completedOp, null, 2));

        // Step 3: File API の一時ファイルを削除（オプション：48時間後に自動削除されるが、すぐ削除してもOK）
        try {
          await deleteFile(fileApiResult.name);
          console.log(`File API一時ファイル削除: ${fileApiResult.name}`);
        } catch (deleteError) {
          // 削除エラーは無視（ファイルは48時間後に自動削除される）
          console.log(`File API一時ファイル削除スキップ: ${fileApiResult.name}`, deleteError);
        }

        // importFile の場合、response内にドキュメント情報がある
        // response: { "@type": "...", "name": "fileSearchStores/xxx/documents/yyy", ... }
        const documentName = completedOp.response?.name ||
                            (completedOp as unknown as { result?: { name?: string } }).result?.name;

        if (!documentName) {
          console.warn('ドキュメント名が取得できませんでした。Operation:', completedOp);
        }
        console.log(`アップロード完了: ${documentName}`);

        // 成功ステータスに更新
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: Record<string, any> = {
          syncStatus: 'synced',
          fileSearchStoreName: store.name,
          syncedAt: FieldValue.serverTimestamp(),
          syncError: null,
          syncRetryCount: 0,
        };

        // documentNameが取得できた場合のみ保存
        if (documentName) {
          updateData.documentName = documentName;
          updateData.fileId = documentName; // 互換性のため
        }

        await docSnapshot.ref.update(updateData);

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
      fileSearchStoreName: store.name,
    });

    console.log(`ナレッジ同期完了: ${stats.syncedDocs}件成功, ${stats.failedDocs}件失敗, ${durationMs}ms`);

    return NextResponse.json({
      success: true,
      result: {
        stats,
        durationMs,
        syncedDocIds,
        failedDocs,
        fileSearchStoreName: store.name,
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

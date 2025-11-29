import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/config/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

/**
 * ナレッジ同期APIエンドポイント
 *
 * orgLearningDocsのsyncStatusを更新し、同期履歴を記録します。
 * 実際のGemini File Search同期は将来実装予定です。
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

    // 各ドキュメントを同期（現在はステータス更新のみ）
    const batch = db.batch();

    for (const docSnapshot of docsSnapshot.docs) {
      const docId = docSnapshot.id;
      const docData = docSnapshot.data();

      try {
        // contentが空の場合はスキップ
        if (!docData.content || docData.content.trim().length === 0) {
          stats.skippedDocs++;
          continue;
        }

        // 同期ステータスを更新
        // 注: 実際のGemini File Search APIへの同期は将来実装
        batch.update(docSnapshot.ref, {
          syncStatus: 'synced',
          syncedAt: FieldValue.serverTimestamp(),
          syncError: null,
          syncRetryCount: 0,
        });

        syncedDocIds.push(docId);
        stats.syncedDocs++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        failedDocs.push({ docId, error: errorMessage });
        stats.failedDocs++;

        // 失敗ステータスを更新
        batch.update(docSnapshot.ref, {
          syncStatus: 'failed',
          syncError: errorMessage,
          syncRetryCount: FieldValue.increment(1),
        });
      }
    }

    // バッチ更新を実行
    await batch.commit();

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

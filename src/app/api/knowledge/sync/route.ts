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
import { createRequestLogger, generateRequestId } from '@/lib/logger';
import { AuthError, ValidationError, ForbiddenError, NotFoundError, SyncError, logError, toErrorResponse } from '@/lib/errors';
import { alertManager } from '@/lib/alerts';

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
  const requestId = generateRequestId();
  const log = createRequestLogger({ requestId, category: 'sync' });

  try {
    // 認証チェック
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthError('認証が必要です');
    }

    const token = authHeader.substring(7);
    let userId: string;
    try {
      const decodedToken = await adminAuth().verifyIdToken(token);
      userId = decodedToken.uid;
    } catch {
      throw new AuthError('無効な認証トークンです');
    }

    log.setDefaultContext({ userId });

    // リクエストボディの検証
    const body = await request.json();
    const { orgId, forceResync = false } = body;

    if (!orgId) {
      throw new ValidationError('orgId は必須です', 'orgId');
    }

    log.setDefaultContext({ userId, orgId });
    log.info('ナレッジ同期開始', { forceResync });

    const db = adminDb();
    const startTime = Date.now();

    // 組織の確認
    const orgDoc = await db.collection('organizations').doc(orgId).get();
    if (!orgDoc.exists) {
      throw new NotFoundError('組織', orgId);
    }

    const orgData = orgDoc.data();
    if (orgData?.owner_id !== userId) {
      throw new ForbiddenError('この組織の同期権限がありません');
    }

    // 監査ログ: 同期操作の開始
    log.audit('knowledge_sync_started', { orgId, userId, forceResync });

    // 組織用の FileSearchStore を取得または作成
    log.debug('FileSearchStore を取得/作成中...');
    const store = await getOrCreateStoreForOrg(orgId, orgData?.name);
    log.debug('FileSearchStore 取得完了', { storeName: store.name });

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
            log.debug('既存ドキュメント削除', { documentName: docData.documentName });
          } catch (deleteError) {
            // 削除エラーは無視（既に削除済みの可能性）
            log.debug('既存ドキュメント削除スキップ', { documentName: docData.documentName, error: deleteError });
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

        log.debug('File APIにアップロード中', { displayName, docId });
        const fileApiResult = await uploadTextContent(
          docData.content,
          displayName,
          docId
        );
        log.debug('File APIアップロード完了', { fileName: fileApiResult.name });

        // Step 2: File Search Store にインポート
        log.debug('FileSearchStoreにインポート中', { fileName: fileApiResult.name, storeName: store.name });
        const importResult = await importFileToStore(
          store.name,
          fileApiResult.name,
          metadata
        );

        // インポート完了を待機
        log.debug('インポート待機中', { operationName: importResult.name });
        const completedOp = await waitForUpload(importResult.name, 60000);

        // デバッグ: Operation レスポンス全体をログ
        log.debug('Operation完了レスポンス', { response: completedOp });

        // Step 3: File API の一時ファイルを削除（オプション：48時間後に自動削除されるが、すぐ削除してもOK）
        try {
          await deleteFile(fileApiResult.name);
          log.debug('File API一時ファイル削除', { fileName: fileApiResult.name });
        } catch (deleteError) {
          // 削除エラーは無視（ファイルは48時間後に自動削除される）
          log.debug('File API一時ファイル削除スキップ', { fileName: fileApiResult.name, error: deleteError });
        }

        // importFile の場合、responseにdocumentNameがある
        // response: { "@type": "...", "parent": "xxx", "documentName": "yyy" }
        // フルパスは fileSearchStores/{parent}/documents/{documentName}
        const responseData = completedOp.response as { parent?: string; documentName?: string; name?: string } | undefined;
        let documentName = responseData?.name; // 旧形式対応

        if (!documentName && responseData?.parent && responseData?.documentName) {
          documentName = `fileSearchStores/${responseData.parent}/documents/${responseData.documentName}`;
        }

        log.info('アップロード完了', { docId, documentName });

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
        const retryCount = (docData.syncRetryCount || 0) + 1;
        log.error(`同期エラー`, error as Error, { docId, retryCount });
        failedDocs.push({ docId, error: errorMessage });
        stats.failedDocs++;

        // 失敗ステータスに更新
        await docSnapshot.ref.update({
          syncStatus: 'failed',
          syncError: errorMessage,
          syncRetryCount: FieldValue.increment(1),
        });

        // アラート送信（リトライ回数が多い場合）
        if (retryCount >= 2) {
          await alertManager.syncFailed(orgId, docId, error as Error, retryCount);
        }
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
      requestId,
    });

    // 監査ログ: 同期完了
    log.audit('knowledge_sync_completed', {
      orgId,
      userId,
      stats,
      durationMs,
    });

    log.info('ナレッジ同期完了', {
      syncedDocs: stats.syncedDocs,
      failedDocs: stats.failedDocs,
      durationMs,
    });

    return NextResponse.json({
      success: true,
      result: {
        stats,
        durationMs,
        syncedDocIds,
        failedDocs,
        fileSearchStoreName: store.name,
        requestId,
      },
    });
  } catch (error) {
    // エラーログと正規化
    const appError = logError(error, { category: 'sync' });

    // AuthError, ValidationError, NotFoundError, ForbiddenError の場合は適切なステータスコードを返す
    return NextResponse.json(
      toErrorResponse(appError),
      { status: appError.statusCode }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/config/firebase-admin';
import {
  getFileSearchStore,
  listDocuments,
  getDocument,
  deleteDocument,
  FileSearchDocument,
} from '@/lib/gemini-file-search-store';

/**
 * File Search Store のドキュメント一覧を取得
 * GET /api/knowledge/files?orgId=xxx
 */
export async function GET(request: NextRequest) {
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

    // クエリパラメータ
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('orgId');

    if (!orgId) {
      return NextResponse.json(
        { success: false, error: 'orgId は必須です' },
        { status: 400 }
      );
    }

    // 組織の確認
    const db = adminDb();
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
        { success: false, error: 'この組織のファイル一覧を取得する権限がありません' },
        { status: 403 }
      );
    }

    // FileSearchStore情報
    const fileSearchStoreId = orgData?.fileSearchStoreId;
    let storeInfo = null;

    if (fileSearchStoreId) {
      try {
        storeInfo = await getFileSearchStore(fileSearchStoreId);
      } catch (error) {
        console.log('Store取得エラー:', error);
        // Storeが存在しない場合は無視
      }
    }

    // ドキュメント一覧を取得
    const allDocuments: FileSearchDocument[] = [];

    if (fileSearchStoreId) {
      try {
        let pageToken: string | undefined;

        do {
          const result = await listDocuments(fileSearchStoreId, 100, pageToken);
          allDocuments.push(...result.documents);
          pageToken = result.nextPageToken;
        } while (pageToken);
      } catch (error) {
        console.log('ドキュメント一覧取得エラー:', error);
        // エラーの場合は空配列
      }
    }

    // Firestoreのナレッジドキュメントと紐付け情報を取得
    const docsSnapshot = await db.collection('orgLearningDocs')
      .where('orgId', '==', orgId)
      .get();

    const docMap = new Map<string, { docId: string; title: string; syncStatus: string; syncEnabled: boolean }>();
    docsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.documentName || data.fileId) {
        const key = data.documentName || data.fileId;
        docMap.set(key, {
          docId: doc.id,
          title: data.title,
          syncStatus: data.syncStatus,
          syncEnabled: data.syncEnabled !== false, // デフォルトはtrue
        });
      }
    });

    // ドキュメント情報にFirestoreの情報を追加
    const documentsWithDocInfo = allDocuments.map(doc => {
      // カスタムメタデータからdocIdを取得
      const docIdMeta = doc.customMetadata?.find(m => m.key === 'docId');
      const linkedDocId = docIdMeta?.stringValue;

      return {
        name: doc.name,
        displayName: doc.displayName,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        createTime: doc.createTime,
        updateTime: doc.updateTime,
        state: doc.state,
        customMetadata: doc.customMetadata,
        linkedDoc: docMap.get(doc.name) || (linkedDocId ? docMap.get(linkedDocId) : null) || null,
      };
    });

    return NextResponse.json({
      success: true,
      store: storeInfo ? {
        name: storeInfo.name,
        displayName: storeInfo.displayName,
        activeDocumentsCount: storeInfo.activeDocumentsCount,
        pendingDocumentsCount: storeInfo.pendingDocumentsCount,
        failedDocumentsCount: storeInfo.failedDocumentsCount,
        sizeBytes: storeInfo.sizeBytes,
        createTime: storeInfo.createTime,
        updateTime: storeInfo.updateTime,
      } : null,
      documents: documentsWithDocInfo,
      totalCount: documentsWithDocInfo.length,
    });
  } catch (error) {
    console.error('ファイル一覧取得エラー:', error);
    const errorMessage = error instanceof Error ? error.message : 'ファイル一覧の取得に失敗しました';
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * File Search Store のドキュメントを削除
 * DELETE /api/knowledge/files?documentName=xxx
 */
export async function DELETE(request: NextRequest) {
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
    try {
      await adminAuth().verifyIdToken(token);
    } catch {
      return NextResponse.json(
        { success: false, error: '無効な認証トークンです' },
        { status: 401 }
      );
    }

    // クエリパラメータ
    const { searchParams } = new URL(request.url);
    const documentName = searchParams.get('documentName') || searchParams.get('fileName');

    if (!documentName) {
      return NextResponse.json(
        { success: false, error: 'documentName は必須です' },
        { status: 400 }
      );
    }

    // ドキュメント情報を取得して確認
    let docInfo;
    try {
      docInfo = await getDocument(documentName);
      console.log(`ドキュメント削除: ${documentName} (${docInfo.displayName})`);
    } catch (error) {
      console.log('ドキュメント情報取得エラー:', error);
    }

    // ドキュメントを削除
    await deleteDocument(documentName, true);

    // Firestoreのドキュメントも更新（documentName/fileIdをクリア）
    const db = adminDb();

    // documentNameで検索
    let docsSnapshot = await db.collection('orgLearningDocs')
      .where('documentName', '==', documentName)
      .get();

    // 見つからない場合はfileIdでも検索（互換性）
    if (docsSnapshot.empty) {
      docsSnapshot = await db.collection('orgLearningDocs')
        .where('fileId', '==', documentName)
        .get();
    }

    if (!docsSnapshot.empty) {
      const batch = db.batch();
      docsSnapshot.docs.forEach(doc => {
        batch.update(doc.ref, {
          documentName: null,
          fileId: null,
          syncStatus: 'pending',
        });
      });
      await batch.commit();
    }

    return NextResponse.json({
      success: true,
      message: 'ドキュメントを削除しました',
    });
  } catch (error) {
    console.error('ドキュメント削除エラー:', error);
    const errorMessage = error instanceof Error ? error.message : 'ドキュメント削除に失敗しました';
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

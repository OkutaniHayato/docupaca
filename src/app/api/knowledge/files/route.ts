import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/config/firebase-admin';
import { listFiles, getFile, deleteFile } from '@/lib/gemini-file-api';

/**
 * Gemini File API のファイル一覧を取得
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

    // Gemini File APIからファイル一覧を取得
    const allFiles: Array<{
      name: string;
      displayName: string;
      mimeType: string;
      sizeBytes: string;
      createTime: string;
      expirationTime: string;
      state: string;
      uri: string;
    }> = [];

    let pageToken: string | undefined;

    do {
      const result = await listFiles(100, pageToken);

      // この組織に関連するファイルのみフィルタ
      const orgFiles = result.files.filter(file =>
        file.displayName?.includes(`[org:${orgId}]`)
      );

      allFiles.push(...orgFiles.map(file => ({
        name: file.name,
        displayName: file.displayName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        createTime: file.createTime,
        expirationTime: file.expirationTime,
        state: file.state,
        uri: file.uri,
      })));

      pageToken = result.nextPageToken;
    } while (pageToken);

    // Firestoreのナレッジドキュメントと紐付け情報を取得
    const docsSnapshot = await db.collection('orgLearningDocs')
      .where('orgId', '==', orgId)
      .get();

    const docMap = new Map<string, { docId: string; title: string; syncStatus: string }>();
    docsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.fileId) {
        docMap.set(data.fileId, {
          docId: doc.id,
          title: data.title,
          syncStatus: data.syncStatus,
        });
      }
    });

    // ファイル情報にFirestoreの情報を追加
    const filesWithDocInfo = allFiles.map(file => ({
      ...file,
      linkedDoc: docMap.get(file.name) || null,
    }));

    return NextResponse.json({
      success: true,
      files: filesWithDocInfo,
      totalCount: filesWithDocInfo.length,
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
 * Gemini File API のファイルを削除
 * DELETE /api/knowledge/files?fileName=xxx
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
    const fileName = searchParams.get('fileName');

    if (!fileName) {
      return NextResponse.json(
        { success: false, error: 'fileName は必須です' },
        { status: 400 }
      );
    }

    // ファイル情報を取得して確認
    const fileInfo = await getFile(fileName);
    console.log(`ファイル削除: ${fileName} (${fileInfo.displayName})`);

    // ファイルを削除
    await deleteFile(fileName);

    // Firestoreのドキュメントも更新（fileIdをクリア）
    const db = adminDb();
    const docsSnapshot = await db.collection('orgLearningDocs')
      .where('fileId', '==', fileName)
      .get();

    if (!docsSnapshot.empty) {
      const batch = db.batch();
      docsSnapshot.docs.forEach(doc => {
        batch.update(doc.ref, {
          fileId: null,
          syncStatus: 'pending',
        });
      });
      await batch.commit();
    }

    return NextResponse.json({
      success: true,
      message: 'ファイルを削除しました',
    });
  } catch (error) {
    console.error('ファイル削除エラー:', error);
    const errorMessage = error instanceof Error ? error.message : 'ファイル削除に失敗しました';
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

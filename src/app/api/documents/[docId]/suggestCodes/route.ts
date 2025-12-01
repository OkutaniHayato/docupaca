/**
 * POST /api/documents/[docId]/suggestCodes
 *
 * RAGを使ったコード提案APIエンドポイント
 * 帳票から顧客コード、品目コード、勘定科目コード、税区分、部門コードを提案する
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/config/firebase-admin';
import { DocumentCodeSuggestions, CodeSuggestion, LineCodeSuggestion } from '@/types/ocr';

const CLOUD_FUNCTIONS_BASE_URL = process.env.CLOUD_FUNCTIONS_BASE_URL || 'https://asia-northeast1-docupaca.cloudfunctions.net';

/**
 * useRag=falseの場合の空のコード提案を生成
 */
function createEmptySuggestion(): CodeSuggestion {
  return {
    code: '',
    confidence: 0,
    reason: 'RAGを使用しないため提案なし',
  };
}

/**
 * useRag=falseの場合、明細行数に基づいて空の提案を生成
 */
function createEmptyLineSuggestions(lineCount: number): LineCodeSuggestion[] {
  return Array.from({ length: lineCount }, (_, index) => ({
    index,
    itemCode: createEmptySuggestion(),
    accountCode: createEmptySuggestion(),
    taxCategory: createEmptySuggestion(),
    departmentCode: createEmptySuggestion(),
  }));
}

/**
 * humanResultから明細行数を推測
 */
function countLinesFromData(data: Record<string, unknown>): number {
  // 配列フィールドを探して行数をカウント
  for (const [, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      return value.length;
    }
    if (value && typeof value === 'object' && 'items' in value) {
      const items = (value as { items: unknown[] }).items;
      if (Array.isArray(items)) {
        return items.length;
      }
    }
  }
  return 0;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  try {
    const { docId } = await params;

    // 1. 認証チェック
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Authorization header missing or invalid' },
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
        { success: false, error: 'Invalid authentication token' },
        { status: 401 }
      );
    }

    // 2. リクエストボディを取得
    const body = await request.json();
    const { useRag = true } = body as { useRag?: boolean };

    // 3. ドキュメントを取得して権限チェック
    const docRef = adminDb().collection('ocr_history').doc(docId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return NextResponse.json(
        { success: false, error: 'Document not found' },
        { status: 404 }
      );
    }

    const docData = docSnap.data() as {
      setting_id?: string;
      extracted_data?: Record<string, unknown>;
      humanConfirmedData?: Record<string, unknown>;
    };

    // 4. OCR設定から組織を取得して権限チェック
    if (!docData.setting_id) {
      return NextResponse.json(
        { success: false, error: 'Document has no setting_id' },
        { status: 400 }
      );
    }

    const settingDoc = await adminDb().collection('ocr_settings').doc(docData.setting_id).get();
    if (!settingDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'OCR setting not found' },
        { status: 404 }
      );
    }

    const settingData = settingDoc.data() as {
      owner_id: string;
      organization_id?: string;
    };

    // 権限チェック: 設定の所有者かどうか
    if (settingData.owner_id !== userId) {
      return NextResponse.json(
        { success: false, error: 'Permission denied' },
        { status: 403 }
      );
    }

    // 5. 組織の設定を確認（Feature toggle）
    const orgId = settingData.organization_id;
    if (orgId) {
      const orgDoc = await adminDb().collection('organizations').doc(orgId).get();
      if (orgDoc.exists) {
        const orgData = orgDoc.data() as { ragCodeSuggestionEnabled?: boolean };
        // RAG機能が無効の場合
        if (orgData.ragCodeSuggestionEnabled === false) {
          return NextResponse.json(
            { success: false, error: 'RAG code suggestion is disabled for this organization' },
            { status: 403 }
          );
        }
      }
    }

    // 6. コード提案を実行
    let suggestions: DocumentCodeSuggestions;

    if (useRag) {
      // RAGを使用する場合: Cloud Functionsを呼び出す
      const response = await fetch(`${CLOUD_FUNCTIONS_BASE_URL}/suggestCodesHttp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ docId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return NextResponse.json(
          { success: false, error: errorData.error || 'Failed to call code suggestion service' },
          { status: response.status }
        );
      }

      const result = await response.json();
      suggestions = result.suggestions;
    } else {
      // RAGを使用しない場合: 空の提案を返す
      const humanResult = docData.humanConfirmedData || docData.extracted_data || {};
      const lineCount = countLinesFromData(humanResult);

      suggestions = {
        customerCode: createEmptySuggestion(),
        lines: createEmptyLineSuggestions(lineCount),
      };

      // Firestoreに保存
      await docRef.update({
        codeSuggestions: suggestions,
        codeSuggestedAt: new Date(),
      });
    }

    // 7. 成功レスポンス
    return NextResponse.json({
      success: true,
      suggestions,
      useRag,
    });

  } catch (error) {
    console.error('Error in suggestCodes API:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

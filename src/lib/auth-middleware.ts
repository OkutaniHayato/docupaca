/**
 * API認可ミドルウェア
 *
 * APIルートでの認証・認可チェックを統一的に行うためのユーティリティ
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/config/firebase-admin';
import { AuthError, ForbiddenError, NotFoundError } from './errors';
import { logger, LogContext } from './logger';

// =====================================================
// 型定義
// =====================================================

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  emailVerified?: boolean;
}

export interface AuthContext {
  user: AuthenticatedUser;
  orgId?: string;
  isOrgOwner?: boolean;
}

export interface AuthOptions {
  /** 組織IDを必須とするか */
  requireOrgId?: boolean;
  /** 組織オーナーチェックを行うか */
  checkOrgOwnership?: boolean;
  /** orgIdをどこから取得するか（デフォルト: body） */
  orgIdSource?: 'body' | 'query' | 'params';
  /** orgIdのパラメータ名（デフォルト: orgId） */
  orgIdParam?: string;
}

// =====================================================
// 認証・認可関数
// =====================================================

/**
 * リクエストからBearerトークンを抽出
 */
export function extractBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

/**
 * Firebase ID トークンを検証してユーザー情報を取得
 */
export async function verifyIdToken(token: string): Promise<AuthenticatedUser> {
  try {
    const decodedToken = await adminAuth().verifyIdToken(token);
    return {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
    };
  } catch (error) {
    logger.warn('Token verification failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      category: 'auth',
    });
    throw new AuthError('無効な認証トークンです');
  }
}

/**
 * ユーザーが組織のオーナーかどうかを確認
 */
export async function checkOrgOwnership(
  userId: string,
  orgId: string
): Promise<{ isOwner: boolean; orgData: FirebaseFirestore.DocumentData | null }> {
  const db = adminDb();
  const orgDoc = await db.collection('organizations').doc(orgId).get();

  if (!orgDoc.exists) {
    throw new NotFoundError('組織', orgId);
  }

  const orgData = orgDoc.data();
  const isOwner = orgData?.owner_id === userId;

  return { isOwner, orgData: orgData || null };
}

/**
 * リクエストを認証・認可する
 *
 * @example
 * ```ts
 * const auth = await authenticateRequest(request, { requireOrgId: true, checkOrgOwnership: true });
 * // auth.user.uid でユーザーIDを取得
 * // auth.orgId で組織IDを取得
 * // auth.isOrgOwner でオーナーかどうかを確認
 * ```
 */
export async function authenticateRequest(
  request: NextRequest,
  options: AuthOptions = {}
): Promise<AuthContext> {
  const {
    requireOrgId = false,
    checkOrgOwnership: checkOwnership = false,
    orgIdSource = 'body',
    orgIdParam = 'orgId',
  } = options;

  // 1. トークン抽出
  const token = extractBearerToken(request);
  if (!token) {
    throw new AuthError('認証が必要です');
  }

  // 2. トークン検証
  const user = await verifyIdToken(token);

  // 3. orgId取得（必要な場合）
  let orgId: string | undefined;

  if (requireOrgId || checkOwnership) {
    if (orgIdSource === 'body') {
      try {
        const body = await request.clone().json();
        orgId = body[orgIdParam];
      } catch {
        // JSONパースエラーは無視
      }
    } else if (orgIdSource === 'query') {
      orgId = request.nextUrl.searchParams.get(orgIdParam) || undefined;
    }

    if (requireOrgId && !orgId) {
      throw new AuthError(`${orgIdParam} は必須です`);
    }
  }

  // 4. 組織オーナーチェック（必要な場合）
  let isOrgOwner = false;
  if (checkOwnership && orgId) {
    const { isOwner } = await checkOrgOwnership(user.uid, orgId);
    if (!isOwner) {
      logger.warn('Organization access denied', {
        userId: user.uid,
        orgId,
        category: 'auth',
      });
      throw new ForbiddenError('この組織へのアクセス権限がありません');
    }
    isOrgOwner = true;
  }

  return {
    user,
    orgId,
    isOrgOwner,
  };
}

/**
 * OCR設定のオーナーチェック
 */
export async function checkOcrSettingOwnership(
  userId: string,
  settingId: string
): Promise<{ isOwner: boolean; settingData: FirebaseFirestore.DocumentData | null; orgId?: string }> {
  const db = adminDb();
  const settingDoc = await db.collection('ocr_settings').doc(settingId).get();

  if (!settingDoc.exists) {
    throw new NotFoundError('OCR設定', settingId);
  }

  const settingData = settingDoc.data();
  const isOwner = settingData?.owner_id === userId;

  return {
    isOwner,
    settingData: settingData || null,
    orgId: settingData?.organization_id,
  };
}

/**
 * OCRドキュメント（履歴）へのアクセス権限チェック
 */
export async function checkOcrHistoryAccess(
  userId: string,
  historyId: string
): Promise<{ hasAccess: boolean; historyData: FirebaseFirestore.DocumentData | null; settingId?: string }> {
  const db = adminDb();
  const historyDoc = await db.collection('ocr_history').doc(historyId).get();

  if (!historyDoc.exists) {
    throw new NotFoundError('OCR履歴', historyId);
  }

  const historyData = historyDoc.data();
  const settingId = historyData?.setting_id;

  if (!settingId) {
    return { hasAccess: false, historyData: historyData || null };
  }

  const { isOwner } = await checkOcrSettingOwnership(userId, settingId);

  return {
    hasAccess: isOwner,
    historyData: historyData || null,
    settingId,
  };
}

// =====================================================
// レスポンスヘルパー
// =====================================================

/**
 * 認証エラーレスポンスを返す
 */
export function unauthorizedResponse(message: string = '認証が必要です'): NextResponse {
  return NextResponse.json(
    { success: false, error: message, code: 'AUTH_REQUIRED' },
    { status: 401 }
  );
}

/**
 * 認可エラーレスポンスを返す
 */
export function forbiddenResponse(message: string = 'アクセス権限がありません'): NextResponse {
  return NextResponse.json(
    { success: false, error: message, code: 'AUTH_PERMISSION_DENIED' },
    { status: 403 }
  );
}

/**
 * リソース未発見レスポンスを返す
 */
export function notFoundResponse(resource: string, id?: string): NextResponse {
  const message = id ? `${resource} (${id}) が見つかりません` : `${resource} が見つかりません`;
  return NextResponse.json(
    { success: false, error: message, code: 'RESOURCE_NOT_FOUND' },
    { status: 404 }
  );
}

// =====================================================
// 監査ログヘルパー
// =====================================================

/**
 * API操作の監査ログを記録
 */
export async function logApiAccess(
  action: string,
  context: LogContext & {
    userId: string;
    method: string;
    path: string;
    statusCode?: number;
  }
): Promise<void> {
  logger.audit(action, {
    ...context,
    category: 'api',
  });

  // 重要な操作はFirestoreにも記録（将来の監査機能用）
  if (context.orgId && ['create', 'update', 'delete', 'sync'].some(op => action.includes(op))) {
    try {
      const db = adminDb();
      await db.collection('audit_logs').add({
        action,
        ...context,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error('Failed to save audit log', error as Error, { action });
    }
  }
}

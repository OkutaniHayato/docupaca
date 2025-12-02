/**
 * カスタムエラー型とエラーハンドリングユーティリティ
 *
 * アプリケーション全体で使用するエラー分類と処理
 */

import { logger, LogContext } from './logger';

// =====================================================
// エラーコード定義
// =====================================================

export const ErrorCode = {
  // 認証・認可エラー (AUTH_xxx)
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_PERMISSION_DENIED: 'AUTH_PERMISSION_DENIED',
  AUTH_ORG_ACCESS_DENIED: 'AUTH_ORG_ACCESS_DENIED',

  // バリデーションエラー (VALIDATION_xxx)
  VALIDATION_REQUIRED_FIELD: 'VALIDATION_REQUIRED_FIELD',
  VALIDATION_INVALID_FORMAT: 'VALIDATION_INVALID_FORMAT',
  VALIDATION_SIZE_EXCEEDED: 'VALIDATION_SIZE_EXCEEDED',

  // リソースエラー (RESOURCE_xxx)
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS: 'RESOURCE_ALREADY_EXISTS',
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',

  // 同期エラー (SYNC_xxx)
  SYNC_FAILED: 'SYNC_FAILED',
  SYNC_TIMEOUT: 'SYNC_TIMEOUT',
  SYNC_STORE_LIMIT_EXCEEDED: 'SYNC_STORE_LIMIT_EXCEEDED',
  SYNC_FILE_TOO_LARGE: 'SYNC_FILE_TOO_LARGE',

  // API/外部サービスエラー (EXTERNAL_xxx)
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
  EXTERNAL_RATE_LIMIT: 'EXTERNAL_RATE_LIMIT',
  EXTERNAL_TIMEOUT: 'EXTERNAL_TIMEOUT',
  EXTERNAL_UNAVAILABLE: 'EXTERNAL_UNAVAILABLE',

  // 内部エラー (INTERNAL_xxx)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INTERNAL_CONFIG_ERROR: 'INTERNAL_CONFIG_ERROR',
} as const;

export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode];

// =====================================================
// カスタムエラークラス
// =====================================================

/**
 * アプリケーション基底エラー
 */
export class AppError extends Error {
  public readonly code: ErrorCodeType;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly context?: LogContext;
  public readonly originalError?: Error;

  constructor(
    message: string,
    code: ErrorCodeType,
    statusCode: number = 500,
    context?: LogContext,
    originalError?: Error
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = true; // 運用上のエラー（予期されるエラー）
    this.context = context;
    this.originalError = originalError;

    // スタックトレースをキャプチャ
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 認証エラー
 */
export class AuthError extends AppError {
  constructor(
    message: string = '認証が必要です',
    code: ErrorCodeType = ErrorCode.AUTH_REQUIRED,
    context?: LogContext
  ) {
    super(message, code, 401, context);
    this.name = 'AuthError';
  }
}

/**
 * 認可エラー（権限不足）
 */
export class ForbiddenError extends AppError {
  constructor(
    message: string = 'アクセス権限がありません',
    code: ErrorCodeType = ErrorCode.AUTH_PERMISSION_DENIED,
    context?: LogContext
  ) {
    super(message, code, 403, context);
    this.name = 'ForbiddenError';
  }
}

/**
 * リソース未発見エラー
 */
export class NotFoundError extends AppError {
  constructor(
    resource: string,
    id?: string,
    context?: LogContext
  ) {
    const message = id ? `${resource} (${id}) が見つかりません` : `${resource} が見つかりません`;
    super(message, ErrorCode.RESOURCE_NOT_FOUND, 404, context);
    this.name = 'NotFoundError';
  }
}

/**
 * バリデーションエラー
 */
export class ValidationError extends AppError {
  public readonly field?: string;
  public readonly details?: Record<string, string>;

  constructor(
    message: string,
    field?: string,
    details?: Record<string, string>,
    context?: LogContext
  ) {
    super(message, ErrorCode.VALIDATION_REQUIRED_FIELD, 400, context);
    this.name = 'ValidationError';
    this.field = field;
    this.details = details;
  }
}

/**
 * 同期エラー
 */
export class SyncError extends AppError {
  public readonly docId?: string;
  public readonly retryable: boolean;

  constructor(
    message: string,
    code: ErrorCodeType = ErrorCode.SYNC_FAILED,
    docId?: string,
    retryable: boolean = true,
    context?: LogContext,
    originalError?: Error
  ) {
    super(message, code, 500, context, originalError);
    this.name = 'SyncError';
    this.docId = docId;
    this.retryable = retryable;
  }
}

/**
 * 外部APIエラー
 */
export class ExternalApiError extends AppError {
  public readonly service: string;
  public readonly retryable: boolean;

  constructor(
    service: string,
    message: string,
    code: ErrorCodeType = ErrorCode.EXTERNAL_API_ERROR,
    retryable: boolean = false,
    context?: LogContext,
    originalError?: Error
  ) {
    super(`${service}: ${message}`, code, 502, context, originalError);
    this.name = 'ExternalApiError';
    this.service = service;
    this.retryable = retryable;
  }
}

/**
 * レート制限エラー
 */
export class RateLimitError extends AppError {
  public readonly retryAfter?: number;

  constructor(
    message: string = 'リクエスト制限に達しました',
    retryAfter?: number,
    context?: LogContext
  ) {
    super(message, ErrorCode.EXTERNAL_RATE_LIMIT, 429, context);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

// =====================================================
// エラーハンドリングユーティリティ
// =====================================================

/**
 * エラーをAppErrorに変換
 */
export function normalizeError(error: unknown, context?: LogContext): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    // Firebase Auth エラー
    if (error.message.includes('auth/')) {
      return new AuthError(
        'Firebase認証エラー',
        ErrorCode.AUTH_INVALID_TOKEN,
        context
      );
    }

    // Gemini API レート制限
    if (error.message.includes('429') || error.message.includes('rate limit')) {
      return new RateLimitError(
        'Gemini APIのレート制限に達しました',
        60,
        context
      );
    }

    // タイムアウト
    if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
      return new ExternalApiError(
        'External Service',
        'タイムアウトしました',
        ErrorCode.EXTERNAL_TIMEOUT,
        true,
        context,
        error
      );
    }

    // 一般的なエラー
    return new AppError(
      error.message,
      ErrorCode.INTERNAL_ERROR,
      500,
      context,
      error
    );
  }

  // 不明なエラー
  return new AppError(
    typeof error === 'string' ? error : 'Unknown error occurred',
    ErrorCode.INTERNAL_ERROR,
    500,
    context
  );
}

/**
 * エラーをログに記録
 */
export function logError(error: unknown, context?: LogContext): AppError {
  const appError = normalizeError(error, context);

  logger.error(
    appError.message,
    appError.originalError || appError,
    {
      ...context,
      errorCode: appError.code,
      statusCode: appError.statusCode,
    }
  );

  return appError;
}

/**
 * API レスポンス用のエラー形式に変換
 */
export function toErrorResponse(error: unknown): {
  success: false;
  error: string;
  code: string;
  details?: Record<string, unknown>;
} {
  const appError = normalizeError(error);

  const response: {
    success: false;
    error: string;
    code: string;
    details?: Record<string, unknown>;
  } = {
    success: false,
    error: appError.message,
    code: appError.code,
  };

  if (appError instanceof ValidationError && appError.details) {
    response.details = appError.details;
  }

  return response;
}

/**
 * リトライ可能なエラーかどうかを判定
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof SyncError || error instanceof ExternalApiError) {
    return error.retryable;
  }

  if (error instanceof RateLimitError) {
    return true;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('503') ||
      message.includes('429') ||
      message.includes('overloaded')
    );
  }

  return false;
}

/**
 * 指数バックオフで関数を再試行
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    onRetry?: (attempt: number, error: Error, delay: number) => void;
  } = {}
): Promise<T> {
  const {
    maxRetries = 4,
    initialDelayMs = 2000,
    maxDelayMs = 16000,
    onRetry,
  } = options;

  let lastError: Error = new Error('No attempts made');

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries || !isRetryableError(error)) {
        throw lastError;
      }

      const delay = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs);

      if (onRetry) {
        onRetry(attempt + 1, lastError, delay);
      } else {
        logger.warn(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, {
          error: lastError.message,
        });
      }

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

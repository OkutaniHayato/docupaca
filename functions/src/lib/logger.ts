/**
 * Cloud Functions用統一ロギングユーティリティ
 *
 * Firebase Functions Loggerをラップして統一インターフェースを提供
 * - 構造化ログ
 * - コンテキスト情報の自動付与
 * - Cloud Loggingとの統合
 */

import * as functions from 'firebase-functions/v2';

// =====================================================
// 型定義
// =====================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  /** 操作を行ったユーザーID */
  userId?: string;
  /** 組織ID */
  orgId?: string;
  /** リクエストID（トレース用） */
  requestId?: string;
  /** 操作対象のドキュメントID */
  docId?: string;
  /** 操作カテゴリ */
  category?: LogCategory;
  /** その他のメタデータ */
  [key: string]: unknown;
}

export type LogCategory =
  | 'auth'           // 認証関連
  | 'sync'           // 同期処理
  | 'api'            // API呼び出し
  | 'knowledge'      // ナレッジ管理
  | 'ocr'            // OCR処理
  | 'suggestion'     // コード提案
  | 'audit'          // 監査ログ
  | 'scheduled'      // 定期バッチ
  | 'system';        // システム全般

// =====================================================
// FunctionsLogger クラス
// =====================================================

class FunctionsLogger {
  private defaultContext: LogContext = {};

  /**
   * デフォルトコンテキストを設定
   */
  setDefaultContext(context: LogContext): void {
    this.defaultContext = { ...this.defaultContext, ...context };
  }

  /**
   * デフォルトコンテキストをクリア
   */
  clearDefaultContext(): void {
    this.defaultContext = {};
  }

  /**
   * コンテキストをマージ
   */
  private mergeContext(context?: LogContext): LogContext {
    return { ...this.defaultContext, ...context };
  }

  /**
   * デバッグログ
   */
  debug(message: string, context?: LogContext): void {
    functions.logger.debug(message, this.mergeContext(context));
  }

  /**
   * 情報ログ
   */
  info(message: string, context?: LogContext): void {
    functions.logger.info(message, this.mergeContext(context));
  }

  /**
   * 警告ログ
   */
  warn(message: string, context?: LogContext): void {
    functions.logger.warn(message, this.mergeContext(context));
  }

  /**
   * エラーログ
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const mergedContext = this.mergeContext(context);

    if (error instanceof Error) {
      functions.logger.error(message, {
        ...mergedContext,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      });
    } else if (error) {
      functions.logger.error(message, {
        ...mergedContext,
        errorData: error,
      });
    } else {
      functions.logger.error(message, mergedContext);
    }
  }

  /**
   * 監査ログ（重要な操作を記録）
   */
  audit(action: string, context: LogContext): void {
    functions.logger.info(`[AUDIT] ${action}`, {
      ...this.mergeContext(context),
      category: 'audit',
      auditAction: action,
    });
  }

  /**
   * 同期操作の開始ログ
   */
  syncStart(orgId: string, options?: { forceResync?: boolean; executionType?: string }): void {
    this.info('Starting org learning docs sync', {
      orgId,
      category: 'sync',
      ...options,
    });
  }

  /**
   * 同期操作の完了ログ
   */
  syncComplete(
    orgId: string,
    stats: { totalDocs: number; syncedDocs: number; failedDocs: number; skippedDocs: number },
    durationMs: number
  ): void {
    this.info('Sync completed', {
      orgId,
      category: 'sync',
      stats,
      durationMs,
    });
  }

  /**
   * 同期操作の失敗ログ
   */
  syncFailed(orgId: string, docId: string, error: Error | string, retryCount?: number): void {
    const errorMessage = error instanceof Error ? error.message : error;
    this.error(`Failed to sync document: ${docId}`, error instanceof Error ? error : undefined, {
      orgId,
      docId,
      category: 'sync',
      errorMessage,
      retryCount,
    });
  }

  /**
   * API呼び出しログ
   */
  apiCall(service: string, operation: string, context?: LogContext): void {
    this.info(`Calling ${service} API: ${operation}`, {
      ...context,
      category: 'api',
      service,
      operation,
    });
  }

  /**
   * API呼び出し完了ログ
   */
  apiComplete(service: string, operation: string, durationMs: number, context?: LogContext): void {
    this.info(`${service} API completed: ${operation}`, {
      ...context,
      category: 'api',
      service,
      operation,
      durationMs,
    });
  }

  /**
   * パフォーマンス計測用のタイマーを開始
   */
  startTimer(label: string, context?: LogContext): () => number {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.debug(`${label} completed in ${duration}ms`, {
        ...context,
        durationMs: duration,
      });
      return duration;
    };
  }

  /**
   * 定期バッチ開始ログ
   */
  scheduledJobStart(jobName: string): void {
    this.info(`Starting scheduled job: ${jobName}`, {
      category: 'scheduled',
      jobName,
    });
  }

  /**
   * 定期バッチ完了ログ
   */
  scheduledJobComplete(
    jobName: string,
    stats: { successCount: number; errorCount: number; totalOrgs?: number },
    durationMs?: number
  ): void {
    this.info(`Scheduled job completed: ${jobName}`, {
      category: 'scheduled',
      jobName,
      stats,
      durationMs,
    });
  }

  /**
   * 定期バッチ失敗ログ
   */
  scheduledJobFailed(jobName: string, error: Error): void {
    this.error(`Scheduled job failed: ${jobName}`, error, {
      category: 'scheduled',
      jobName,
    });
  }
}

// シングルトンインスタンス
export const logger = new FunctionsLogger();

// =====================================================
// ユーティリティ関数
// =====================================================

/**
 * エラーメッセージを安全に取得
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}

/**
 * エラーオブジェクトを正規化
 */
export function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(getErrorMessage(error));
}

/**
 * 統一ロギングユーティリティ
 *
 * フロントエンド・API Routes用のロギング基盤
 * - 構造化ログ
 * - ログレベル管理
 * - コンテキスト情報の自動付与
 */

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
  | 'system';        // システム全般

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  category?: LogCategory;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
}

// =====================================================
// 設定
// =====================================================

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// 環境変数で制御（デフォルトは本番ではinfo、開発ではdebug）
const getCurrentLogLevel = (): LogLevel => {
  const envLevel = process.env.LOG_LEVEL as LogLevel | undefined;
  if (envLevel && LOG_LEVEL_PRIORITY[envLevel] !== undefined) {
    return envLevel;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
};

// =====================================================
// Logger クラス
// =====================================================

class Logger {
  private defaultContext: LogContext = {};

  /**
   * デフォルトコンテキストを設定
   * リクエストスコープで使用するユーザーID、組織IDなどを設定
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
   * ログエントリを作成
   */
  private createEntry(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...this.defaultContext, ...context },
    };

    if (context?.category) {
      entry.category = context.category;
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as Error & { code?: string }).code,
      };
    }

    return entry;
  }

  /**
   * ログを出力
   */
  private log(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error
  ): void {
    const currentLevel = getCurrentLogLevel();
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[currentLevel]) {
      return;
    }

    const entry = this.createEntry(level, message, context, error);

    // 開発環境では読みやすい形式、本番では構造化JSON
    if (process.env.NODE_ENV === 'production') {
      const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      logFn(JSON.stringify(entry));
    } else {
      const prefix = `[${entry.timestamp}] [${level.toUpperCase()}]`;
      const categoryStr = entry.category ? ` [${entry.category}]` : '';
      const contextStr = Object.keys(entry.context || {}).length > 0
        ? ` ${JSON.stringify(entry.context)}`
        : '';

      if (level === 'error') {
        console.error(`${prefix}${categoryStr} ${message}${contextStr}`);
        if (error) {
          console.error(error);
        }
      } else if (level === 'warn') {
        console.warn(`${prefix}${categoryStr} ${message}${contextStr}`);
      } else {
        console.log(`${prefix}${categoryStr} ${message}${contextStr}`);
      }
    }
  }

  /**
   * デバッグログ
   */
  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  /**
   * 情報ログ
   */
  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  /**
   * 警告ログ
   */
  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  /**
   * エラーログ
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const err = error instanceof Error ? error : undefined;
    if (error && !(error instanceof Error)) {
      context = { ...context, errorData: error };
    }
    this.log('error', message, context, err);
  }

  /**
   * 監査ログ（重要な操作を記録）
   */
  audit(action: string, context: LogContext & { action?: string }): void {
    this.info(`[AUDIT] ${action}`, { ...context, category: 'audit' });
  }

  /**
   * パフォーマンス計測用のタイマーを開始
   */
  startTimer(label: string): () => number {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.debug(`${label} completed in ${duration}ms`, { durationMs: duration });
      return duration;
    };
  }
}

// シングルトンインスタンス
export const logger = new Logger();

// =====================================================
// ユーティリティ関数
// =====================================================

/**
 * リクエストスコープのロガーを作成
 */
export function createRequestLogger(context: LogContext): Logger {
  const requestLogger = new Logger();
  requestLogger.setDefaultContext({
    ...context,
    requestId: context.requestId || generateRequestId(),
  });
  return requestLogger;
}

/**
 * リクエストIDを生成
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

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

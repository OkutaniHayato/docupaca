/**
 * Cloud Functions用アラート通知基盤
 *
 * 同期失敗、API例外、制限超過などのエラー発生時に通知を送信
 */

import * as admin from 'firebase-admin';
import { logger, LogContext } from './logger';
import { defineSecret } from 'firebase-functions/params';

// Slack Webhook URLをSecret Managerから取得（オプション）
const slackWebhookUrl = defineSecret('SLACK_ALERT_WEBHOOK_URL');

// =====================================================
// 型定義
// =====================================================

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';

export type AlertType =
  | 'sync_failed'
  | 'sync_timeout'
  | 'api_error'
  | 'rate_limit'
  | 'store_limit'
  | 'auth_failure'
  | 'data_integrity'
  | 'scheduled_job_failed'
  | 'external_service_down'
  | 'custom';

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  timestamp: admin.firestore.Timestamp;
  context?: AlertContext;
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
  acknowledged: boolean;
  acknowledgedAt?: admin.firestore.Timestamp;
  acknowledgedBy?: string;
}

export interface AlertContext extends LogContext {
  environment?: string;
  service?: string;
  affectedResource?: string;
  affectedCount?: number;
  recoveryAction?: string;
}

// =====================================================
// AlertManager
// =====================================================

class FunctionsAlertManager {
  private alertHistory: Map<string, number> = new Map();
  private readonly dedupeWindowMs = 5 * 60 * 1000; // 5分間の重複抑制

  /**
   * アラートIDを生成
   */
  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 重複チェック用のキーを生成
   */
  private getDedupeKey(type: AlertType, context?: AlertContext): string {
    return `${type}:${context?.orgId || 'global'}:${context?.docId || ''}`;
  }

  /**
   * 重複アラートかどうかチェック
   */
  private isDuplicate(type: AlertType, context?: AlertContext): boolean {
    const key = this.getDedupeKey(type, context);
    const lastSent = this.alertHistory.get(key);

    if (lastSent && Date.now() - lastSent < this.dedupeWindowMs) {
      return true;
    }

    this.alertHistory.set(key, Date.now());

    // 古いエントリをクリーンアップ
    const now = Date.now();
    for (const [k, v] of this.alertHistory.entries()) {
      if (now - v > this.dedupeWindowMs) {
        this.alertHistory.delete(k);
      }
    }

    return false;
  }

  /**
   * Slackに通知を送信
   */
  private async sendToSlack(alert: Alert): Promise<void> {
    let webhookUrl: string;
    try {
      webhookUrl = slackWebhookUrl.value();
    } catch {
      // Secret が設定されていない場合はスキップ
      return;
    }

    if (!webhookUrl) return;

    const severityEmoji: Record<AlertSeverity, string> = {
      critical: '🚨',
      high: '⚠️',
      medium: '📢',
      low: 'ℹ️',
    };

    const payload = {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${severityEmoji[alert.severity]} ${alert.title}`,
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Type:*\n${alert.type}` },
            { type: 'mrkdwn', text: `*Severity:*\n${alert.severity}` },
            { type: 'mrkdwn', text: `*Time:*\n${alert.timestamp.toDate().toISOString()}` },
            ...(alert.context?.orgId ? [{ type: 'mrkdwn', text: `*Org:*\n${alert.context.orgId}` }] : []),
          ],
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: alert.message },
        },
        ...(alert.error ? [{
          type: 'section',
          text: { type: 'mrkdwn', text: `\`\`\`${alert.error.code}: ${alert.error.message}\`\`\`` },
        }] : []),
        ...(alert.context?.recoveryAction ? [{
          type: 'section',
          text: { type: 'mrkdwn', text: `*Recovery Action:* ${alert.context.recoveryAction}` },
        }] : []),
      ],
    };

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      logger.error('Failed to send Slack alert', error, { alertId: alert.id });
    }
  }

  /**
   * Firestoreにアラートを保存
   */
  private async saveToFirestore(alert: Alert): Promise<void> {
    try {
      const db = admin.firestore();
      await db.collection('system_alerts').add({
        ...alert,
        createdAt: admin.firestore.Timestamp.now(),
      });
    } catch (error) {
      logger.error('Failed to save alert to Firestore', error, { alertId: alert.id });
    }
  }

  /**
   * アラートを送信
   */
  async send(
    type: AlertType,
    severity: AlertSeverity,
    title: string,
    message: string,
    context?: AlertContext,
    error?: Error
  ): Promise<string | null> {
    // 重複チェック（criticalは常に送信）
    if (severity !== 'critical' && this.isDuplicate(type, context)) {
      logger.debug('Duplicate alert suppressed', { type, ...context });
      return null;
    }

    const alert: Alert = {
      id: this.generateAlertId(),
      type,
      severity,
      title,
      message,
      timestamp: admin.firestore.Timestamp.now(),
      context: {
        ...context,
        environment: process.env.NODE_ENV || 'production',
        service: 'docupaca-functions',
      },
      acknowledged: false,
    };

    if (error) {
      alert.error = {
        code: (error as Error & { code?: string }).code || 'UNKNOWN',
        message: error.message,
        stack: error.stack,
      };
    }

    // ログに記録
    switch (severity) {
      case 'critical':
      case 'high':
        logger.error(`[ALERT:${severity.toUpperCase()}] ${title}`, error, context);
        break;
      case 'medium':
        logger.warn(`[ALERT:${severity.toUpperCase()}] ${title}`, context);
        break;
      case 'low':
        logger.info(`[ALERT:${severity.toUpperCase()}] ${title}`, context);
        break;
    }

    // 非同期で通知を送信（エラーは無視）
    await Promise.allSettled([
      this.sendToSlack(alert),
      this.saveToFirestore(alert),
    ]);

    return alert.id;
  }

  // =====================================================
  // 便利メソッド
  // =====================================================

  /**
   * 同期失敗アラート
   */
  async syncFailed(
    orgId: string,
    docId: string,
    error: Error,
    retryCount: number
  ): Promise<string | null> {
    const severity: AlertSeverity = retryCount >= 3 ? 'high' : 'medium';
    return this.send(
      'sync_failed',
      severity,
      'ナレッジ同期失敗',
      `ドキュメント ${docId} の同期に失敗しました (リトライ: ${retryCount}回)`,
      {
        orgId,
        docId,
        category: 'sync',
        retryCount,
        recoveryAction: retryCount >= 3
          ? '手動での再同期またはドキュメント内容の確認が必要です'
          : '自動リトライが予定されています',
      },
      error
    );
  }

  /**
   * API エラーアラート
   */
  async apiError(
    service: string,
    error: Error,
    context?: AlertContext
  ): Promise<string | null> {
    return this.send(
      'api_error',
      'high',
      `${service} APIエラー`,
      `${service} APIの呼び出しに失敗しました`,
      {
        ...context,
        category: 'api',
        service,
        recoveryAction: 'エラー内容を確認し、必要に応じてリトライしてください',
      },
      error
    );
  }

  /**
   * レート制限到達アラート
   */
  async rateLimitReached(
    service: string,
    retryAfter?: number,
    context?: AlertContext
  ): Promise<string | null> {
    return this.send(
      'rate_limit',
      'medium',
      `${service} レート制限到達`,
      `${service} のAPI制限に達しました${retryAfter ? ` (${retryAfter}秒後にリトライ可能)` : ''}`,
      {
        ...context,
        category: 'api',
        service,
        retryAfter,
        recoveryAction: 'しばらく待ってから再試行してください',
      }
    );
  }

  /**
   * ストア制限アラート
   */
  async storeLimitExceeded(
    orgId: string,
    currentSize: number,
    maxSize: number
  ): Promise<string | null> {
    return this.send(
      'store_limit',
      'high',
      'ナレッジストア容量制限',
      `組織 ${orgId} のナレッジストアが容量制限に近づいています (${currentSize}/${maxSize})`,
      {
        orgId,
        category: 'knowledge',
        currentSize,
        maxSize,
        recoveryAction: '不要なナレッジを削除するか、プランのアップグレードを検討してください',
      }
    );
  }

  /**
   * 定期バッチ失敗アラート
   */
  async scheduledJobFailed(
    jobName: string,
    error: Error,
    context?: AlertContext
  ): Promise<string | null> {
    return this.send(
      'scheduled_job_failed',
      'critical',
      '定期バッチ処理失敗',
      `定期バッチ "${jobName}" の実行に失敗しました`,
      {
        ...context,
        category: 'scheduled',
        jobName,
        recoveryAction: 'Cloud Functionsのログを確認し、手動で再実行してください',
      },
      error
    );
  }

  /**
   * 不審な認証失敗アラート
   */
  async suspiciousAuthFailure(
    userId: string,
    failureCount: number,
    ipAddress?: string
  ): Promise<string | null> {
    if (failureCount < 5) return null;

    return this.send(
      'auth_failure',
      'high',
      '不審な認証失敗検知',
      `ユーザー ${userId} で ${failureCount} 回の認証失敗を検知しました`,
      {
        userId,
        category: 'auth',
        failureCount,
        ipAddress,
        recoveryAction: 'セキュリティ担当者に連絡し、アカウントの確認を行ってください',
      }
    );
  }

  /**
   * データ整合性エラーアラート
   */
  async dataIntegrityError(
    collection: string,
    docId: string,
    issue: string
  ): Promise<string | null> {
    return this.send(
      'data_integrity',
      'high',
      'データ整合性エラー',
      `${collection}/${docId} でデータ整合性の問題を検出: ${issue}`,
      {
        category: 'system',
        collection,
        docId,
        issue,
        recoveryAction: 'データベースの整合性チェックを実行してください',
      }
    );
  }
}

// シングルトンインスタンス
export const alertManager = new FunctionsAlertManager();

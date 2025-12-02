/**
 * 監査ログ・レビュー管理機能
 *
 * ナレッジ内容の定期点検、LLM提案結果の監査、
 * ストア整合性チェックなどの監査体制を支援
 */

import { adminDb } from '@/config/firebase-admin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { logger } from './logger';

// =====================================================
// 型定義
// =====================================================

export type AuditAction =
  // ナレッジ関連
  | 'knowledge_created'
  | 'knowledge_updated'
  | 'knowledge_deleted'
  | 'knowledge_sync_started'
  | 'knowledge_sync_completed'
  | 'knowledge_sync_failed'
  // OCR/コード提案関連
  | 'code_suggestion_requested'
  | 'code_suggestion_completed'
  | 'code_suggestion_accepted'
  | 'code_suggestion_rejected'
  // レビュー関連
  | 'review_started'
  | 'review_completed'
  | 'review_item_checked'
  // 認証・認可関連
  | 'login_success'
  | 'login_failed'
  | 'access_denied'
  // システム関連
  | 'config_changed'
  | 'scheduled_job_executed';

export interface AuditLogEntry {
  id?: string;
  action: AuditAction;
  timestamp: Timestamp;
  userId?: string;
  orgId?: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export type ReviewStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';
export type ReviewType = 'quarterly' | 'monthly' | 'ad_hoc' | 'incident';

export interface ReviewRecord {
  id?: string;
  orgId: string;
  reviewType: ReviewType;
  status: ReviewStatus;
  scheduledDate: Timestamp;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
  reviewerId?: string;
  reviewerName?: string;
  items: ReviewItem[];
  summary?: string;
  findings?: string[];
  actions?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ReviewItem {
  id: string;
  category: ReviewCategory;
  description: string;
  status: 'pending' | 'checked' | 'issue_found' | 'skipped';
  checkedAt?: Timestamp;
  checkedBy?: string;
  notes?: string;
  issueDetails?: string;
}

export type ReviewCategory =
  | 'knowledge_accuracy'    // ナレッジ内容の正確性
  | 'knowledge_relevance'   // ナレッジの関連性・最新性
  | 'knowledge_coverage'    // ナレッジのカバレッジ
  | 'suggestion_quality'    // LLM提案の品質
  | 'store_integrity'       // ストア整合性
  | 'access_control'        // アクセス制御
  | 'sync_status';          // 同期状態

// =====================================================
// 監査ログ記録
// =====================================================

/**
 * 監査ログを記録
 */
export async function recordAuditLog(entry: Omit<AuditLogEntry, 'timestamp'>): Promise<string> {
  try {
    const db = adminDb();
    const logEntry: AuditLogEntry = {
      ...entry,
      timestamp: Timestamp.now(),
    };

    const docRef = await db.collection('audit_logs').add(logEntry);

    logger.debug('Audit log recorded', {
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      docId: docRef.id,
    });

    return docRef.id;
  } catch (error) {
    logger.error('Failed to record audit log', error as Error, {
      action: entry.action,
    });
    throw error;
  }
}

/**
 * 監査ログを検索
 */
export async function searchAuditLogs(params: {
  orgId?: string;
  action?: AuditAction;
  userId?: string;
  resourceType?: string;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}): Promise<AuditLogEntry[]> {
  const db = adminDb();
  let query = db.collection('audit_logs').orderBy('timestamp', 'desc');

  if (params.orgId) {
    query = query.where('orgId', '==', params.orgId);
  }
  if (params.action) {
    query = query.where('action', '==', params.action);
  }
  if (params.userId) {
    query = query.where('userId', '==', params.userId);
  }
  if (params.resourceType) {
    query = query.where('resourceType', '==', params.resourceType);
  }
  if (params.resourceId) {
    query = query.where('resourceId', '==', params.resourceId);
  }
  if (params.startDate) {
    query = query.where('timestamp', '>=', Timestamp.fromDate(params.startDate));
  }
  if (params.endDate) {
    query = query.where('timestamp', '<=', Timestamp.fromDate(params.endDate));
  }

  query = query.limit(params.limit || 100);

  const snapshot = await query.get();
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  } as AuditLogEntry));
}

// =====================================================
// レビュー管理
// =====================================================

/**
 * 四半期レビューのチェックリストを生成
 */
export function generateQuarterlyReviewChecklist(): ReviewItem[] {
  return [
    // ナレッジ内容の点検
    {
      id: 'kr_1',
      category: 'knowledge_accuracy',
      description: '顧客マスタの内容が最新の状態と一致しているか確認',
      status: 'pending',
    },
    {
      id: 'kr_2',
      category: 'knowledge_accuracy',
      description: '品目マスタの内容が最新の状態と一致しているか確認',
      status: 'pending',
    },
    {
      id: 'kr_3',
      category: 'knowledge_accuracy',
      description: '勘定科目マスタの内容が会計基準と一致しているか確認',
      status: 'pending',
    },
    {
      id: 'kr_4',
      category: 'knowledge_accuracy',
      description: '税区分マスタが最新の税制に対応しているか確認',
      status: 'pending',
    },
    {
      id: 'kr_5',
      category: 'knowledge_accuracy',
      description: '業務ルールが現行の業務フローと一致しているか確認',
      status: 'pending',
    },
    {
      id: 'kr_6',
      category: 'knowledge_relevance',
      description: '例外ルールが現在も有効か、廃止すべきものがないか確認',
      status: 'pending',
    },

    // LLM提案品質の監査
    {
      id: 'sq_1',
      category: 'suggestion_quality',
      description: '過去1四半期のコード提案の正解率を集計・分析',
      status: 'pending',
    },
    {
      id: 'sq_2',
      category: 'suggestion_quality',
      description: '低信頼度（confidence < 0.5）の提案をサンプル確認',
      status: 'pending',
    },
    {
      id: 'sq_3',
      category: 'suggestion_quality',
      description: 'ユーザーによる修正が多い提案パターンを分析',
      status: 'pending',
    },

    // ストア整合性チェック
    {
      id: 'si_1',
      category: 'store_integrity',
      description: 'File Search Storeとorglearningdocsの整合性を確認',
      status: 'pending',
    },
    {
      id: 'si_2',
      category: 'store_integrity',
      description: '同期失敗が続いているドキュメントの確認と対処',
      status: 'pending',
    },
    {
      id: 'si_3',
      category: 'store_integrity',
      description: 'ストア容量の使用状況を確認',
      status: 'pending',
    },
    {
      id: 'si_4',
      category: 'store_integrity',
      description: '重複ドキュメントの有無を確認',
      status: 'pending',
    },

    // アクセス制御
    {
      id: 'ac_1',
      category: 'access_control',
      description: '不要なユーザーアカウントがないか確認',
      status: 'pending',
    },
    {
      id: 'ac_2',
      category: 'access_control',
      description: '組織メンバーの権限が適切か確認',
      status: 'pending',
    },

    // 同期状態
    {
      id: 'ss_1',
      category: 'sync_status',
      description: '定期同期バッチが正常に実行されているか確認',
      status: 'pending',
    },
    {
      id: 'ss_2',
      category: 'sync_status',
      description: '同期履歴にエラーパターンがないか確認',
      status: 'pending',
    },
  ];
}

/**
 * レビュー記録を作成
 */
export async function createReviewRecord(
  orgId: string,
  reviewType: ReviewType,
  scheduledDate: Date,
  reviewerId?: string,
  reviewerName?: string
): Promise<string> {
  const db = adminDb();

  const items = reviewType === 'quarterly'
    ? generateQuarterlyReviewChecklist()
    : [];

  const record: ReviewRecord = {
    orgId,
    reviewType,
    status: 'pending',
    scheduledDate: Timestamp.fromDate(scheduledDate),
    reviewerId,
    reviewerName,
    items,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };

  const docRef = await db.collection('review_records').add(record);

  // 監査ログに記録
  await recordAuditLog({
    action: 'review_started',
    orgId,
    userId: reviewerId,
    resourceType: 'review_record',
    resourceId: docRef.id,
    details: { reviewType, scheduledDate: scheduledDate.toISOString() },
  });

  logger.info('Review record created', {
    orgId,
    reviewType,
    docId: docRef.id,
    category: 'audit',
  });

  return docRef.id;
}

/**
 * レビュー項目をチェック済みにする
 */
export async function checkReviewItem(
  reviewId: string,
  itemId: string,
  userId: string,
  status: 'checked' | 'issue_found' | 'skipped',
  notes?: string,
  issueDetails?: string
): Promise<void> {
  const db = adminDb();
  const reviewRef = db.collection('review_records').doc(reviewId);
  const reviewDoc = await reviewRef.get();

  if (!reviewDoc.exists) {
    throw new Error(`Review record not found: ${reviewId}`);
  }

  const reviewData = reviewDoc.data() as ReviewRecord;
  const itemIndex = reviewData.items.findIndex(item => item.id === itemId);

  if (itemIndex === -1) {
    throw new Error(`Review item not found: ${itemId}`);
  }

  // 項目を更新
  reviewData.items[itemIndex] = {
    ...reviewData.items[itemIndex],
    status,
    checkedAt: Timestamp.now(),
    checkedBy: userId,
    notes,
    issueDetails,
  };

  // 全項目がチェック済みかどうか確認
  const allChecked = reviewData.items.every(
    item => item.status !== 'pending'
  );

  await reviewRef.update({
    items: reviewData.items,
    status: allChecked ? 'completed' : 'in_progress',
    startedAt: reviewData.startedAt || Timestamp.now(),
    completedAt: allChecked ? Timestamp.now() : null,
    updatedAt: Timestamp.now(),
  });

  // 監査ログに記録
  await recordAuditLog({
    action: 'review_item_checked',
    orgId: reviewData.orgId,
    userId,
    resourceType: 'review_item',
    resourceId: `${reviewId}/${itemId}`,
    details: { status, notes, issueDetails },
  });
}

/**
 * レビュー記録を完了する
 */
export async function completeReview(
  reviewId: string,
  userId: string,
  summary: string,
  findings?: string[],
  actions?: string[]
): Promise<void> {
  const db = adminDb();
  const reviewRef = db.collection('review_records').doc(reviewId);
  const reviewDoc = await reviewRef.get();

  if (!reviewDoc.exists) {
    throw new Error(`Review record not found: ${reviewId}`);
  }

  const reviewData = reviewDoc.data() as ReviewRecord;

  await reviewRef.update({
    status: 'completed',
    completedAt: Timestamp.now(),
    summary,
    findings: findings || [],
    actions: actions || [],
    updatedAt: Timestamp.now(),
  });

  // 監査ログに記録
  await recordAuditLog({
    action: 'review_completed',
    orgId: reviewData.orgId,
    userId,
    resourceType: 'review_record',
    resourceId: reviewId,
    details: {
      summary,
      findingsCount: findings?.length || 0,
      actionsCount: actions?.length || 0,
    },
  });

  logger.info('Review completed', {
    reviewId,
    orgId: reviewData.orgId,
    category: 'audit',
  });
}

/**
 * 組織のレビュー履歴を取得
 */
export async function getReviewHistory(
  orgId: string,
  limit: number = 10
): Promise<ReviewRecord[]> {
  const db = adminDb();
  const snapshot = await db.collection('review_records')
    .where('orgId', '==', orgId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  } as ReviewRecord));
}

// =====================================================
// ナレッジ整合性チェック
// =====================================================

export interface IntegrityCheckResult {
  checkType: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  details?: Record<string, unknown>;
}

/**
 * ナレッジストアの整合性をチェック
 */
export async function checkKnowledgeIntegrity(orgId: string): Promise<IntegrityCheckResult[]> {
  const results: IntegrityCheckResult[] = [];
  const db = adminDb();

  try {
    // 1. orgLearningDocsの状態チェック
    const docsSnapshot = await db.collection('orgLearningDocs')
      .where('orgId', '==', orgId)
      .get();

    const totalDocs = docsSnapshot.size;
    let syncedDocs = 0;
    let failedDocs = 0;
    let pendingDocs = 0;
    const failedDocIds: string[] = [];

    docsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      switch (data.syncStatus) {
        case 'synced':
          syncedDocs++;
          break;
        case 'failed':
          failedDocs++;
          failedDocIds.push(doc.id);
          break;
        case 'pending':
        case 'syncing':
          pendingDocs++;
          break;
      }
    });

    results.push({
      checkType: 'sync_status',
      status: failedDocs > 0 ? 'warning' : 'ok',
      message: `同期状態: ${syncedDocs}/${totalDocs} 同期済み, ${failedDocs} 失敗, ${pendingDocs} 保留`,
      details: { totalDocs, syncedDocs, failedDocs, pendingDocs, failedDocIds },
    });

    // 2. 空のナレッジチェック
    const emptyDocs = docsSnapshot.docs.filter(doc => {
      const content = doc.data().content;
      return !content || content.trim().length === 0;
    });

    results.push({
      checkType: 'empty_content',
      status: emptyDocs.length > 0 ? 'warning' : 'ok',
      message: emptyDocs.length > 0
        ? `${emptyDocs.length}件の空のナレッジドキュメントがあります`
        : '空のナレッジドキュメントはありません',
      details: { count: emptyDocs.length, docIds: emptyDocs.map(d => d.id) },
    });

    // 3. 古いナレッジチェック（90日以上更新なし）
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const staleDocs = docsSnapshot.docs.filter(doc => {
      const updatedAt = doc.data().updatedAt?.toDate();
      return updatedAt && updatedAt < ninetyDaysAgo;
    });

    results.push({
      checkType: 'stale_content',
      status: staleDocs.length > 0 ? 'warning' : 'ok',
      message: staleDocs.length > 0
        ? `${staleDocs.length}件のナレッジが90日以上更新されていません`
        : '90日以上更新されていないナレッジはありません',
      details: { count: staleDocs.length, docIds: staleDocs.map(d => d.id) },
    });

    // 4. 同期履歴のエラーチェック（過去7日間）
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const syncHistorySnapshot = await db.collection('org_learning_sync_history')
      .where('orgId', '==', orgId)
      .where('executedAt', '>=', Timestamp.fromDate(sevenDaysAgo))
      .get();

    let recentSyncErrors = 0;
    syncHistorySnapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.stats?.failedDocs > 0 || data.error) {
        recentSyncErrors++;
      }
    });

    results.push({
      checkType: 'recent_sync_errors',
      status: recentSyncErrors > 0 ? 'warning' : 'ok',
      message: recentSyncErrors > 0
        ? `過去7日間で${recentSyncErrors}件の同期エラーがあります`
        : '過去7日間の同期エラーはありません',
      details: { errorCount: recentSyncErrors, totalSyncs: syncHistorySnapshot.size },
    });

    logger.info('Knowledge integrity check completed', {
      orgId,
      resultsCount: results.length,
      warnings: results.filter(r => r.status === 'warning').length,
      category: 'audit',
    });

  } catch (error) {
    results.push({
      checkType: 'check_error',
      status: 'error',
      message: `整合性チェック中にエラーが発生しました: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }

  return results;
}

// =====================================================
// コード提案品質分析
// =====================================================

export interface SuggestionQualityReport {
  period: { start: Date; end: Date };
  totalSuggestions: number;
  acceptedCount: number;
  rejectedCount: number;
  modifiedCount: number;
  acceptanceRate: number;
  averageConfidence: number;
  lowConfidenceCount: number;
  categoryBreakdown: Record<string, {
    total: number;
    accepted: number;
    avgConfidence: number;
  }>;
}

/**
 * コード提案の品質レポートを生成
 */
export async function generateSuggestionQualityReport(
  orgId: string,
  startDate: Date,
  endDate: Date
): Promise<SuggestionQualityReport> {
  const db = adminDb();

  // 組織に紐づくOCR設定を取得
  const settingsSnapshot = await db.collection('ocr_settings')
    .where('organization_id', '==', orgId)
    .get();

  const settingIds = settingsSnapshot.docs.map(doc => doc.id);

  if (settingIds.length === 0) {
    return {
      period: { start: startDate, end: endDate },
      totalSuggestions: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      modifiedCount: 0,
      acceptanceRate: 0,
      averageConfidence: 0,
      lowConfidenceCount: 0,
      categoryBreakdown: {},
    };
  }

  // OCR履歴からコード提案データを取得
  // Note: Firestoreの制限により、settingIdsが多い場合は分割クエリが必要
  let totalSuggestions = 0;
  let acceptedCount = 0;
  let rejectedCount = 0;
  let modifiedCount = 0;
  let totalConfidence = 0;
  let lowConfidenceCount = 0;
  const categoryStats: Record<string, { total: number; accepted: number; totalConfidence: number }> = {};

  // 各OCR設定ごとに履歴を取得
  for (const settingId of settingIds) {
    const historySnapshot = await db.collection('ocr_history')
      .where('setting_id', '==', settingId)
      .where('codeSuggestedAt', '>=', Timestamp.fromDate(startDate))
      .where('codeSuggestedAt', '<=', Timestamp.fromDate(endDate))
      .get();

    for (const doc of historySnapshot.docs) {
      const data = doc.data();
      if (!data.codeSuggestions) continue;

      totalSuggestions++;

      // 顧客コードの分析
      const customerSuggestion = data.codeSuggestions.customerCode;
      if (customerSuggestion) {
        const confidence = customerSuggestion.confidence || 0;
        totalConfidence += confidence;

        if (confidence < 0.5) {
          lowConfidenceCount++;
        }

        // カテゴリ別集計
        if (!categoryStats['customerCode']) {
          categoryStats['customerCode'] = { total: 0, accepted: 0, totalConfidence: 0 };
        }
        categoryStats['customerCode'].total++;
        categoryStats['customerCode'].totalConfidence += confidence;

        // 承認/却下の判定（humanConfirmedDataとの比較）
        if (data.humanConfirmedData?.customerCode) {
          if (data.humanConfirmedData.customerCode === customerSuggestion.code) {
            acceptedCount++;
            categoryStats['customerCode'].accepted++;
          } else if (customerSuggestion.code && data.humanConfirmedData.customerCode) {
            modifiedCount++;
          } else {
            rejectedCount++;
          }
        }
      }
    }
  }

  const acceptanceRate = totalSuggestions > 0 ? acceptedCount / totalSuggestions : 0;
  const averageConfidence = totalSuggestions > 0 ? totalConfidence / totalSuggestions : 0;

  const categoryBreakdown: Record<string, { total: number; accepted: number; avgConfidence: number }> = {};
  for (const [category, stats] of Object.entries(categoryStats)) {
    categoryBreakdown[category] = {
      total: stats.total,
      accepted: stats.accepted,
      avgConfidence: stats.total > 0 ? stats.totalConfidence / stats.total : 0,
    };
  }

  const report: SuggestionQualityReport = {
    period: { start: startDate, end: endDate },
    totalSuggestions,
    acceptedCount,
    rejectedCount,
    modifiedCount,
    acceptanceRate,
    averageConfidence,
    lowConfidenceCount,
    categoryBreakdown,
  };

  logger.info('Suggestion quality report generated', {
    orgId,
    totalSuggestions,
    acceptanceRate,
    category: 'audit',
  });

  return report;
}

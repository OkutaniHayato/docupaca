import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/config/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

interface CorrectionLog {
  templateId: string;
  fieldKey: string;
  aiValue: string;
  humanValue: string;
  createdAt: Timestamp;
}

interface CorrectionAggregation {
  templateId: string;
  fieldKey: string;
  aiValue: string;
  correctValue: string;
  count: number;
}

interface ReplacementRule {
  fieldKey: string;
  aiValue: string;
  correctValue: string;
  count: number;
  updatedAt: Timestamp;
}

interface LearningHistoryRule {
  templateId: string;
  templateName?: string;
  fieldKey: string;
  aiValue: string;
  correctValue: string;
  count: number;
  isNew: boolean;
}

/**
 * 訂正学習バッチを手動実行するAPIエンドポイント
 */
export async function POST(request: NextRequest) {
  try {
    // 認証チェック
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Authorization header missing' },
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
        { success: false, error: 'Invalid token' },
        { status: 401 }
      );
    }

    // 設定を取得
    const db = adminDb();
    const settingsDoc = await db.collection('app_settings').doc('correction_learning').get();
    const settings = settingsDoc.exists ? settingsDoc.data() : null;

    const lookbackDays = settings?.lookbackDays || 30;
    const minCount = settings?.minOccurrenceCount || 3;

    console.log('手動訂正学習バッチ開始', { userId, lookbackDays, minCount });

    const startTime = Date.now();
    const stats = {
      totalCorrections: 0,
      templatesProcessed: 0,
      rulesAdded: 0,
      rulesUpdated: 0,
      errors: 0,
    };

    // 過去 N 日分の corrections を取得
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
    const cutoffTimestamp = Timestamp.fromDate(cutoffDate);

    const correctionsSnapshot = await db.collection('corrections')
      .where('createdAt', '>=', cutoffTimestamp)
      .get();

    stats.totalCorrections = correctionsSnapshot.size;

    if (correctionsSnapshot.empty) {
      return NextResponse.json({
        success: true,
        message: '処理対象の訂正がありません',
        rulesAdded: 0,
        rulesUpdated: 0,
        stats,
      });
    }

    // 集計処理
    const aggregations = new Map<string, CorrectionAggregation>();

    correctionsSnapshot.docs.forEach((doc) => {
      const correction = doc.data() as CorrectionLog;

      if (correction.aiValue === correction.humanValue) {
        return;
      }

      const key = `${correction.templateId}|${correction.fieldKey}|${correction.aiValue}|${correction.humanValue}`;

      if (aggregations.has(key)) {
        const existing = aggregations.get(key)!;
        existing.count++;
      } else {
        aggregations.set(key, {
          templateId: correction.templateId,
          fieldKey: correction.fieldKey,
          aiValue: correction.aiValue,
          correctValue: correction.humanValue,
          count: 1,
        });
      }
    });

    // minCount 以上の訂正をフィルタ
    const qualifiedCorrections = Array.from(aggregations.values())
      .filter(agg => agg.count >= minCount);

    if (qualifiedCorrections.length === 0) {
      return NextResponse.json({
        success: true,
        message: `${minCount}回以上の訂正パターンがありません`,
        rulesAdded: 0,
        rulesUpdated: 0,
        stats,
      });
    }

    // テンプレートごとにグループ化
    const correctionsByTemplate = new Map<string, CorrectionAggregation[]>();

    qualifiedCorrections.forEach(correction => {
      const templateId = correction.templateId;
      if (!correctionsByTemplate.has(templateId)) {
        correctionsByTemplate.set(templateId, []);
      }
      correctionsByTemplate.get(templateId)!.push(correction);
    });

    stats.templatesProcessed = correctionsByTemplate.size;

    // 履歴用のルール配列
    const historyRules: LearningHistoryRule[] = [];

    // 各テンプレートの learning.replacements を更新
    for (const [templateId, corrections] of correctionsByTemplate) {
      try {
        const templateRef = db.collection('templates').doc(templateId);
        const templateDoc = await templateRef.get();

        if (!templateDoc.exists) {
          console.warn(`テンプレート ${templateId} が見つかりません`);
          stats.errors++;
          continue;
        }

        const templateData = templateDoc.data();
        const templateName = templateData?.name || templateId;
        const existingLearning = templateData?.learning || {};
        const existingReplacements: ReplacementRule[] = existingLearning.replacements || [];

        // 既存ルールをマップに変換
        const replacementMap = new Map<string, ReplacementRule>();
        existingReplacements.forEach(rule => {
          const key = `${rule.fieldKey}|${rule.aiValue}|${rule.correctValue}`;
          replacementMap.set(key, rule);
        });

        // 新しい訂正を追加または更新
        corrections.forEach(correction => {
          const key = `${correction.fieldKey}|${correction.aiValue}|${correction.correctValue}`;
          const isNew = !replacementMap.has(key);

          if (isNew) {
            replacementMap.set(key, {
              fieldKey: correction.fieldKey,
              aiValue: correction.aiValue,
              correctValue: correction.correctValue,
              count: correction.count,
              updatedAt: Timestamp.now(),
            });
            stats.rulesAdded++;
          } else {
            const existing = replacementMap.get(key)!;
            existing.count = Math.max(existing.count, correction.count);
            existing.updatedAt = Timestamp.now();
            stats.rulesUpdated++;
          }

          // 履歴用に記録
          historyRules.push({
            templateId,
            templateName,
            fieldKey: correction.fieldKey,
            aiValue: correction.aiValue,
            correctValue: correction.correctValue,
            count: correction.count,
            isNew,
          });
        });

        // テンプレートを更新
        const updatedReplacements = Array.from(replacementMap.values());

        await templateRef.update({
          'learning.replacements': updatedReplacements,
          'learning.lastLearnedAt': FieldValue.serverTimestamp(),
        });

        console.log(`テンプレート ${templateId} を更新: ${corrections.length} ルール`);
      } catch (error) {
        console.error(`テンプレート ${templateId} の更新に失敗:`, error);
        stats.errors++;
      }
    }

    const durationMs = Date.now() - startTime;

    // 履歴を保存（ルールが追加/更新された場合のみ）
    if (stats.rulesAdded > 0 || stats.rulesUpdated > 0) {
      try {
        await db.collection('learning_history').add({
          executedAt: FieldValue.serverTimestamp(),
          executionType: 'manual',
          stats,
          durationMs,
          rules: historyRules,
          settings: {
            lookbackDays,
            minOccurrenceCount: minCount,
          },
        });
        console.log('学習履歴を保存しました');
      } catch (error) {
        console.error('学習履歴の保存に失敗:', error);
      }
    }

    console.log('手動訂正学習バッチ完了', { stats, durationMs });

    return NextResponse.json({
      success: true,
      message: '学習バッチを実行しました',
      rulesAdded: stats.rulesAdded,
      rulesUpdated: stats.rulesUpdated,
      stats,
      durationMs,
    });
  } catch (error) {
    console.error('訂正学習バッチエラー:', error);
    return NextResponse.json(
      { success: false, error: '学習バッチの実行に失敗しました' },
      { status: 500 }
    );
  }
}

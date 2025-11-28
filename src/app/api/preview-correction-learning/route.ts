import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/config/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

interface CorrectionLog {
  templateId: string;
  fieldKey: string;
  aiValue: string;
  humanValue: string;
  createdAt: Timestamp;
}

interface CorrectionAggregation {
  templateId: string;
  templateName?: string;
  fieldKey: string;
  aiValue: string;
  correctValue: string;
  count: number;
}

/**
 * 訂正学習の対象データをプレビューするAPIエンドポイント
 * 実際の学習は行わず、対象となるデータを確認できる
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

    try {
      await adminAuth().verifyIdToken(token);
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

    // 過去 N 日分の corrections を取得
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
    const cutoffTimestamp = Timestamp.fromDate(cutoffDate);

    const correctionsSnapshot = await db.collection('corrections')
      .where('createdAt', '>=', cutoffTimestamp)
      .get();

    const totalCorrections = correctionsSnapshot.size;

    if (correctionsSnapshot.empty) {
      return NextResponse.json({
        success: true,
        totalCorrections: 0,
        qualifiedPatterns: [],
        unqualifiedPatterns: [],
        settings: {
          lookbackDays,
          minOccurrenceCount: minCount,
        },
      });
    }

    // 集計処理
    const aggregations = new Map<string, CorrectionAggregation>();

    correctionsSnapshot.docs.forEach((doc) => {
      const correction = doc.data() as CorrectionLog;

      // AI値と人間の値が同じ場合はスキップ
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

    // テンプレート名を取得
    const templateIds = [...new Set(Array.from(aggregations.values()).map(a => a.templateId))];
    const templateNames = new Map<string, string>();

    for (const templateId of templateIds) {
      try {
        const templateDoc = await db.collection('templates').doc(templateId).get();
        if (templateDoc.exists) {
          templateNames.set(templateId, templateDoc.data()?.name || templateId);
        }
      } catch {
        // テンプレートが見つからない場合はIDをそのまま使用
      }
    }

    // テンプレート名を追加
    const allPatterns = Array.from(aggregations.values()).map(agg => ({
      ...agg,
      templateName: templateNames.get(agg.templateId) || agg.templateId,
    }));

    // 基準を満たすものと満たさないものに分類
    const qualifiedPatterns = allPatterns
      .filter(agg => agg.count >= minCount)
      .sort((a, b) => b.count - a.count);

    const unqualifiedPatterns = allPatterns
      .filter(agg => agg.count < minCount)
      .sort((a, b) => b.count - a.count)
      .slice(0, 20); // 上位20件のみ

    return NextResponse.json({
      success: true,
      totalCorrections,
      qualifiedPatterns,
      unqualifiedPatterns,
      settings: {
        lookbackDays,
        minOccurrenceCount: minCount,
      },
    });
  } catch (error) {
    console.error('プレビューエラー:', error);
    return NextResponse.json(
      { success: false, error: 'プレビューの取得に失敗しました' },
      { status: 500 }
    );
  }
}

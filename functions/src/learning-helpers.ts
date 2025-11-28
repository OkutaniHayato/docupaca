/**
 * 学習補正ヘルパー関数
 * AI抽出フローで使用する学習データ関連の処理
 */

/**
 * バウンディングボックス座標
 */
export type BBox = [number, number, number, number];

/**
 * 抽出された単一値
 */
export interface ExtractedValue {
  value: string;
  bbox: BBox;
  page?: number;
  confidence?: number;
  originalValue?: string;
  wasLearningCorrected?: boolean;
}

/**
 * 抽出された配列データ
 */
export interface ExtractedArrayData {
  items: Array<{
    [childFieldName: string]: ExtractedValue;
  }>;
  bbox?: BBox;
}

/**
 * 抽出データ全体
 */
export type ExtractedData = {
  [fieldName: string]: ExtractedValue | ExtractedArrayData;
};

/**
 * 置換ルール
 */
export interface ReplacementRule {
  fieldKey: string;
  aiValue: string;
  correctValue: string;
  count: number;
  updatedAt?: unknown;
}

/**
 * 位置ヒント
 */
export interface PreferredRegion {
  fieldKey: string;
  region: { x: number; y: number; w: number; h: number };
  sampleCount: number;
  updatedAt?: unknown;
}

/**
 * 学習データ
 */
export interface LearningData {
  replacements: ReplacementRule[];
  preferredRegions?: PreferredRegion[];
  lastLearnedAt?: unknown;
}

/**
 * 学習データからプロンプト用の補正ルール説明を生成
 * 訂正履歴に基づいた補正ルールをLLMに伝える
 */
export function generateLearningInstructions(learning?: LearningData): string {
  if (!learning) {
    return '';
  }

  const lines: string[] = [];

  // 置換ルールの説明を生成
  if (learning.replacements && learning.replacements.length > 0) {
    lines.push('【過去の訂正履歴に基づく補正ルール】');
    lines.push('以下は過去の訂正履歴から学習した補正ルールです。該当するパターンが検出された場合、可能な限り補正後の値を優先してください：');
    lines.push('');

    // フィールドごとにグループ化
    const byField: Record<string, ReplacementRule[]> = {};
    for (const rule of learning.replacements) {
      if (!byField[rule.fieldKey]) {
        byField[rule.fieldKey] = [];
      }
      byField[rule.fieldKey].push(rule);
    }

    for (const [fieldKey, rules] of Object.entries(byField)) {
      lines.push(`■ フィールド「${fieldKey}」:`);
      for (const rule of rules) {
        lines.push(`  - 「${rule.aiValue}」と読み取った場合 → 「${rule.correctValue}」に補正（過去${rule.count}回の訂正実績）`);
      }
    }
    lines.push('');
  }

  // 位置ヒントの説明を生成
  if (learning.preferredRegions && learning.preferredRegions.length > 0) {
    lines.push('【推奨抽出領域】');
    lines.push('以下のフィールドは、過去の実績から特定の領域から抽出すると精度が高いことがわかっています：');
    lines.push('');

    for (const region of learning.preferredRegions) {
      const { x, y, w, h } = region.region;
      const positionDesc = getPositionDescription(x, y, w, h);
      lines.push(`  - ${region.fieldKey}: ${positionDesc}（サンプル数: ${region.sampleCount}）`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 正規化座標から位置の説明を生成
 */
export function getPositionDescription(x: number, y: number, w: number, h: number): string {
  // 横位置の判定
  let horizontal = '中央';
  if (x + w / 2 < 0.33) {
    horizontal = '左側';
  } else if (x + w / 2 > 0.67) {
    horizontal = '右側';
  }

  // 縦位置の判定
  let vertical = '中央';
  if (y + h / 2 < 0.33) {
    vertical = '上部';
  } else if (y + h / 2 > 0.67) {
    vertical = '下部';
  }

  return `ドキュメントの${vertical}${horizontal}（座標: x=${(x * 100).toFixed(0)}%, y=${(y * 100).toFixed(0)}%, 幅=${(w * 100).toFixed(0)}%, 高さ=${(h * 100).toFixed(0)}%）`;
}

/**
 * 抽出結果に置換ルールを適用する（post-processing）
 * LLMの出力値をreplacementsに基づいて補正する
 */
export function applyReplacements(
  extractedData: ExtractedData,
  replacements: ReplacementRule[],
  logger?: { info: (msg: string) => void }
): ExtractedData {
  if (!replacements || replacements.length === 0) {
    return extractedData;
  }

  // ルールをフィールドキーでインデックス化（高速検索用）
  const rulesByField: Record<string, Map<string, string>> = {};
  for (const rule of replacements) {
    if (!rulesByField[rule.fieldKey]) {
      rulesByField[rule.fieldKey] = new Map();
    }
    rulesByField[rule.fieldKey].set(rule.aiValue, rule.correctValue);
  }

  const result: ExtractedData = {};

  for (const [fieldKey, fieldValue] of Object.entries(extractedData)) {
    if ('items' in fieldValue && Array.isArray(fieldValue.items)) {
      // 配列フィールドの場合
      const correctedItems = fieldValue.items.map((item, index) => {
        const correctedItem: Record<string, ExtractedValue> = {};
        for (const [childKey, childValue] of Object.entries(item)) {
          const fullKey = `${fieldKey}[${index}].${childKey}`;
          const genericKey = `${fieldKey}[].${childKey}`; // 汎用キー（インデックス不問）

          // ルールを適用
          const ruleMap = rulesByField[fullKey] || rulesByField[genericKey] || rulesByField[childKey];
          if (ruleMap && ruleMap.has(childValue.value)) {
            correctedItem[childKey] = {
              ...childValue,
              originalValue: childValue.value,
              value: ruleMap.get(childValue.value)!,
              wasLearningCorrected: true,
            };
            logger?.info(`学習補正適用: ${fullKey} "${childValue.value}" → "${ruleMap.get(childValue.value)}"`);
          } else {
            correctedItem[childKey] = childValue;
          }
        }
        return correctedItem;
      });

      result[fieldKey] = {
        ...fieldValue,
        items: correctedItems,
      };
    } else if ('value' in fieldValue) {
      // 単一値フィールドの場合
      const ruleMap = rulesByField[fieldKey];
      if (ruleMap && ruleMap.has(fieldValue.value)) {
        result[fieldKey] = {
          ...fieldValue,
          originalValue: fieldValue.value,
          value: ruleMap.get(fieldValue.value)!,
          wasLearningCorrected: true,
        };
        logger?.info(`学習補正適用: ${fieldKey} "${fieldValue.value}" → "${ruleMap.get(fieldValue.value)}"`);
      } else {
        result[fieldKey] = fieldValue;
      }
    } else {
      result[fieldKey] = fieldValue;
    }
  }

  return result;
}

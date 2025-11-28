/**
 * 学習補正ヘルパー関数のテスト
 */
import {
  applyReplacements,
  generateLearningInstructions,
  getPositionDescription,
  ExtractedData,
  ReplacementRule,
  LearningData,
} from './learning-helpers';

describe('applyReplacements', () => {
  describe('単一値フィールドの補正', () => {
    it('マッチするルールがある場合、値が補正される', () => {
      const extractedData: ExtractedData = {
        grandTotal: {
          value: '1200000',
          bbox: [0.7, 0.8, 0.9, 0.85],
          confidence: 0.95,
        },
      };

      const replacements: ReplacementRule[] = [
        {
          fieldKey: 'grandTotal',
          aiValue: '1200000',
          correctValue: '120000',
          count: 5,
        },
      ];

      const result = applyReplacements(extractedData, replacements);

      expect(result.grandTotal).toBeDefined();
      const grandTotal = result.grandTotal as { value: string; originalValue?: string; wasLearningCorrected?: boolean };
      expect(grandTotal.value).toBe('120000');
      expect(grandTotal.originalValue).toBe('1200000');
      expect(grandTotal.wasLearningCorrected).toBe(true);
    });

    it('マッチするルールがない場合、値は変更されない', () => {
      const extractedData: ExtractedData = {
        invoiceNumber: {
          value: 'INV-001',
          bbox: [0.1, 0.1, 0.3, 0.15],
          confidence: 0.99,
        },
      };

      const replacements: ReplacementRule[] = [
        {
          fieldKey: 'grandTotal',
          aiValue: '1200000',
          correctValue: '120000',
          count: 5,
        },
      ];

      const result = applyReplacements(extractedData, replacements);

      const invoiceNumber = result.invoiceNumber as { value: string; originalValue?: string; wasLearningCorrected?: boolean };
      expect(invoiceNumber.value).toBe('INV-001');
      expect(invoiceNumber.originalValue).toBeUndefined();
      expect(invoiceNumber.wasLearningCorrected).toBeUndefined();
    });

    it('複数のフィールドに対して補正が適用される', () => {
      const extractedData: ExtractedData = {
        companyName: {
          value: '株式会社ABＣ',
          bbox: [0.1, 0.1, 0.3, 0.15],
          confidence: 0.9,
        },
        taxAmount: {
          value: '10000O',
          bbox: [0.7, 0.7, 0.9, 0.75],
          confidence: 0.85,
        },
      };

      const replacements: ReplacementRule[] = [
        {
          fieldKey: 'companyName',
          aiValue: '株式会社ABＣ',
          correctValue: '株式会社ABC',
          count: 3,
        },
        {
          fieldKey: 'taxAmount',
          aiValue: '10000O',
          correctValue: '100000',
          count: 4,
        },
      ];

      const result = applyReplacements(extractedData, replacements);

      const companyName = result.companyName as { value: string; originalValue?: string };
      const taxAmount = result.taxAmount as { value: string; originalValue?: string };

      expect(companyName.value).toBe('株式会社ABC');
      expect(companyName.originalValue).toBe('株式会社ABＣ');
      expect(taxAmount.value).toBe('100000');
      expect(taxAmount.originalValue).toBe('10000O');
    });
  });

  describe('配列フィールドの補正', () => {
    it('配列内の子フィールドが補正される（汎用キー）', () => {
      const extractedData: ExtractedData = {
        lineItems: {
          items: [
            {
              itemName: { value: 'コーピー用紙', bbox: [0.1, 0.3, 0.4, 0.35], confidence: 0.9 },
              quantity: { value: '1O', bbox: [0.5, 0.3, 0.6, 0.35], confidence: 0.85 },
            },
            {
              itemName: { value: 'ボールペン', bbox: [0.1, 0.4, 0.4, 0.45], confidence: 0.95 },
              quantity: { value: '5', bbox: [0.5, 0.4, 0.6, 0.45], confidence: 0.99 },
            },
          ],
          bbox: [0.1, 0.3, 0.9, 0.5],
        },
      };

      const replacements: ReplacementRule[] = [
        {
          fieldKey: 'lineItems[].itemName',
          aiValue: 'コーピー用紙',
          correctValue: 'コピー用紙',
          count: 3,
        },
        {
          fieldKey: 'lineItems[].quantity',
          aiValue: '1O',
          correctValue: '10',
          count: 5,
        },
      ];

      const result = applyReplacements(extractedData, replacements);

      const lineItems = result.lineItems as { items: Array<Record<string, { value: string; originalValue?: string }>> };
      expect(lineItems.items[0].itemName.value).toBe('コピー用紙');
      expect(lineItems.items[0].itemName.originalValue).toBe('コーピー用紙');
      expect(lineItems.items[0].quantity.value).toBe('10');
      expect(lineItems.items[0].quantity.originalValue).toBe('1O');
      // 2番目の行は補正されない
      expect(lineItems.items[1].quantity.value).toBe('5');
      expect(lineItems.items[1].quantity.originalValue).toBeUndefined();
    });

    it('特定インデックスのルールも適用される', () => {
      const extractedData: ExtractedData = {
        lineItems: {
          items: [
            {
              unitPrice: { value: '1OO', bbox: [0.6, 0.3, 0.7, 0.35], confidence: 0.8 },
            },
          ],
          bbox: [0.1, 0.3, 0.9, 0.5],
        },
      };

      const replacements: ReplacementRule[] = [
        {
          fieldKey: 'lineItems[0].unitPrice',
          aiValue: '1OO',
          correctValue: '100',
          count: 2,
        },
      ];

      const result = applyReplacements(extractedData, replacements);

      const lineItems = result.lineItems as { items: Array<Record<string, { value: string; originalValue?: string }>> };
      expect(lineItems.items[0].unitPrice.value).toBe('100');
      expect(lineItems.items[0].unitPrice.originalValue).toBe('1OO');
    });
  });

  describe('エッジケース', () => {
    it('replacementsが空の場合、元のデータがそのまま返される', () => {
      const extractedData: ExtractedData = {
        total: { value: '1000', bbox: [0, 0, 0, 0], confidence: 0.9 },
      };

      const result = applyReplacements(extractedData, []);

      expect(result).toEqual(extractedData);
    });

    it('replacementsがundefinedの場合、元のデータがそのまま返される', () => {
      const extractedData: ExtractedData = {
        total: { value: '1000', bbox: [0, 0, 0, 0], confidence: 0.9 },
      };

      const result = applyReplacements(extractedData, undefined as unknown as ReplacementRule[]);

      expect(result).toEqual(extractedData);
    });

    it('ログ関数が渡された場合、補正時にログが出力される', () => {
      const extractedData: ExtractedData = {
        amount: { value: '1OO', bbox: [0, 0, 0, 0], confidence: 0.9 },
      };

      const replacements: ReplacementRule[] = [
        { fieldKey: 'amount', aiValue: '1OO', correctValue: '100', count: 3 },
      ];

      const logMessages: string[] = [];
      const mockLogger = { info: (msg: string) => logMessages.push(msg) };

      applyReplacements(extractedData, replacements, mockLogger);

      expect(logMessages.length).toBe(1);
      expect(logMessages[0]).toContain('学習補正適用');
      expect(logMessages[0]).toContain('1OO');
      expect(logMessages[0]).toContain('100');
    });
  });
});

describe('generateLearningInstructions', () => {
  describe('置換ルールの生成', () => {
    it('単一の置換ルールからプロンプト指示を生成する', () => {
      const learning: LearningData = {
        replacements: [
          {
            fieldKey: 'grandTotal',
            aiValue: '1200000',
            correctValue: '120000',
            count: 5,
          },
        ],
      };

      const result = generateLearningInstructions(learning);

      expect(result).toContain('【過去の訂正履歴に基づく補正ルール】');
      expect(result).toContain('grandTotal');
      expect(result).toContain('1200000');
      expect(result).toContain('120000');
      expect(result).toContain('5回');
    });

    it('複数の置換ルールがフィールドごとにグループ化される', () => {
      const learning: LearningData = {
        replacements: [
          { fieldKey: 'companyName', aiValue: '株式会社ABＣ', correctValue: '株式会社ABC', count: 3 },
          { fieldKey: 'companyName', aiValue: '(株)ABC', correctValue: '株式会社ABC', count: 2 },
          { fieldKey: 'taxAmount', aiValue: '10000O', correctValue: '100000', count: 4 },
        ],
      };

      const result = generateLearningInstructions(learning);

      expect(result).toContain('■ フィールド「companyName」:');
      expect(result).toContain('■ フィールド「taxAmount」:');
      expect(result).toContain('株式会社ABＣ');
      expect(result).toContain('(株)ABC');
    });
  });

  describe('位置ヒントの生成', () => {
    it('位置ヒントからプロンプト指示を生成する', () => {
      const learning: LearningData = {
        replacements: [],
        preferredRegions: [
          {
            fieldKey: 'grandTotal',
            region: { x: 0.7, y: 0.8, w: 0.2, h: 0.1 },
            sampleCount: 10,
          },
        ],
      };

      const result = generateLearningInstructions(learning);

      expect(result).toContain('【推奨抽出領域】');
      expect(result).toContain('grandTotal');
      expect(result).toContain('下部');
      expect(result).toContain('右側');
      expect(result).toContain('サンプル数: 10');
    });
  });

  describe('エッジケース', () => {
    it('learningがundefinedの場合、空文字を返す', () => {
      const result = generateLearningInstructions(undefined);
      expect(result).toBe('');
    });

    it('replacementsが空の場合、置換ルールセクションは出力されない', () => {
      const learning: LearningData = {
        replacements: [],
      };

      const result = generateLearningInstructions(learning);

      expect(result).not.toContain('【過去の訂正履歴に基づく補正ルール】');
    });

    it('置換ルールと位置ヒントの両方がある場合、両方が出力される', () => {
      const learning: LearningData = {
        replacements: [
          { fieldKey: 'total', aiValue: '1OO', correctValue: '100', count: 3 },
        ],
        preferredRegions: [
          { fieldKey: 'total', region: { x: 0.8, y: 0.9, w: 0.1, h: 0.05 }, sampleCount: 5 },
        ],
      };

      const result = generateLearningInstructions(learning);

      expect(result).toContain('【過去の訂正履歴に基づく補正ルール】');
      expect(result).toContain('【推奨抽出領域】');
    });
  });
});

describe('getPositionDescription', () => {
  it('右下の領域を正しく説明する', () => {
    const result = getPositionDescription(0.7, 0.8, 0.2, 0.1);
    expect(result).toContain('下部');
    expect(result).toContain('右側');
  });

  it('左上の領域を正しく説明する', () => {
    const result = getPositionDescription(0.1, 0.1, 0.1, 0.1);
    expect(result).toContain('上部');
    expect(result).toContain('左側');
  });

  it('中央の領域を正しく説明する', () => {
    const result = getPositionDescription(0.4, 0.4, 0.2, 0.2);
    expect(result).toContain('中央');
  });

  it('座標がパーセント表記で含まれる', () => {
    const result = getPositionDescription(0.5, 0.5, 0.1, 0.1);
    expect(result).toContain('x=50%');
    expect(result).toContain('y=50%');
  });
});

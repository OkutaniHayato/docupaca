/**
 * テスト用学習データ投入スクリプト
 *
 * 使用方法:
 * 1. Firebase Admin SDKの認証情報を設定
 *    - サービスアカウントキーを使用する場合:
 *      export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
 *    - Firebase Emulatorを使用する場合:
 *      export FIRESTORE_EMULATOR_HOST="localhost:8080"
 *
 * 2. スクリプトを実行:
 *    npx ts-node scripts/seed-test-learning-data.ts <template_id>
 *
 * 例:
 *    npx ts-node scripts/seed-test-learning-data.ts abc123
 */

import * as admin from 'firebase-admin';

// Firebase Admin初期化
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

interface ReplacementRule {
  fieldKey: string;
  aiValue: string;
  correctValue: string;
  count: number;
  updatedAt: admin.firestore.Timestamp;
}

interface PreferredRegion {
  fieldKey: string;
  region: { x: number; y: number; w: number; h: number };
  sampleCount: number;
  updatedAt: admin.firestore.Timestamp;
}

interface LearningData {
  replacements: ReplacementRule[];
  preferredRegions: PreferredRegion[];
  lastLearnedAt: admin.firestore.Timestamp;
}

/**
 * サンプルの学習データを生成
 */
function generateSampleLearningData(): LearningData {
  const now = admin.firestore.Timestamp.now();

  return {
    replacements: [
      // よくあるOCRミス: 数字の0とアルファベットのO
      {
        fieldKey: 'grandTotal',
        aiValue: '1200000',
        correctValue: '120000',
        count: 5,
        updatedAt: now,
      },
      {
        fieldKey: 'taxAmount',
        aiValue: '10000O',  // Oが混入
        correctValue: '100000',
        count: 4,
        updatedAt: now,
      },
      // 全角・半角の混在
      {
        fieldKey: 'companyName',
        aiValue: '株式会社ABＣ',  // 全角C
        correctValue: '株式会社ABC',
        count: 3,
        updatedAt: now,
      },
      {
        fieldKey: 'companyName',
        aiValue: '(株)ABC',
        correctValue: '株式会社ABC',
        count: 2,
        updatedAt: now,
      },
      // 配列フィールドの例
      {
        fieldKey: 'lineItems[].itemName',
        aiValue: 'コーピー用紙',  // 誤読
        correctValue: 'コピー用紙',
        count: 3,
        updatedAt: now,
      },
      {
        fieldKey: 'lineItems[].quantity',
        aiValue: '1O',  // 10をlOと誤読
        correctValue: '10',
        count: 5,
        updatedAt: now,
      },
      {
        fieldKey: 'lineItems[].unitPrice',
        aiValue: '1,OOO',  // カンマ後の0がO
        correctValue: '1,000',
        count: 4,
        updatedAt: now,
      },
    ],
    preferredRegions: [
      // 合計金額は通常右下にある
      {
        fieldKey: 'grandTotal',
        region: { x: 0.7, y: 0.8, w: 0.25, h: 0.1 },
        sampleCount: 10,
        updatedAt: now,
      },
      // 請求書番号は通常右上にある
      {
        fieldKey: 'invoiceNumber',
        region: { x: 0.6, y: 0.1, w: 0.3, h: 0.08 },
        sampleCount: 8,
        updatedAt: now,
      },
      // 発行日は通常右上にある
      {
        fieldKey: 'invoiceDate',
        region: { x: 0.6, y: 0.15, w: 0.3, h: 0.05 },
        sampleCount: 7,
        updatedAt: now,
      },
      // 会社名は通常左上にある
      {
        fieldKey: 'companyName',
        region: { x: 0.05, y: 0.05, w: 0.4, h: 0.1 },
        sampleCount: 12,
        updatedAt: now,
      },
    ],
    lastLearnedAt: now,
  };
}

/**
 * テンプレートに学習データを追加
 */
async function seedLearningData(templateId: string): Promise<void> {
  console.log(`\n📚 テスト用学習データを投入中...\n`);
  console.log(`対象テンプレートID: ${templateId}`);

  // テンプレートの存在確認
  const templateRef = db.collection('ocr_settings').doc(templateId);
  const templateDoc = await templateRef.get();

  if (!templateDoc.exists) {
    console.error(`\n❌ エラー: テンプレートが見つかりません (ID: ${templateId})`);
    console.log('\n利用可能なテンプレート一覧:');

    const templates = await db.collection('ocr_settings').get();
    if (templates.empty) {
      console.log('  (テンプレートがありません)');
    } else {
      templates.docs.forEach(doc => {
        const data = doc.data();
        console.log(`  - ${doc.id}: ${data.name || '(名前なし)'}`);
      });
    }
    process.exit(1);
  }

  const templateData = templateDoc.data();
  console.log(`テンプレート名: ${templateData?.name || '(名前なし)'}`);

  // 学習データを生成
  const learningData = generateSampleLearningData();

  // テンプレートを更新
  await templateRef.update({
    learning: learningData,
  });

  console.log(`\n✅ 学習データを投入しました！\n`);
  console.log('投入された置換ルール:');
  learningData.replacements.forEach(rule => {
    console.log(`  - ${rule.fieldKey}: "${rule.aiValue}" → "${rule.correctValue}" (${rule.count}回)`);
  });

  console.log('\n投入された位置ヒント:');
  learningData.preferredRegions.forEach(region => {
    const pos = region.region;
    console.log(`  - ${region.fieldKey}: x=${(pos.x * 100).toFixed(0)}%, y=${(pos.y * 100).toFixed(0)}% (${region.sampleCount}サンプル)`);
  });

  console.log('\n🔍 検証方法:');
  console.log('1. このテンプレートでOCRを実行');
  console.log('2. Cloud Functionsのログで以下を確認:');
  console.log('   - "学習データ適用: X個の置換ルール, Y個の位置ヒント"');
  console.log('   - "学習補正適用: fieldKey ..." (補正が適用された場合)');
}

/**
 * 学習データをクリア
 */
async function clearLearningData(templateId: string): Promise<void> {
  console.log(`\n🧹 学習データをクリア中...\n`);

  const templateRef = db.collection('ocr_settings').doc(templateId);
  const templateDoc = await templateRef.get();

  if (!templateDoc.exists) {
    console.error(`❌ テンプレートが見つかりません (ID: ${templateId})`);
    process.exit(1);
  }

  await templateRef.update({
    learning: admin.firestore.FieldValue.delete(),
  });

  console.log(`✅ テンプレート ${templateId} の学習データをクリアしました`);
}

/**
 * 全テンプレートの学習データ状況を表示
 */
async function listLearningStatus(): Promise<void> {
  console.log(`\n📋 テンプレートの学習データ状況\n`);

  const templates = await db.collection('ocr_settings').get();

  if (templates.empty) {
    console.log('テンプレートがありません');
    return;
  }

  for (const doc of templates.docs) {
    const data = doc.data();
    const learning = data.learning as LearningData | undefined;

    const replacementCount = learning?.replacements?.length || 0;
    const regionCount = learning?.preferredRegions?.length || 0;
    const hasLearning = replacementCount > 0 || regionCount > 0;

    console.log(`${hasLearning ? '✅' : '⬜'} ${doc.id}`);
    console.log(`   名前: ${data.name || '(名前なし)'}`);
    if (hasLearning) {
      console.log(`   置換ルール: ${replacementCount}個, 位置ヒント: ${regionCount}個`);
      if (learning?.lastLearnedAt) {
        const date = learning.lastLearnedAt.toDate();
        console.log(`   最終学習: ${date.toLocaleString('ja-JP')}`);
      }
    }
    console.log('');
  }
}

// メイン処理
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`
テスト用学習データ投入スクリプト

使用方法:
  npx ts-node scripts/seed-test-learning-data.ts <command> [options]

コマンド:
  seed <template_id>    指定したテンプレートにテスト用学習データを投入
  clear <template_id>   指定したテンプレートの学習データをクリア
  list                  全テンプレートの学習データ状況を表示

例:
  npx ts-node scripts/seed-test-learning-data.ts seed abc123
  npx ts-node scripts/seed-test-learning-data.ts clear abc123
  npx ts-node scripts/seed-test-learning-data.ts list

環境変数:
  GOOGLE_APPLICATION_CREDENTIALS  サービスアカウントキーのパス
  FIRESTORE_EMULATOR_HOST         Firestoreエミュレータのホスト
`);
    process.exit(0);
  }

  try {
    switch (command) {
      case 'seed':
        if (!args[1]) {
          console.error('❌ テンプレートIDを指定してください');
          process.exit(1);
        }
        await seedLearningData(args[1]);
        break;

      case 'clear':
        if (!args[1]) {
          console.error('❌ テンプレートIDを指定してください');
          process.exit(1);
        }
        await clearLearningData(args[1]);
        break;

      case 'list':
        await listLearningStatus();
        break;

      default:
        console.error(`❌ 不明なコマンド: ${command}`);
        console.log('--help でヘルプを表示');
        process.exit(1);
    }
  } catch (error) {
    console.error('エラーが発生しました:', error);
    process.exit(1);
  }

  process.exit(0);
}

main();

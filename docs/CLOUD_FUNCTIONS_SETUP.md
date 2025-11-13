# Cloud Functions セットアップガイド

Docupacaでは、OCR実行処理をFirebase Cloud Functions v2で実装しています。

## 概要

### executeOcr関数

OCR設定に基づいて、Cloud Storageの画像/PDFファイルからデータを抽出するCallable Function。

**主な機能:**
- Firestore (`ocr_settings`) から設定を読み込み
- Cloud Storageからファイルをダウンロード
- Gemini Vision APIで画像/PDF解析
- 抽出結果をFirestore (`ocr_history`) に保存
- エラーハンドリングとステータス管理

## 初回セットアップ

### 1. Firebase プロジェクト設定

Firebase Consoleで以下を有効化:
- Cloud Functions
- Cloud Firestore
- Cloud Storage
- Secret Manager

### 2. Gemini APIキーの取得

1. [Google AI Studio](https://makersuite.google.com/app/apikey) にアクセス
2. 「Create API Key」をクリック
3. APIキーをコピー

### 3. Secret Managerでキーを保存

**方法1: Firebase CLI（推奨）**

\`\`\`bash
# Firebaseにログイン
firebase login

# プロジェクトを選択
firebase use --add

# Secretを作成
firebase functions:secrets:set GEMINI_API_KEY
\`\`\`

プロンプトでGemini APIキーを入力してEnter。

**方法2: Google Cloud Console**

1. [Secret Manager](https://console.cloud.google.com/security/secret-manager) を開く
2. プロジェクトを選択
3. 「シークレットを作成」
4. 名前: `GEMINI_API_KEY`
5. シークレット値: コピーしたAPIキー
6. 「シークレットを作成」

### 4. Cloud Functionsの権限設定

デフォルトのサービスアカウントに以下の権限が必要:
- **Cloud Datastore User** (Firestoreアクセス)
- **Storage Object Viewer** (Cloud Storageからの読み取り)
- **Secret Manager Secret Accessor** (Secret Manager)

通常、Cloud Functionsのデプロイ時に自動的に設定されます。

### 5. 依存関係のインストール

\`\`\`bash
cd functions
npm install
\`\`\`

### 6. ビルド

\`\`\`bash
npm run build
\`\`\`

## デプロイ

### 初回デプロイ

\`\`\`bash
# functionsディレクトリから
cd functions
npm run deploy

# または、プロジェクトルートから
firebase deploy --only functions
\`\`\`

デプロイには数分かかります。

### 更新デプロイ

コードを変更後:

\`\`\`bash
npm run build
npm run deploy
\`\`\`

## ローカル開発

### エミュレータの起動

\`\`\`bash
# プロジェクトルートで
firebase emulators:start

# またはfunctions/で
npm run serve
\`\`\`

エミュレータが起動すると:
- Functions: http://localhost:5001
- Firestore: http://localhost:8080
- Storage: http://localhost:9199
- UI: http://localhost:4000

### ローカル環境でのGemini APIキー設定

\`functions/.env\`ファイルを作成:

\`\`\`
GEMINI_API_KEY=your_gemini_api_key_here
\`\`\`

**重要:** `.env`ファイルは`.gitignore`に含まれているため、リポジトリにコミットされません。

## クライアントからの呼び出し

### TypeScript/JavaScript

\`\`\`typescript
import { getFunctions, httpsCallable } from 'firebase/functions';

// Functionsインスタンスを取得
const functions = getFunctions();

// executeOcr関数を呼び出し
const executeOcr = httpsCallable(functions, 'executeOcr');

async function runOcr(settingId: string, filePath: string, userId: string) {
  try {
    const result = await executeOcr({
      setting_id: settingId,
      file_path: filePath,
      user_id: userId,
    });

    console.log('OCR成功:', result.data);
    return result.data;
  } catch (error) {
    console.error('OCRエラー:', error);
    throw error;
  }
}

// 使用例
runOcr('setting_abc123', 'uploads/invoice.pdf', 'user_xyz789');
\`\`\`

### リクエストパラメータ

| パラメータ | 型 | 必須 | 説明 |
|-----------|---|-----|-----|
| setting_id | string | ✅ | OCR設定のドキュメントID |
| file_path | string | ✅ | Cloud Storage上のファイルパス |
| user_id | string | ✅ | 実行ユーザーID |

### レスポンス

**成功時:**

\`\`\`json
{
  "success": true,
  "history_id": "history_doc_id",
  "extracted_data": {
    "invoiceNumber": {
      "value": "INV-2024-001",
      "bbox": [100, 50, 300, 70]
    },
    "totalAmount": {
      "value": "50000",
      "bbox": [400, 200, 500, 220]
    }
  }
}
\`\`\`

**エラー時:**

\`\`\`json
{
  "code": "invalid-argument",
  "message": "必須パラメータが不足しています: setting_id, file_path, user_id"
}
\`\`\`

## モニタリング

### ログの確認

**Firebase CLI:**

\`\`\`bash
firebase functions:log
\`\`\`

**Google Cloud Console:**

https://console.cloud.google.com/logs

フィルター例:
\`\`\`
resource.type="cloud_function"
resource.labels.function_name="executeOcr"
\`\`\`

### エラー監視

Cloud Logsでエラーを検索:

\`\`\`
severity>=ERROR
resource.type="cloud_function"
\`\`\`

## トラブルシューティング

### 1. Secret Manager エラー

**エラー:** `GEMINI_API_KEYが設定されていません`

**解決策:**
\`\`\`bash
# Secretが存在するか確認
firebase functions:secrets:access GEMINI_API_KEY

# 存在しない場合は作成
firebase functions:secrets:set GEMINI_API_KEY
\`\`\`

### 2. 権限エラー

**エラー:** `Permission denied`

**解決策:**
- Cloud Functions サービスアカウントに必要な権限があるか確認
- IAMページで`[PROJECT_ID]@appspot.gserviceaccount.com`を検索

### 3. タイムアウトエラー

**エラー:** `Function execution took too long`

**解決策:**
`functions/src/index.ts`でタイムアウトを延長:

\`\`\`typescript
export const executeOcr = functions.https.onCall(
  {
    timeoutSeconds: 540, // 最大9分
    // ...
  },
  // ...
);
\`\`\`

### 4. メモリ不足エラー

**エラー:** `Memory limit exceeded`

**解決策:**
メモリを増やす:

\`\`\`typescript
export const executeOcr = functions.https.onCall(
  {
    memory: '2GiB', // 1GB → 2GB
    // ...
  },
  // ...
);
\`\`\`

### 5. Firestore権限エラー

**エラー:** `Missing or insufficient permissions`

**解決策:**
- `firestore.rules`を確認
- テスト時は以下で全許可（本番では使用しない）:

\`\`\`
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true; // テスト用のみ
    }
  }
}
\`\`\`

## セキュリティベストプラクティス

### 1. 認証チェックを有効化

\`functions/src/index.ts\`で認証チェックを実装済み:

\`\`\`typescript
if (request.auth?.uid !== user_id) {
  throw new functions.https.HttpsError(
    'unauthenticated',
    '認証エラー: ユーザーIDが一致しません'
  );
}
\`\`\`

### 2. OCR設定の所有者確認

設定のowner_idと実行ユーザーを照合:

\`\`\`typescript
if (setting.owner_id !== user_id) {
  throw new functions.https.HttpsError(
    'permission-denied',
    'この設定を使用する権限がありません'
  );
}
\`\`\`

### 3. Firestore Rulesで保護

\`firestore.rules\`:

\`\`\`
match /ocr_settings/{settingId} {
  allow read, write: if request.auth != null && request.auth.uid == resource.data.owner_id;
}

match /ocr_history/{historyId} {
  allow read: if request.auth != null;
  allow write: if false; // Cloud Functionsからのみ書き込み可
}
\`\`\`

## 費用の見積もり

### Cloud Functions

- **呼び出し**: 200万回/月まで無料、それ以降 $0.40/100万回
- **コンピューティング時間**: 40万GB秒/月まで無料
  - 1GB、10秒実行: 1回あたり約 $0.0000025

### Gemini API

- **gemini-2.5-flash-lite**: 無料枠内で十分（制限あり）
- **gemini-2.5-flash**: $0.075/1000リクエスト（画像）
- **gemini-2.5-pro**: $0.25/1000リクエスト（画像）

### Cloud Storage

- **ダウンロード**: 5GB/月まで無料、それ以降 $0.12/GB

## 参考リンク

- [Firebase Cloud Functions ドキュメント](https://firebase.google.com/docs/functions)
- [Cloud Functions v2](https://firebase.google.com/docs/functions/beta-v2)
- [Gemini API ドキュメント](https://ai.google.dev/docs)
- [Secret Manager](https://cloud.google.com/secret-manager/docs)

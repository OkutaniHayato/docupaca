# Docupaca Firebase Cloud Functions

Firebase Cloud Functions v2を使用したOCR実行機能。

## 機能

### `executeOcr`
OCR設定を使用して、Cloud Storageに保存された画像/PDFファイルからデータを抽出します。

**リクエストパラメータ:**
- `setting_id`: OCR設定ID (ocr_settingsコレクションのドキュメントID)
- `file_path`: Cloud Storage上のファイルパス
- `user_id`: 実行ユーザーID

**処理フロー:**
1. `ocr_history`コレクションに初期レコードを作成（status: processing）
2. `ocr_settings`から設定を読み込み
3. Cloud Storageからファイルをダウンロード
4. Gemini APIで画像/PDF解析
5. 抽出結果を`ocr_history`に保存（status: completed/failed）

**レスポンス:**
```json
{
  "success": true,
  "history_id": "履歴ID",
  "extracted_data": {
    "fieldName": {
      "value": "抽出値",
      "bbox": [x1, y1, x2, y2]
    }
  }
}
```

## セットアップ

### 1. 依存関係のインストール

\`\`\`bash
cd functions
npm install
\`\`\`

### 2. Gemini APIキーの設定

**ローカル開発環境:**

\`.env\`ファイルを作成:
\`\`\`bash
GEMINI_API_KEY=your_gemini_api_key_here
\`\`\`

**本番環境（Firebase Secret Manager）:**

Firebase CLIでSecretを作成:
\`\`\`bash
firebase functions:secrets:set GEMINI_API_KEY
\`\`\`

プロンプトに従ってAPIキーを入力してください。

または、Google Cloud Consoleから:
1. [Secret Manager](https://console.cloud.google.com/security/secret-manager)を開く
2. 「シークレットを作成」をクリック
3. 名前: `GEMINI_API_KEY`
4. シークレット値: Gemini APIキー
5. 「シークレットを作成」

### 3. ビルド

\`\`\`bash
npm run build
\`\`\`

### 4. エミュレータでテスト（ローカル）

\`\`\`bash
npm run serve
\`\`\`

エミュレータが起動後、Firebase Consoleまたはクライアントアプリから関数を呼び出せます。

### 5. デプロイ

\`\`\`bash
npm run deploy
\`\`\`

または、プロジェクトルートから:
\`\`\`bash
firebase deploy --only functions
\`\`\`

## クライアントからの呼び出し例

\`\`\`typescript
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions();
const executeOcr = httpsCallable(functions, 'executeOcr');

try {
  const result = await executeOcr({
    setting_id: 'your_setting_id',
    file_path: 'uploads/sample.pdf',
    user_id: 'user123',
  });

  console.log('OCR実行成功:', result.data);
} catch (error) {
  console.error('OCR実行エラー:', error);
}
\`\`\`

## 環境設定

### Firebase Functions v2の設定

- **リージョン**: `asia-northeast1`
- **タイムアウト**: 540秒（9分）
- **メモリ**: 1GB
- **Node.jsバージョン**: 20

### 必要な権限

Cloud Functionsに以下の権限が必要です:
- Firestore読み書き
- Cloud Storage読み取り
- Secret Managerアクセス

## エラーハンドリング

関数は以下のエラーをスロー:
- `invalid-argument`: 必須パラメータが不足
- `unauthenticated`: 認証エラー
- `permission-denied`: 権限エラー
- `internal`: その他のエラー

エラー発生時、`ocr_history`のstatusは`failed`に更新され、`error_message`フィールドにエラー内容が記録されます。

## ログ確認

\`\`\`bash
npm run logs
\`\`\`

または:
\`\`\`bash
firebase functions:log
\`\`\`

Google Cloud Consoleからも確認可能:
https://console.cloud.google.com/logs

## トラブルシューティング

### Gemini APIキーエラー

Secret Managerが正しく設定されているか確認:
\`\`\`bash
firebase functions:secrets:access GEMINI_API_KEY
\`\`\`

### タイムアウトエラー

大きなファイルや複雑な処理の場合、タイムアウトを延長:
\`\`\`typescript
timeoutSeconds: 540, // 最大9分
\`\`\`

### メモリ不足エラー

メモリを増やす:
\`\`\`typescript
memory: '2GiB', // 1GB → 2GB
\`\`\`

## 開発コマンド

- `npm run build`: TypeScriptをビルド
- `npm run serve`: エミュレータでローカル実行
- `npm run deploy`: 本番環境にデプロイ
- `npm run logs`: ログを表示

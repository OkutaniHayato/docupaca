# OCR設定の自動生成機能とCloud Functions実装

## 📋 概要

このPRでは、PDFまたは画像をアップロードするだけでAIが帳票を解析し、OCR設定を自動生成する機能を実装しました。また、Firebase Cloud Functions v2を使用したOCR実行機能も追加されています。

## ✨ 主要な機能

### 1. OCR設定の自動生成（AI解析）

- **Gemini Vision API**を使用して帳票画像/PDFを解析
- 帳票の種類を自動識別（請求書、納品書、領収書など）
- 抽出すべき項目を自動検出（5-15個）
- フィールド名は英語キャメルケース、説明は日本語で生成

**自動生成される内容:**
- 設定名（帳票名から生成）
- 抽出指示（全体的な抽出方針）
- 抽出フィールド（項目名と抽出指示の詳細）

### 2. Firebase Cloud Functions v2 - OCR実行機能

- **Callable Function**: `executeOcr`
- Cloud StorageからファイルをダウンロードしてGemini APIで処理
- Firestoreに実行履歴を保存
- エラーハンドリングと詳細なログ記録

### 3. PDFプレビュー機能

- A4サイズ（842px高さ）で縦長表示
- ブラウザのネイティブPDFビューアーを使用
- react-pdfとNext.js 16の互換性問題を回避

## 🔧 技術的な変更

### フロントエンド

**新規ファイル:**
- `src/app/api/analyze-document/route.ts` - AI解析APIエンドポイント
- `src/components/PdfPreview.tsx` - PDFプレビューコンポーネント

**変更ファイル:**
- `src/app/dashboard/settings/OcrSettingForm.tsx`
  - AIボタンを右上ヘッダーに配置
  - AI解析中の状態表示（スピナーアニメーション）
  - 解析結果の自動入力処理

**依存関係:**
- `@google/generative-ai`: Gemini API SDK
- `pdf-lib`: PDF処理ライブラリ

### バックエンド (Cloud Functions)

**新規ディレクトリ:**
- `functions/` - Cloud Functions v2プロジェクト
  - `src/index.ts` - executeOcr関数
  - `package.json` - 依存関係
  - `tsconfig.json` - TypeScript設定

**主要機能:**
- Secret Managerを使用したAPIキー管理
- 認証・権限チェック
- ステータス管理（processing → completed/failed）
- 詳細なエラーログ

### 設定ファイル

**`next.config.ts`:**
```typescript
experimental: {
  serverComponentsExternalPackages: [
    '@google/generative-ai',
    'pdf-lib',
  ],
}
```

**`firebase.json`:**
```json
"functions": [{
  "source": "functions",
  "codebase": "default"
}]
```

## 🚀 使用方法

### 1. 環境変数の設定

`.env.local`に以下を追加:
```bash
GEMINI_API_KEY=your_gemini_api_key_here
```

Gemini APIキーは[Google AI Studio](https://makersuite.google.com/app/apikey)で取得できます。

### 2. フロントエンド（OCR設定自動生成）

1. OCR設定の新規作成画面を開く
2. PDFまたは画像ファイルをアップロード
3. 右上の「AIで自動生成」ボタンをクリック
4. AI解析が完了すると、フォームに自動入力される
5. 必要に応じて手動で調整して保存

### 3. バックエンド（Cloud Functions）

**デプロイ:**
```bash
cd functions
npm install
npm run build
cd ..
firebase deploy --only functions
```

**Secret Manager設定:**
```bash
firebase functions:secrets:set GEMINI_API_KEY
```

詳細は`docs/CLOUD_FUNCTIONS_SETUP.md`を参照してください。

## 📸 スクリーンショット

（実際のスクリーンショットを追加してください）

- OCR設定画面（PDFプレビュー + AIボタン）
- AI解析中の状態
- 自動生成された設定の例

## 🧪 テスト方法

### フロントエンド

1. 開発サーバーを起動
```bash
npm run dev
```

2. `http://localhost:3000/dashboard/settings/new`にアクセス

3. サンプルPDFをアップロードして「AIで自動生成」をテスト

### Cloud Functions

1. エミュレータで動作確認
```bash
firebase emulators:start
```

2. クライアントから`executeOcr`を呼び出し
```typescript
const executeOcr = httpsCallable(functions, 'executeOcr');
const result = await executeOcr({
  setting_id: 'test_setting_id',
  file_path: 'uploads/test.pdf',
  user_id: 'test_user_id',
});
```

## 🐛 修正した問題

### Next.js 16との互換性

1. **react-pdf問題**
   - エラー: `Object.defineProperty called on non-object`
   - 解決: ブラウザのネイティブPDFビューアー（iframe）に変更
   - 詳細: `docs/PDF_PREVIEW_SOLUTION.md`

2. **API Routeモジュール解決**
   - エラー: `Cannot find module '@google/generative-ai'`
   - 解決: `serverComponentsExternalPackages`に追加

3. **動的インポート**
   - API RouteでGemini APIとpdf-libを動的にインポート

## 📚 ドキュメント

新規追加されたドキュメント:
- `functions/README.md` - Cloud Functions概要とコマンド
- `functions/DEPLOY_GUIDE.md` - デプロイ手順
- `docs/CLOUD_FUNCTIONS_SETUP.md` - 詳細なセットアップガイド
- `docs/PDF_PREVIEW_SOLUTION.md` - PDFプレビュー実装の経緯

## ⚠️ 注意事項

### 必須の設定

1. **Gemini APIキー**
   - ローカル: `.env.local`に`GEMINI_API_KEY`を設定
   - 本番: Secret Managerに設定

2. **Firebase設定**
   - Cloud Functions API有効化
   - Cloud Build API有効化
   - Secret Manager権限

### 制限事項

1. **PDFプレビュー**
   - ページ数の取得不可（ブラウザネイティブビューアー使用のため）
   - 1ページ目のみプレビュー

2. **Gemini API**
   - `gemini-2.0-flash-exp`モデルを使用（実験版）
   - レート制限あり（無料枠の場合）

3. **バンドルサイズ**
   - `@google/generative-ai`: 約500KB
   - `pdf-lib`: 約1MB

## 🔄 マイグレーション

既存データへの影響はありません。新機能の追加のみです。

## 📝 チェックリスト

- [x] TypeScriptコンパイルエラーなし
- [x] ESLint警告なし
- [x] ローカルでの動作確認
- [x] Cloud Functionsビルド成功
- [x] ドキュメント作成
- [ ] 本番環境でのテスト
- [ ] スクリーンショット追加

## 🎯 今後の改善案

1. **PDF.js直接使用**
   - ページ数取得
   - カスタムレンダリング
   - 詳細: `docs/PDF_PREVIEW_SOLUTION.md`

2. **Gemini APIモデル選択**
   - ユーザーがモデルを選択可能に
   - コスト vs 精度のトレードオフ

3. **バッチ処理**
   - 複数ファイルの一括解析
   - 進捗表示

4. **キャッシュ機能**
   - 同じファイルの再解析を避ける
   - コスト削減

## 🔗 関連リンク

- [Gemini API Documentation](https://ai.google.dev/docs)
- [Firebase Cloud Functions v2](https://firebase.google.com/docs/functions/beta-v2)
- [Next.js 16 Documentation](https://nextjs.org/docs)

---

**レビュー担当者へ:**
- `.env.local`の設定が必要です
- 実際のPDFファイルでテストしてください
- Cloud Functionsのデプロイは任意です（ローカルテストのみでもOK）

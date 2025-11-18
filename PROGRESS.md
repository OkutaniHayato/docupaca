# Docupaca 開発進捗状況

最終更新日: 2025-11-18

## プロジェクト概要

Docupacaは、AI（Google Gemini）を活用したOCR（光学文字認識）サービスです。請求書、納品書、領収書などの帳票から、ユーザーが定義したフィールドを自動的に抽出し、構造化されたデータとして出力します。

---

## 実装済み機能一覧

### 1. 認証・ユーザー管理機能

#### ユーザー登録
- **実装場所**: `src/app/signup/page.tsx`
- メールアドレスとパスワードでの新規登録
- Firebase Authenticationによる認証

#### ログイン/ログアウト
- **実装場所**: `src/app/login/page.tsx`
- メールアドレス・パスワード認証
- ログアウト機能

#### 認証ガード
- **実装場所**: `src/components/AuthGuard.tsx`
- 未認証ユーザーのアクセス制限
- 自動リダイレクト

---

### 2. OCR設定管理機能

#### OCR設定一覧表示
- **実装場所**: `src/app/dashboard/settings/page.tsx`
- ユーザーごとのOCR設定を表示
- 設定名、使用モデル、作成日の表示
- 設定名クリックで編集画面へ遷移

#### OCR設定新規作成
- **実装場所**: `src/app/dashboard/settings/new/page.tsx`
- 設定名、使用AIモデルの選択
- 抽出指示（プロンプト）の入力
- 抽出フィールドの手動追加・編集・削除
- **配列フィールド（繰り返し項目）対応**
  - 単一値フィールド（`type: 'single'`）
  - 配列フィールド（`type: 'array'`）と子フィールド
  - 階層的なフィールド構造の管理
- サンプルファイル（画像/PDF）のアップロードとプレビュー
- **AI自動生成機能**: アップロードした帳票からOCR設定を自動生成
  - 単一値フィールドの自動生成
  - **配列フィールドの自動生成対応**（明細行、商品一覧など）

#### OCR設定編集
- **実装場所**: `src/app/dashboard/settings/edit/[id]/page.tsx`
- 既存設定の編集
- サンプルファイルの変更

#### OCR設定削除
- 確認ダイアログ付き削除機能

#### レイアウト切り替え
- フォームとプレビューの左右レイアウト切り替え

---

### 3. OCR実行・履歴管理機能

#### OCR実行
- **実装場所**: `src/app/dashboard/history/page.tsx`
- モーダルからOCR設定を選択
- 帳票ファイル（PDF/画像）のアップロード
- Firebase Cloud Functionsでの非同期処理
- リアルタイムステータス表示（処理中/完了/失敗）

#### 実行履歴一覧表示
- ステータス別表示（処理中/完了/失敗）
- ファイル名、設定名、実行日時の表示
- アニメーション付きステータスアイコン

#### 履歴詳細表示
- **実装場所**: `src/app/dashboard/history/view/[id]/page.tsx`
- 抽出結果のテーブル表示
  - 単一値フィールドの表示
  - **配列フィールド（繰り返し項目）の表形式表示**
- 元画像/PDFのプレビュー
- **バウンディングボックスのハイライト表示**（抽出箇所の可視化）
- CSVエクスポート（ヘッダーあり/なし）

---

### 4. APIキー管理・外部連携機能

#### APIキー発行・管理
- **実装場所**: `src/app/dashboard/apikeys/page.tsx`
- SHA-256ハッシュによる安全な保存
- APIキープレフィックスの表示
- キーの削除機能
- 生成時のみ完全なキーを表示（セキュリティ対応）

#### API連携情報の提供
- Cloud FunctionsエンドポイントURLの表示
- cURL使用例（Linux/Mac向け）
- Google Apps Script使用例
- コード例のコピー機能

#### 外部API (HTTP Endpoint)
- **実装場所**: `functions/src/index.ts:383`
- APIキー認証
- Base64エンコードされたファイルの受信
- OCR処理の実行
- 抽出結果のJSON返却（配列フィールド対応）

---

### 5. AI機能

#### Gemini Vision APIによるOCR処理
- **実装場所**: `functions/src/index.ts`
- PDF/画像ファイルのテキスト抽出
- カスタムプロンプトによる柔軟な抽出
- バウンディングボックス座標の取得
- モデル選択対応（Gemini 2.5 Flash-Lite/Flash/Pro）
- **配列フィールド抽出対応**
  - 繰り返し項目の自動認識と抽出
  - 階層的データ構造の生成

#### 帳票自動解析機能
- **実装場所**: `src/app/api/analyze-document/route.ts`
- アップロードした帳票から自動的にOCR設定を生成
- 帳票種類の識別
- 抽出フィールドの自動提案
  - 単一値フィールドの提案
  - **配列フィールド（繰り返し項目）の提案**
- 抽出指示の自動生成

#### PDF→画像変換
- **実装場所**: `functions/src/index.ts:51`
- pdf.jsとCanvasによるPDF→PNG変換
- Sharpによる画像最適化
- 変換画像のCloud Storage保存

---

### 6. ダッシュボード機能

#### サイドバーナビゲーション
- **実装場所**: `src/app/dashboard/SidebarNav.tsx`
- ダッシュボード、OCR設定、実行履歴、APIキーへのナビゲーション
- アクティブページのハイライト表示
- Lucide Reactアイコン使用

#### ユーザーメニュー
- **実装場所**: `src/app/dashboard/UserMenu.tsx`
- ユーザー情報の表示
- ログアウト機能

#### トップページ
- **実装場所**: `src/app/dashboard/page.tsx`
- OCR設定一覧のプレビュー
- 最近の実行履歴の表示

---

### 7. ストレージ・データベース機能

#### Firestore コレクション
- `ocr_settings`: OCR設定の保存
- `ocr_history`: OCR実行履歴の保存
- `api_keys`: APIキーのハッシュ保存

#### Cloud Storage
- サンプルファイルの保存
- 実行時のファイル保存
- 変換後の画像保存

---

### 8. UI/UX機能

#### レスポンシブデザイン
- Tailwind CSSによるモダンなUI
- モバイル/タブレット/デスクトップ対応

#### PDFプレビュー
- **実装場所**: `src/components/PdfPreview.tsx`
- react-pdfによるPDFプレビュー
- 動的インポートによるSSR対応

#### モーダルダイアログ
- OCR実行モーダル
- APIキー生成モーダル

#### カラーテーマ
- グリーン系のプライマリカラー
- ステータスカラー（成功/エラー/処理中）

---

### 9. Cloud Functions (バックエンド)

#### executeOcr
- **実装場所**: `functions/src/index.ts:159`
- Callable Function（認証済みユーザー向け）
- OCR処理の実行
- 履歴の作成・更新
- **配列フィールド抽出対応**

#### ocrApi
- **実装場所**: `functions/src/index.ts:383`
- HTTP Endpoint（外部API連携用）
- APIキー認証
- CORS対応
- **配列フィールド抽出対応**

---

## 技術スタック

### フロントエンド
- **フレームワーク**: Next.js 16
- **UIライブラリ**: React 19
- **言語**: TypeScript
- **スタイリング**: Tailwind CSS
- **PDFレンダリング**: react-pdf, pdfjs-dist
- **アイコン**: Lucide React

### バックエンド
- **サーバーレス**: Firebase Cloud Functions (Node.js)
- **データベース**: Cloud Firestore
- **ストレージ**: Cloud Storage
- **認証**: Firebase Authentication

### AI/機械学習
- **OCRエンジン**: Google Gemini 2.5 Vision API
  - Gemini 2.5 Flash-Lite（推奨）
  - Gemini 2.5 Flash（高性能）
  - Gemini 2.5 Pro（最高性能）

### PDF/画像処理
- **PDFライブラリ**: pdf-lib, pdfjs-dist
- **Canvas**: @napi-rs/canvas
- **画像最適化**: Sharp

---

## 主要な型定義

### ExtractionField (抽出フィールド定義)
```typescript
interface ExtractionField {
  name: string;                    // フィールド名（キャメルケース）
  instruction: string;             // 抽出指示
  type: 'single' | 'array';       // フィールドタイプ
  children?: ExtractionField[];   // 子フィールド（配列の場合）
}
```

### ExtractedData (抽出データ)
```typescript
// 単一値
interface ExtractedValue {
  value: string;
  bbox: [number, number, number, number];
}

// 配列データ
interface ExtractedArrayData {
  items: Array<{
    [childFieldName: string]: ExtractedValue;
  }>;
  bbox?: [number, number, number, number];
}

type ExtractedData = {
  [fieldName: string]: ExtractedValue | ExtractedArrayData;
};
```

---

## 最近の主要アップデート

### 2025-11-18: 配列フィールド（繰り返し項目）の自動生成対応
- AI自動生成機能で配列フィールドも生成可能に
- 請求書の明細行、見積書の商品一覧など、繰り返し項目を含む帳票に対応
- フロントエンド側で子フィールドを再帰的に正規化する処理を実装

### 以前の実装
- ネスト（親子）データの抽出機能
- バウンディングボックスのハイライト表示
- 配列フィールドの手動設定機能
- 外部API連携機能

---

## 今後の開発予定

### 短期
- [ ] エラーハンドリングの強化
- [ ] バリデーション機能の追加
- [ ] ユーザーフィードバック機能

### 中期
- [ ] バッチ処理機能（複数ファイルの一括OCR）
- [ ] テンプレート機能（よく使う設定の共有）
- [ ] 抽出精度の向上（後処理ロジック）

### 長期
- [ ] 他のOCRエンジンとの連携
- [ ] 帳票フォーマットの学習機能
- [ ] リアルタイム協調編集

---

## プロジェクト構成

```
docupaca/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── api/                  # API Routes
│   │   │   └── analyze-document/ # AI解析API
│   │   ├── dashboard/            # ダッシュボード
│   │   │   ├── settings/         # OCR設定
│   │   │   ├── history/          # 実行履歴
│   │   │   └── apikeys/          # APIキー管理
│   │   ├── login/                # ログイン
│   │   └── signup/               # サインアップ
│   ├── components/               # 再利用可能コンポーネント
│   ├── types/                    # TypeScript型定義
│   └── lib/                      # ユーティリティ
├── functions/                    # Cloud Functions
│   └── src/
│       └── index.ts              # OCR実行ロジック
└── public/                       # 静的ファイル
```

---

## ライセンス

未定

## 貢献者

OkutaniHayato

---

**最終コミット**: feat: AIによる配列フィールド（繰り返し項目）の自動生成に対応

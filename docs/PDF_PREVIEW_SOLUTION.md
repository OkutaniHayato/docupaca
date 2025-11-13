# PDFプレビューの実装について

## 問題の経緯

### react-pdfとNext.js 16の互換性問題

当初、`react-pdf`ライブラリを使用してPDFプレビュー機能を実装していましたが、Next.js 16 (Webpack) との互換性問題により、以下のエラーが発生しました：

```
TypeError: Object.defineProperty called on non-object
```

### 試行した解決策

1. **動的インポート（next/dynamic）**
   - `react-pdf`のコンポーネントを動的インポート
   - 結果: エラー継続

2. **useEffect内での動的インポート**
   - `import('react-pdf')`をuseEffect内で実行
   - 結果: インポート時点でエラー発生

3. **完全分離されたコンポーネント**
   - PDFプレビュー専用コンポーネントを作成
   - 結果: モジュール読み込み時点でエラー

### 根本原因

`pdfjs-dist`（react-pdfの依存ライブラリ）が、初期化時に`Object.defineProperty`を使用してグローバルオブジェクトにプロパティを設定しようとします。Next.js 16のWebpack設定では、SSR時にこの操作が失敗します。

## 採用した解決策：ブラウザネイティブPDFビューアー

### 実装方法

`<iframe>`タグを使用して、ブラウザのネイティブPDFビューアーでPDFを表示する方法を採用しました。

```typescript
export default function PdfPreview({ fileUrl }: PdfPreviewProps) {
  return (
    <div className="w-full h-full overflow-hidden">
      <iframe
        src={fileUrl}
        className="w-full h-full min-h-[500px] border-0"
        title="PDFプレビュー"
      />
      <p className="text-center text-xs text-gray-500 mt-2">
        ブラウザのネイティブPDFビューアーで表示しています
      </p>
    </div>
  );
}
```

### メリット

1. **互換性問題の完全回避**
   - サードパーティライブラリに依存しない
   - Next.js 16との互換性問題なし

2. **バンドルサイズの削減**
   - `react-pdf`（約500KB）が不要
   - `pdfjs-dist`（約2MB）が不要

3. **ブラウザネイティブ機能**
   - ズーム、スクロール、検索などの機能が利用可能
   - ブラウザが最適化したPDFレンダリング

4. **保守性の向上**
   - シンプルな実装
   - ライブラリのアップデートに左右されない

### デメリットと制約

1. **ページ数の取得不可**
   - JavaScriptからPDFのページ数を取得できない
   - 現在は「1ページ」として扱う

2. **カスタマイズの制限**
   - ブラウザのPDFビューアーの見た目は変更できない
   - 特定のページのみ表示などの細かい制御は不可

3. **ブラウザ依存**
   - ブラウザごとにPDFビューアーの機能が異なる
   - PDFサポートのないブラウザでは表示できない

## 代替案（将来的な改善）

### PDF.js を直接使用

react-pdfを経由せず、PDF.jsを直接使用する方法：

```typescript
import * as pdfjsLib from 'pdfjs-dist/webpack';

// ワーカー設定
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.js';

// PDF読み込み
const loadingTask = pdfjsLib.getDocument(pdfUrl);
const pdf = await loadingTask.promise;
const page = await pdf.getPage(1);

// Canvasにレンダリング
const canvas = document.getElementById('pdf-canvas');
const context = canvas.getContext('2d');
const viewport = page.getViewport({ scale: 1.5 });
const renderContext = {
  canvasContext: context,
  viewport: viewport
};
await page.render(renderContext).promise;
```

**利点:**
- ページ数の取得可能
- カスタマイズ可能
- 特定ページの表示制御

**欠点:**
- 実装が複雑
- Next.js 16との互換性検証が必要

### サーバーサイドでPDFを画像に変換

Node.jsでPDFを画像に変換してから表示：

```typescript
// サーバーサイド（API Route）
import { fromPath } from 'pdf2pic';

const converter = fromPath(pdfPath, {
  density: 100,
  saveFilename: "page",
  format: "png",
  width: 600,
  height: 800
});

const pageImage = await converter(1);

// クライアントサイドで画像として表示
<img src={pageImage} alt="PDF preview" />
```

**利点:**
- 完全なコントロール
- ブラウザ非依存

**欠点:**
- サーバー負荷
- 変換時間
- ストレージ容量

## 結論

現時点では、**ブラウザのネイティブPDFビューアー（iframe）を使用する方法**が最適です。

- シンプルで保守性が高い
- Next.js 16との互換性問題なし
- バンドルサイズの削減
- OCR設定のプレビューとしては十分な機能

将来的に、より高度な制御が必要になった場合は、PDF.js直接使用またはサーバーサイド変換を検討します。

## 参考リンク

- [react-pdf GitHub Issues](https://github.com/wojtekmaj/react-pdf/issues)
- [PDF.js Documentation](https://mozilla.github.io/pdf.js/)
- [Next.js Dynamic Import](https://nextjs.org/docs/advanced-features/dynamic-import)

"use client";

import React, { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

// PDF.jsワーカーの設定
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface ExtractedField {
  value: string;
  bbox: [number, number, number, number];
}

interface ExtractedData {
  [key: string]: ExtractedField;
}

interface PdfPreviewWithHighlightProps {
  fileUrl: string;
  extractedData?: ExtractedData;
}

/**
 * PDFプレビューコンポーネント（ハイライト対応）
 */
export default function PdfPreviewWithHighlight({ fileUrl, extractedData = {} }: PdfPreviewWithHighlightProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [pageWidth, setPageWidth] = useState<number>(0);
  const [pageHeight, setPageHeight] = useState<number>(0);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
  }

  function onPageLoadSuccess(page: any) {
    const viewport = page.getViewport({ scale: 1 });
    setPageWidth(viewport.width);
    setPageHeight(viewport.height);
  }

  return (
    <div className="relative">
      <Document
        file={fileUrl}
        onLoadSuccess={onDocumentLoadSuccess}
        loading={<div className="text-center p-4">PDFを読み込み中...</div>}
        error={<div className="text-center p-4 text-red-600">PDFの読み込みに失敗しました</div>}
      >
        <div className="relative inline-block">
          <Page
            pageNumber={pageNumber}
            width={600}
            onLoadSuccess={onPageLoadSuccess}
            renderTextLayer={true}
            renderAnnotationLayer={true}
          />

          {/* ハイライトボックス */}
          {pageWidth > 0 && pageHeight > 0 && Object.keys(extractedData).map(key => {
            const field = extractedData[key];

            // fieldがオブジェクトで、bboxプロパティがあることを確認
            if (!field || typeof field !== 'object' || !field.bbox) {
              return null;
            }

            const [x1, y1, x2, y2] = field.bbox;

            // bbox座標が有効かチェック（すべてが0の場合はスキップ）
            if (x1 === 0 && y1 === 0 && x2 === 0 && y2 === 0) {
              return null;
            }

            // bbox座標を正規化（0-1の範囲と仮定）してピクセルに変換
            // 表示幅は600pxなので、スケールを計算
            const scale = 600 / pageWidth;
            const left = x1 * pageWidth * scale;
            const top = y1 * pageHeight * scale;
            const width = (x2 - x1) * pageWidth * scale;
            const height = (y2 - y1) * pageHeight * scale;

            return (
              <div
                key={key}
                title={`${key}: ${field.value}`}
                className="absolute border-2 border-green-600 bg-green-600 bg-opacity-10 opacity-70 hover:opacity-100 transition-opacity pointer-events-none"
                style={{
                  left: `${left}px`,
                  top: `${top}px`,
                  width: `${width}px`,
                  height: `${height}px`,
                }}
              >
                <span className="absolute -top-5 left-0 text-xs bg-green-600 text-white px-1 rounded pointer-events-auto">
                  {key}
                </span>
              </div>
            );
          })}
        </div>
      </Document>

      {/* ページナビゲーション */}
      {numPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-4 p-3 bg-gray-100 rounded">
          <button
            onClick={() => setPageNumber(Math.max(1, pageNumber - 1))}
            disabled={pageNumber <= 1}
            className="px-3 py-1 bg-white border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            前へ
          </button>
          <p className="text-sm text-gray-700">
            ページ {pageNumber} / {numPages}
          </p>
          <button
            onClick={() => setPageNumber(Math.min(numPages, pageNumber + 1))}
            disabled={pageNumber >= numPages}
            className="px-3 py-1 bg-white border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            次へ
          </button>
        </div>
      )}
    </div>
  );
}

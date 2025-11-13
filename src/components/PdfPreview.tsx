"use client";

import React from 'react';

interface PdfPreviewProps {
  fileUrl: string;
  onLoadSuccess?: ({ numPages }: { numPages: number }) => void;
  width?: number;
}

/**
 * ブラウザのネイティブPDFビューアーを使用したPDFプレビュー
 * react-pdfとNext.js 16の互換性問題を回避するための代替実装
 */
export default function PdfPreview({ fileUrl, onLoadSuccess, width = 595 }: PdfPreviewProps) {
  // ブラウザのネイティブPDFビューアーを使用（A4サイズ: 595x842pt）
  return (
    <div className="w-full h-full overflow-hidden">
      <iframe
        src={fileUrl}
        className="w-full h-full min-h-[842px] border-0"
        title="PDFプレビュー"
        onLoad={() => {
          // PDFの読み込み完了時（ページ数は取得できないため、ダミー値を渡す）
          if (onLoadSuccess) {
            onLoadSuccess({ numPages: 1 });
          }
        }}
      />
    </div>
  );
}

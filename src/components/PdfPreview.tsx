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
export default function PdfPreview({ fileUrl, onLoadSuccess, width = 400 }: PdfPreviewProps) {
  // ブラウザのネイティブPDFビューアーを使用
  return (
    <div className="w-full h-full overflow-hidden">
      <iframe
        src={fileUrl}
        className="w-full h-full min-h-[500px] border-0"
        title="PDFプレビュー"
        onLoad={() => {
          // PDFの読み込み完了時（ページ数は取得できないため、ダミー値を渡す）
          if (onLoadSuccess) {
            onLoadSuccess({ numPages: 1 });
          }
        }}
      />
      <p className="text-center text-xs text-gray-500 mt-2">
        ブラウザのネイティブPDFビューアーで表示しています
      </p>
    </div>
  );
}

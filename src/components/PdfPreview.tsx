"use client";

import React, { useEffect, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

// PDF.jsワーカーをCDNから読み込む
if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
}

interface PdfPreviewProps {
  fileUrl: string;
  onLoadSuccess: ({ numPages }: { numPages: number }) => void;
  width?: number;
}

export default function PdfPreview({ fileUrl, onLoadSuccess, width = 400 }: PdfPreviewProps) {
  const [numPages, setNumPages] = useState<number | null>(null);

  const handleLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    onLoadSuccess({ numPages });
  };

  return (
    <div className="w-full h-full overflow-auto">
      <Document
        file={fileUrl}
        onLoadSuccess={handleLoadSuccess}
        onLoadError={(error: Error) => console.error('PDF load error:', error)}
        className="flex justify-center"
        loading={<div className="text-center py-8">PDFを読み込んでいます...</div>}
      >
        <Page
          pageNumber={1}
          width={width}
          renderTextLayer={false}
          renderAnnotationLayer={false}
        />
      </Document>
      {numPages && (
        <p className="text-center text-sm text-gray-500 mt-2">
          1 / {numPages} ページ (プレビューは1ページ目のみ)
        </p>
      )}
    </div>
  );
}

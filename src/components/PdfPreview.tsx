"use client";

import React, { useEffect, useState } from 'react';

interface PdfPreviewProps {
  fileUrl: string;
  onLoadSuccess: ({ numPages }: { numPages: number }) => void;
  width?: number;
}

export default function PdfPreview({ fileUrl, onLoadSuccess, width = 400 }: PdfPreviewProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [PdfComponents, setPdfComponents] = useState<{
    Document: any;
    Page: any;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // react-pdfを動的にインポート
  useEffect(() => {
    let mounted = true;

    async function loadPdfComponents() {
      try {
        const pdfModule = await import('react-pdf');

        // PDF.jsワーカーをCDNから設定
        pdfModule.pdfjs.GlobalWorkerOptions.workerSrc =
          `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfModule.pdfjs.version}/build/pdf.worker.min.mjs`;

        if (mounted) {
          setPdfComponents({
            Document: pdfModule.Document,
            Page: pdfModule.Page,
          });
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Failed to load PDF components:', error);
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadPdfComponents();

    return () => {
      mounted = false;
    };
  }, []);

  const handleLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    onLoadSuccess({ numPages });
  };

  if (isLoading || !PdfComponents) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-gray-500">PDFコンポーネントを読み込んでいます...</p>
      </div>
    );
  }

  const { Document, Page } = PdfComponents;

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

"use client";

import React, { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// PDF.jsワーカーの設定
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

interface ExtractedField {
  value: string;
  bbox: [number, number, number, number];
}

interface ExtractedData {
  [key: string]: ExtractedField;
}

interface PdfToImagePreviewProps {
  fileUrl: string;
  extractedData?: ExtractedData;
}

/**
 * PDFを画像に変換してハイライト表示するコンポーネント
 */
export default function PdfToImagePreview({ fileUrl, extractedData = {} }: PdfToImagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 0, height: 0 });
  const [pdfDoc, setPdfDoc] = useState<any>(null);

  // PDFをロードしてレンダリング
  useEffect(() => {
    const loadPdf = async () => {
      if (!fileUrl) return;

      setLoading(true);
      setError(null);

      try {
        // PDFドキュメントをロード
        const loadingTask = pdfjsLib.getDocument(fileUrl);
        const pdf = await loadingTask.promise;

        setPdfDoc(pdf);
        setNumPages(pdf.numPages);

        // 最初のページをレンダリング
        await renderPage(pdf, pageNumber);

        setLoading(false);
      } catch (err) {
        console.error('PDF loading error:', err);
        setError('PDFの読み込みに失敗しました');
        setLoading(false);
      }
    };

    loadPdf();
  }, [fileUrl]);

  // ページ変更時の再レンダリング
  useEffect(() => {
    if (pdfDoc) {
      renderPage(pdfDoc, pageNumber);
    }
  }, [pageNumber, pdfDoc]);

  const renderPage = async (pdf: any, pageNum: number) => {
    const page = await pdf.getPage(pageNum);
    const canvas = canvasRef.current;

    if (!canvas) return;

    const viewport = page.getViewport({ scale: 1.5 });
    const context = canvas.getContext('2d');

    if (!context) return;

    // Canvasのサイズを設定
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    setCanvasDimensions({ width: viewport.width, height: viewport.height });

    // レンダリング
    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };

    await page.render(renderContext).promise;
  };

  const handlePrevPage = () => {
    if (pageNumber > 1) {
      setPageNumber(pageNumber - 1);
    }
  };

  const handleNextPage = () => {
    if (pageNumber < numPages) {
      setPageNumber(pageNumber + 1);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 min-h-[600px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p className="text-gray-600">PDFを読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center p-12 min-h-[600px]">
        <div className="text-center text-red-600">
          <p className="font-medium">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div ref={containerRef} className="relative inline-block">
        {/* PDFレンダリング用Canvas */}
        <canvas ref={canvasRef} className="w-full h-auto" />

        {/* ハイライトボックス */}
        {canvasDimensions.width > 0 && canvasDimensions.height > 0 && Object.keys(extractedData).map(key => {
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
          const left = (x1 * 100).toFixed(2);
          const top = (y1 * 100).toFixed(2);
          const width = ((x2 - x1) * 100).toFixed(2);
          const height = ((y2 - y1) * 100).toFixed(2);

          return (
            <div
              key={key}
              title={`${key}: ${field.value}`}
              className="absolute border-2 border-green-600 bg-green-600 bg-opacity-10 opacity-70 hover:opacity-100 transition-opacity pointer-events-none"
              style={{
                left: `${left}%`,
                top: `${top}%`,
                width: `${width}%`,
                height: `${height}%`,
              }}
            >
              <span className="absolute -top-5 left-0 text-xs bg-green-600 text-white px-1 rounded pointer-events-auto">
                {key}
              </span>
            </div>
          );
        })}
      </div>

      {/* ページナビゲーション */}
      {numPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-4 p-3 bg-gray-100 rounded">
          <button
            onClick={handlePrevPage}
            disabled={pageNumber <= 1}
            className="px-3 py-1 bg-white border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          >
            前へ
          </button>
          <p className="text-sm text-gray-700">
            ページ {pageNumber} / {numPages}
          </p>
          <button
            onClick={handleNextPage}
            disabled={pageNumber >= numPages}
            className="px-3 py-1 bg-white border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          >
            次へ
          </button>
        </div>
      )}
    </div>
  );
}

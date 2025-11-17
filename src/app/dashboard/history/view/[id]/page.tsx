"use client";

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';
import { db, storage } from '@/config/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage'; 

// 
// 
interface ExtractedField {
  value: string;
  bbox: [number, number, number, number]; // [x_min, y_min, x_max, y_max] (仮)
}
interface ExtractedData {
  [key: string]: ExtractedField;
}

interface HistoryDetail {
  id: string;
  status: string;
  original_file_path: string;
  converted_image_path?: string; // PDF→画像変換後のパス
  extracted_data: ExtractedData;
  imageUrl: string | null;
  convertedImageUrl: string | null; // 変換された画像のURL
}

/**
 * OCR実行履歴 詳細ページ
 */
export default function HistoryDetailPage() {
  const [history, setHistory] = useState<HistoryDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const params = useParams();
  const { currentUser } = useAuth();

  const historyId = params.id as string;

  useEffect(() => {
    if (!historyId || !currentUser) return;

    const fetchHistoryDetail = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // 1. 履歴を取得
        const historyRef = doc(db, "ocr_history", historyId);
        const historySnap = await getDoc(historyRef);

        if (!historySnap.exists()) {
          setError("履歴が見つかりません。");
          setIsLoading(false);
          return;
        }

        const data = historySnap.data();

        // 2. この履歴の setting_id が、現在のユーザーが所有する設定かチェック
        const settingRef = doc(db, "ocr_settings", data.setting_id);
        const settingSnap = await getDoc(settingRef);

        if (!settingSnap.exists()) {
          setError("関連する設定が見つかりません。");
          setIsLoading(false);
          return;
        }

        const settingData = settingSnap.data();

        // 3. 権限チェック: 設定の owner_id が現在のユーザーと一致するか確認
        if (settingData.owner_id !== currentUser.uid) {
          setError("この履歴にアクセスする権限がありません。");
          setIsLoading(false);
          return;
        }

        // 4. 画像URLを取得（ファイルが存在しない場合は null）
        let downloadUrl: string | null = null;
        let convertedImageUrl: string | null = null;

        try {
          const imageRef = ref(storage, data.original_file_path);
          downloadUrl = await getDownloadURL(imageRef);
        } catch (storageError) {
          console.warn("元ファイルが見つかりません:", storageError);
          // ファイルが存在しない場合でも処理を続行
        }

        // 変換された画像がある場合は取得
        if (data.converted_image_path) {
          try {
            const convertedRef = ref(storage, data.converted_image_path);
            convertedImageUrl = await getDownloadURL(convertedRef);
          } catch (storageError) {
            console.warn("変換された画像が見つかりません:", storageError);
          }
        }

        // 5. データをセット（extracted_data がない場合は空オブジェクト）
        let extractedData = data.extracted_data || {};

        // デバッグ用：extracted_dataの構造をコンソールに出力
        console.log('extracted_data (raw):', extractedData);
        console.log('extracted_data type:', Array.isArray(extractedData) ? 'Array' : 'Object');

        // 配列の場合はオブジェクトに変換
        if (Array.isArray(extractedData)) {
          console.log('Converting array to object...');
          const convertedData: ExtractedData = {};
          extractedData.forEach((item: unknown) => {
            // 各配列要素はオブジェクト（例: {invoiceDate: {value: "...", bbox: [...]}}）
            if (item && typeof item === 'object') {
              Object.keys(item).forEach(key => {
                convertedData[key] = (item as Record<string, ExtractedField>)[key];
              });
            }
          });
          extractedData = convertedData;
          console.log('Converted extracted_data:', extractedData);
        }

        console.log('extracted_data keys:', Object.keys(extractedData));

        setHistory({
          id: historySnap.id,
          status: data.status,
          original_file_path: data.original_file_path,
          converted_image_path: data.converted_image_path,
          extracted_data: extractedData,
          imageUrl: downloadUrl,
          convertedImageUrl: convertedImageUrl,
        });

      } catch (err) {
        console.error("Error fetching history detail: ", err);
        setError("履歴の読み込みに失敗しました。");
      } finally {
        setIsLoading(false);
      }
    };

    fetchHistoryDetail();
  }, [historyId, currentUser]);

  const handleCsvDownload = (includeHeader: boolean) => {
    if (!history?.extracted_data) return;

    const data = history.extracted_data;
    const fields = Object.keys(data);
    const values = fields.map(field => `"${data[field].value}"`);

    let csvContent = "data:text/csv;charset=utf-8,";

    if (includeHeader) {
      csvContent += fields.join(",") + "\n";
    }
    csvContent += values.join(",") + "\n";

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `extraction_${historyId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (isLoading) {
    return <p className="text-center text-gray-500">履歴を読み込み中...</p>;
  }
  if (error) {
    return <p className="text-center text-red-600">{error}</p>;
  }
  if (!history) {
    return null; 
  }

  // ステータスチップを取得
  const getStatusChip = (status: string) => {
    switch (status) {
      case 'completed':
        return <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800">完了</span>;
      case 'failed':
        return <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-800">失敗</span>;
      default:
        return <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-800">処理中</span>;
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            実行履歴詳細
          </h2>
          {history && getStatusChip(history.status)}
        </div>

        {/* --- CSVダウンロードボタン --- */}
        {history && Object.keys(history.extracted_data).length > 0 && (
          <div className="flex space-x-2">
            <button
              onClick={() => handleCsvDownload(true)}
              className="rounded-lg bg-green-800 py-2 px-4 font-semibold text-white hover:bg-green-700"
            >
              CSV (ヘッダーあり)
            </button>
            <button
              onClick={() => handleCsvDownload(false)}
              className="rounded-lg bg-gray-600 py-2 px-4 font-semibold text-white hover:bg-gray-500"
            >
              CSV (ヘッダーなし)
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* --- 1. 元画像/PDFとハイライト表示 --- */}
        <div className="border border-gray-300 rounded-lg overflow-auto">
          {/* 変換された画像または元画像を表示 */}
          {history.convertedImageUrl || history.imageUrl ? (
            <div className="flex items-start justify-center" style={{ maxHeight: 'calc(100vh - 200px)' }}>
              <div className="relative inline-block">
                <Image
                  src={history.convertedImageUrl || history.imageUrl!}
                  alt="Original Document"
                  className="w-auto h-auto object-contain"
                  width={800}
                  height={1100}
                  priority
                  style={{ maxHeight: 'calc(100vh - 200px)' }}
                  onLoad={(e) => {
                    const img = e.target as HTMLImageElement;
                    setImageDimensions({
                      width: img.naturalWidth,
                      height: img.naturalHeight,
                    });
                  }}
                />

                {/* --- ハイライトボックス（BBox） --- */}
                {imageDimensions && Object.keys(history.extracted_data).map(key => {
                  const field = history.extracted_data[key];

                  // fieldがオブジェクトで、bboxプロパティがあることを確認
                  if (!field || typeof field !== 'object' || !field.bbox) {
                    return null;
                  }

                  const [x1, y1, x2, y2] = field.bbox;

                  // bbox座標が有効かチェック（すべてが0の場合はスキップ）
                  if (x1 === 0 && y1 === 0 && x2 === 0 && y2 === 0) {
                    return null;
                  }

                  // bbox座標を正規化（0-1の範囲と仮定）
                  // Gemini APIは通常、正規化された座標を返すため
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
                      <span className="absolute -top-5 left-0 text-xs bg-green-600 text-white px-1 rounded pointer-events-auto whitespace-nowrap">
                        {key}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center bg-gray-100 p-12 min-h-[300px]">
              <div className="text-center text-gray-500">
                <svg
                  className="mx-auto h-12 w-12 mb-4 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <p className="font-medium">画像ファイルが見つかりません</p>
                <p className="text-sm mt-1">ファイル: {history.original_file_path}</p>
              </div>
            </div>
          )}
        </div>


        {/* --- 2. 抽出結果テーブル --- */}
        <div>
          <h3 className="text-lg font-semibold mb-4">抽出結果</h3>
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            {Object.keys(history.extracted_data).length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                {history.status === 'processing' && (
                  <p>OCR処理中です。しばらくお待ちください。</p>
                )}
                {history.status === 'failed' && (
                  <p className="text-red-600">OCR処理が失敗しました。</p>
                )}
                {history.status === 'completed' && (
                  <p>抽出データがありません。</p>
                )}
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="p-3 text-left text-sm font-semibold text-gray-600">項目名</th>
                    <th className="p-3 text-left text-sm font-semibold text-gray-600">抽出された値</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(history.extracted_data).map(key => {
                    const field = history.extracted_data[key];

                    // fieldがオブジェクトで、valueプロパティがあることを確認
                    const displayValue = field && typeof field === 'object' && 'value' in field
                      ? field.value
                      : String(field);

                    return (
                      <tr key={key} className="border-b hover:bg-gray-50">
                        <td className="p-3 text-sm font-medium text-gray-800">{key}</td>
                        <td className="p-3 text-sm text-gray-600 font-mono">
                          {displayValue}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
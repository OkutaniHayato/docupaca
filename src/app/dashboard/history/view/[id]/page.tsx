"use client";

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image'; //
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
  extracted_data: ExtractedData;
  imageUrl: string; 
}

/**
 * OCR実行履歴 詳細ページ
 */
export default function HistoryDetailPage() {
  const [history, setHistory] = useState<HistoryDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const params = useParams();
  const { currentUser } = useAuth();
  
  const historyId = params.id as string;

  useEffect(() => {
    if (!historyId || !currentUser) return;

    const fetchHistoryDetail = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const historyRef = doc(db, "ocr_history", historyId);
        const historySnap = await getDoc(historyRef);

        if (!historySnap.exists()) {
          setError("履歴が見つかりません。");
          setIsLoading(false); 
          return;
        }

        const data = historySnap.data();
        
        // TODO: 
        
        const imageRef = ref(storage, data.original_file_path);
        const downloadUrl = await getDownloadURL(imageRef);

        setHistory({
          id: historySnap.id,
          status: data.status,
          original_file_path: data.original_file_path,
          extracted_data: data.extracted_data,
          imageUrl: downloadUrl,
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

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">
          実行履歴詳細
        </h2>
        
        {/* --- CSVダウンロードボタン --- */}
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
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* --- 1. 元画像とハイライト表示 (next/image に変更) --- */}
        <div className="relative border border-gray-300 rounded-lg overflow-hidden">
          <Image 
            src={history.imageUrl} 
            alt="Original Document" 
            className="w-full h-auto"
            width={800} //
            height={1100} //
            priority //
          />
          
          {/* --- ハイライトボックス（BBox） --- */}
          {Object.keys(history.extracted_data).map(key => {
            
            // 
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const field = history.extracted_data[key];
            // TODO: bbox の座標計算ロジックを実装する
            // const [x_min, y_min, x_max, y_max] = field.bbox;
            
            return (
              <div
                key={key}
                title={key} 
                className="absolute border-2 border-green-600 opacity-70 hover:opacity-100"
                style={{
                  left: `50%`, 
                  top: `50%`,
                  width: `10%`,
                  height: `10%`,
                }}
              ></div>
            );
          })}
        </div>


        {/* --- 2. 抽出結果テーブル --- */}
        <div>
          <h3 className="text-lg font-semibold mb-4">抽出結果</h3>
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="p-3 text-left text-sm font-semibold text-gray-600">項目名</th>
                  <th className="p-3 text-left text-sm font-semibold text-gray-600">抽出された値</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(history.extracted_data).map(key => (
                  <tr key={key} className="border-b hover:bg-gray-50">
                    <td className="p-3 text-sm font-medium text-gray-800">{key}</td>
                    <td className="p-3 text-sm text-gray-600 font-mono">
                      {history.extracted_data[key].value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
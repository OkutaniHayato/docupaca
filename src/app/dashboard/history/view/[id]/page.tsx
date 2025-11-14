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
  imageUrl: string | null;
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
        try {
          const imageRef = ref(storage, data.original_file_path);
          downloadUrl = await getDownloadURL(imageRef);
        } catch (storageError: any) {
          console.warn("画像ファイルが見つかりません:", storageError);
          // ファイルが存在しない場合でも処理を続行
        }

        // 5. データをセット（extracted_data がない場合は空オブジェクト）
        setHistory({
          id: historySnap.id,
          status: data.status,
          original_file_path: data.original_file_path,
          extracted_data: data.extracted_data || {},
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

        {/* --- 1. 元画像とハイライト表示 (next/image に変更) --- */}
        <div className="relative border border-gray-300 rounded-lg overflow-hidden">
          {history.imageUrl ? (
            <>
              <Image
                src={history.imageUrl}
                alt="Original Document"
                className="w-full h-auto"
                width={800}
                height={1100}
                priority
              />

              {/* --- ハイライトボックス（BBox） --- */}
              {Object.keys(history.extracted_data).map(key => {

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
            </>
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
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
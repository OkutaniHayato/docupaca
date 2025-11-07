"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/config/firebase';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  Timestamp 
} from 'firebase/firestore';

// 
interface OcrHistoryItem {
  id: string; // Firestore ドキュメントID
  setting_id: string; //
  status: 'processing' | 'completed' | 'failed'; //
  original_file_path: string; //
  executed_at: Timestamp; //
  // TODO: setting_id から設定名 (name) を取得して表示する
  settingName?: string; // 
}

/**
 * OCR実行履歴一覧ページ
 */
export default function HistoryPage() {
  const [historyList, setHistoryList] = useState<OcrHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { currentUser } = useAuth();

  useEffect(() => {
    if (!currentUser) return;

    const fetchHistory = async () => {
      setIsLoading(true);
      try {
        // --- 1. ユーザーが所有する OCR設定 の ID をすべて取得 ---
        const settingsRef = collection(db, "ocr_settings");
        const settingsQuery = query(settingsRef, where("owner_id", "==", currentUser.uid));
        const settingsSnapshot = await getDocs(settingsQuery);
        
        const settingIds = settingsSnapshot.docs.map(doc => doc.id);

        if (settingIds.length === 0) {
          // 
          setIsLoading(false);
          return;
        }

        // --- 2. 取得した ID 配列を使って、履歴 を 'in' で検索 ---
        const historyRef = collection(db, "ocr_history");
        const historyQuery = query(historyRef, where("setting_id", "in", settingIds));
        
        const historySnapshot = await getDocs(historyQuery);

        const histories: OcrHistoryItem[] = [];
        historySnapshot.forEach((doc) => {
          const data = doc.data();
          histories.push({
            id: doc.id,
            setting_id: data.setting_id,
            status: data.status,
            original_file_path: data.original_file_path,
            executed_at: data.executed_at,
            // 
          });
        });
        
        // TODO: settingName を紐づける処理 (
        
        setHistoryList(histories);

      } catch (error) {
        console.error("Error fetching history: ", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchHistory();
  }, [currentUser]);

  // 
  const getStatusChip = (status: string) => {
    switch (status) {
      case 'completed':
        // Success カラー
        return <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800">Completed</span>;
      case 'failed':
        // Error カラー
        return <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-800">Failed</span>;
      default:
        // Secondary カラー
        return <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-800">Processing</span>;
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">
        実行履歴
      </h2>

      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-left text-sm font-semibold text-gray-600">ステータス</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600">ファイル名</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600">設定名 (ID)</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600">実行日時</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600">アクション</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="p-3 text-center text-gray-500">読み込み中...</td>
              </tr>
            ) : historyList.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-3 text-center text-gray-500">実行履歴はありません。</td>
              </tr>
            ) : (
              historyList.map((item) => (
                <tr key={item.id} className="border-b hover:bg-gray-50">
                  <td className="p-3">{getStatusChip(item.status)}</td>
                  <td className="p-3 text-sm text-gray-700">
                    {/* */}
                    {item.original_file_path.split('/').pop()}
                  </td>
                  <td className="p-3 text-sm text-gray-500 font-mono">
                    {/* */}
                    {item.settingName || `...${item.setting_id.slice(-6)}`}
                  </td>
                  <td className="p-3 text-sm text-gray-500">
                    {item.executed_at.toDate().toLocaleString()}
                  </td>
                  <td className="p-3 text-sm">
                    <Link 
                      href={`/dashboard/history/view/${item.id}`} // 
                      className="font-medium text-green-800 hover:text-green-700"
                    >
                      詳細
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
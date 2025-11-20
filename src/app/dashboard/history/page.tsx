"use client";

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { db, storage } from '@/config/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  Timestamp
} from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Upload, X } from 'lucide-react';

// OCR履歴アイテムの型定義
interface OcrHistoryItem {
  id: string; // Firestore ドキュメントID
  setting_id: string;
  status: 'processing' | 'completed' | 'failed';
  original_file_path: string;
  executed_at: Timestamp;
  // TODO: setting_id から設定名 (name) を取得して表示する
  settingName?: string;
}

// OCR設定の型定義
interface OcrSetting {
  id: string;
  name: string;
  model_name: string;
  owner_id: string;
}

/**
 * OCR実行履歴一覧ページ
 */
export default function HistoryPage() {
  const [historyList, setHistoryList] = useState<OcrHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { currentUser } = useAuth();

  // 新規実行モーダル用のステート
  const [isExecuteModalOpen, setIsExecuteModalOpen] = useState(false);
  const [ocrSettings, setOcrSettings] = useState<OcrSetting[]>([]);
  const [selectedSettingId, setSelectedSettingId] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [executeError, setExecuteError] = useState<string>('');

  // 履歴リストを取得する関数
  const fetchHistoryList = useCallback(async () => {
    if (!currentUser) return;

    try {
      // --- 1. ユーザーが所有する OCR設定 の ID をすべて取得 ---
      const settingsRef = collection(db, "ocr_settings");
      const settingsQuery = query(settingsRef, where("owner_id", "==", currentUser.uid));
      const settingsSnapshot = await getDocs(settingsQuery);

      const settingIds = settingsSnapshot.docs.map(doc => doc.id);

      if (settingIds.length === 0) {
        setHistoryList([]);
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
        });
      });

      // 処理日時の降順（新しい日時が上）にソート
      histories.sort((a, b) => {
        const timeA = a.executed_at?.toMillis() || 0;
        const timeB = b.executed_at?.toMillis() || 0;
        return timeB - timeA;
      });

      setHistoryList(histories);

    } catch (error) {
      console.error("Error fetching history: ", error);
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;

    const loadHistory = async () => {
      setIsLoading(true);
      try {
        await fetchHistoryList();
      } finally {
        setIsLoading(false);
      }
    };

    loadHistory();
  }, [currentUser, fetchHistoryList]);

  // OCR設定を取得
  useEffect(() => {
    if (!currentUser) return;

    const fetchOcrSettings = async () => {
      try {
        const settingsRef = collection(db, "ocr_settings");
        const q = query(settingsRef, where("owner_id", "==", currentUser.uid));
        const querySnapshot = await getDocs(q);

        const settings: OcrSetting[] = [];
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          settings.push({
            id: doc.id,
            name: data.name,
            model_name: data.model_name,
            owner_id: data.owner_id,
          });
        });

        setOcrSettings(settings);
      } catch (error) {
        console.error("Error fetching OCR settings: ", error);
      }
    };

    fetchOcrSettings();
  }, [currentUser]);

  // ファイル選択ハンドラー
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setExecuteError('');
    }
  };

  // 実行ハンドラー
  const handleExecute = async () => {
    if (!currentUser) {
      setExecuteError('ユーザーが認証されていません');
      return;
    }

    if (!selectedSettingId) {
      setExecuteError('OCR設定を選択してください');
      return;
    }

    if (!selectedFile) {
      setExecuteError('ファイルを選択してください');
      return;
    }

    setExecuteError('');

    // モーダルを閉じる前に値をキャプチャ
    const settingId = selectedSettingId;
    const file = selectedFile;

    try {
      // 1. ファイルをCloud Storageにアップロード
      const timestamp = Date.now();
      const fileName = `${timestamp}_${file.name}`;
      const storageRef = ref(storage, `ocr_executions/${currentUser.uid}/${fileName}`);

      await uploadBytes(storageRef, file);
      const filePath = `ocr_executions/${currentUser.uid}/${fileName}`;

      // モーダルを閉じてテーブルでローディング表示
      setIsExecuteModalOpen(false);
      setSelectedFile(null);
      setSelectedSettingId('');

      // 一時的なアイテムを即座にUIに追加（楽観的更新）
      const tempItem: OcrHistoryItem = {
        id: `temp_${timestamp}`,
        setting_id: settingId,
        status: 'processing',
        original_file_path: filePath,
        executed_at: Timestamp.now(),
      };

      // 新しいアイテムを先頭に追加（降順ソートを維持）
      setHistoryList(prev => [tempItem, ...prev]);

      // 2. executeOcr Cloud Functionを呼び出し（バックグラウンド）
      const functions = getFunctions(undefined, 'asia-northeast1');
      const executeOcr = httpsCallable(functions, 'executeOcr');

      // 非同期で実行（await しない）
      executeOcr({
        setting_id: settingId,
        file_path: filePath,
        user_id: currentUser.uid,
      }).then(() => {
        // 完了後に履歴を再取得（一時アイテムを実際のデータで置き換え）
        fetchHistoryList();
      }).catch((error) => {
        console.error('Execute error:', error);
        // エラー時も履歴を再取得
        fetchHistoryList();
      });

    } catch (error) {
      console.error('Execute error:', error);
      setExecuteError(error instanceof Error ? error.message : '実行中にエラーが発生しました');
    }
  };

  // ステータスチップの表示
  const getStatusChip = (status: string) => {
    switch (status) {
      case 'completed':
        // Success カラー
        return (
          <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800 flex items-center gap-1">
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            Completed
          </span>
        );
      case 'failed':
        // Error カラー
        return (
          <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-800 flex items-center gap-1">
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            Failed
          </span>
        );
      default:
        // Secondary カラー - 処理中アニメーション
        return (
          <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800 flex items-center gap-1">
            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-800"></div>
            Processing
          </span>
        );
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">
          実行履歴
        </h2>

        <button
          onClick={() => setIsExecuteModalOpen(true)}
          className="rounded-lg bg-green-800 py-2 px-4 font-semibold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 flex items-center gap-2"
        >
          <Upload className="h-4 w-4" />
          新規実行
        </button>
      </div>

      {/* 新規実行モーダル */}
      {isExecuteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0, 0, 0, 0.1)' }}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-screen-lg mx-4" style={{ overflow: 'visible' }}>
            <div className="flex items-center justify-between p-6 border-b">
              <h3 className="text-xl font-bold" style={{ color: '#000000' }}>帳票を実行</h3>
              <button
                onClick={() => {
                  setIsExecuteModalOpen(false);
                  setSelectedFile(null);
                  setSelectedSettingId('');
                  setExecuteError('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="p-6 space-y-4" style={{ overflow: 'visible' }}>
              {/* OCR設定選択 */}
              <div className="relative" style={{ zIndex: 1000 }}>
                <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                  OCR設定
                </label>
                <select
                  value={selectedSettingId}
                  onChange={(e) => setSelectedSettingId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                  style={{ color: '#000000' }}
                >
                  <option value="">設定を選択してください</option>
                  {ocrSettings.map((setting) => (
                    <option key={setting.id} value={setting.id}>
                      {setting.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* ファイルアップロード */}
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                  帳票ファイル (PDF/画像)
                </label>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={handleFileChange}
                  className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
                />
                {selectedFile && (
                  <p className="mt-2 text-sm" style={{ color: '#000000' }}>
                    選択中: <span className="font-bold">{selectedFile.name}</span>
                  </p>
                )}
              </div>

              {/* エラーメッセージ */}
              {executeError && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  {executeError}
                </div>
              )}

              {/* 実行ボタン */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => {
                    setIsExecuteModalOpen(false);
                    setSelectedFile(null);
                    setSelectedSettingId('');
                    setExecuteError('');
                  }}
                  className="flex-1 rounded-lg border border-gray-300 py-2 px-4 font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleExecute}
                  className="flex-1 rounded-lg bg-green-800 py-2 px-4 font-semibold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!selectedSettingId || !selectedFile}
                >
                  実行
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
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
import { Upload, X, Sparkles, AlertCircle, CheckCircle2, Zap, CheckCircle, Clock } from 'lucide-react';

// 自動実行の信頼度閾値（90%以上で自動実行）
const AUTO_EXECUTE_THRESHOLD = 0.9;

// OCR履歴アイテムの型定義
interface OcrHistoryItem {
  id: string; // Firestore ドキュメントID
  setting_id: string;
  status: 'processing' | 'completed' | 'failed';
  original_file_path: string;
  executed_at: Timestamp;
  settingName?: string; // OCR設定名
  isHumanConfirmed?: boolean; // 人間確定済みかどうか
}

// OCR設定の型定義（AI判定用のフィールドを含む）
interface OcrSetting {
  id: string;
  name: string;
  model_name: string;
  owner_id: string;
  // AI自動判定用メタ情報
  displayName?: string;
  templateType?: string;
  exampleKeywords?: string[];
}

// AI判定結果の型定義
interface TemplateDetectionResult {
  predictedTemplateId: string | null;
  predictedConfidence: number;
  candidates: Array<{ id: string; confidence: number }>;
  reasoning?: string;
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

  // AI判定用のステート
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectionResult, setDetectionResult] = useState<TemplateDetectionResult | null>(null);
  const [detectionError, setDetectionError] = useState<string>('');
  const [isAutoExecuting, setIsAutoExecuting] = useState(false); // 自動実行中フラグ

  // 履歴リストを取得する関数
  const fetchHistoryList = useCallback(async () => {
    if (!currentUser) return;

    try {
      // --- 1. ユーザーが所有する OCR設定 の ID をすべて取得 ---
      const settingsRef = collection(db, "ocr_settings");
      const settingsQuery = query(settingsRef, where("owner_id", "==", currentUser.uid));
      const settingsSnapshot = await getDocs(settingsQuery);

      // 設定IDと設定名のマップを作成
      const settingsMap = new Map<string, string>();
      settingsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        settingsMap.set(doc.id, data.displayName || data.name || doc.id);
      });

      const settingIds = Array.from(settingsMap.keys());

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
          settingName: settingsMap.get(data.setting_id) || data.setting_id,
          isHumanConfirmed: data.isHumanConfirmed || false,
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

  // OCR設定を取得（AI判定用メタ情報含む）
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
            // AI判定用メタ情報
            displayName: data.displayName,
            templateType: data.templateType,
            exampleKeywords: data.exampleKeywords,
          });
        });

        setOcrSettings(settings);
      } catch (error) {
        console.error("Error fetching OCR settings: ", error);
      }
    };

    fetchOcrSettings();
  }, [currentUser]);

  // ファイル選択ハンドラー（選択時にAI判定を自動実行）
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setExecuteError('');
      setDetectionError('');
      setDetectionResult(null);
      setSelectedSettingId('');

      // テンプレートが登録されている場合のみAI判定を実行
      if (ocrSettings.length > 0) {
        await detectTemplate(file);
      }
    }
  };

  // OCR実行処理（共通関数）
  const executeOcrWithParams = async (file: File, settingId: string) => {
    if (!currentUser) return;

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
      setDetectionResult(null);
      setDetectionError('');
      setIsAutoExecuting(false);

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
      setIsAutoExecuting(false);
    }
  };

  // AIテンプレート判定
  const detectTemplate = async (file: File) => {
    if (ocrSettings.length === 0) return;

    setIsDetecting(true);
    setDetectionError('');
    setDetectionResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('templates', JSON.stringify(
        ocrSettings.map(s => ({
          id: s.id,
          name: s.name,
          displayName: s.displayName,
          templateType: s.templateType,
          exampleKeywords: s.exampleKeywords,
        }))
      ));

      const response = await fetch('/api/detect-template', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'テンプレート判定に失敗しました');
      }

      if (result.success && result.data) {
        setDetectionResult(result.data);

        // AI推定が成功した場合
        if (result.data.predictedTemplateId) {
          setSelectedSettingId(result.data.predictedTemplateId);

          // 信頼度が閾値以上なら自動実行
          if (result.data.predictedConfidence >= AUTO_EXECUTE_THRESHOLD) {
            setIsDetecting(false); // 判定完了
            setIsAutoExecuting(true); // 自動実行開始
            // 少し遅延を入れてUIを更新してから実行
            setTimeout(() => {
              executeOcrWithParams(file, result.data.predictedTemplateId);
            }, 500);
            return; // finallyをスキップ
          }
        }
      }
    } catch (error) {
      console.error('Template detection error:', error);
      setDetectionError(error instanceof Error ? error.message : 'AI判定中にエラーが発生しました');
    } finally {
      setIsDetecting(false);
    }
  };

  // 実行ハンドラー（手動実行）
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
    await executeOcrWithParams(selectedFile, selectedSettingId);
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
                  if (isAutoExecuting) return; // 自動実行中は閉じない
                  setIsExecuteModalOpen(false);
                  setSelectedFile(null);
                  setSelectedSettingId('');
                  setExecuteError('');
                  setDetectionResult(null);
                  setDetectionError('');
                }}
                className={`text-gray-400 hover:text-gray-600 ${isAutoExecuting ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={isAutoExecuting}
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="p-6 space-y-4" style={{ overflow: 'visible' }}>
              {/* Step 1: ファイルアップロード */}
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                  1. 帳票ファイル (PDF/画像)
                </label>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={handleFileChange}
                  disabled={isDetecting || isAutoExecuting}
                  className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100 disabled:opacity-50"
                />
                {selectedFile && (
                  <p className="mt-2 text-sm" style={{ color: '#000000' }}>
                    選択中: <span className="font-bold">{selectedFile.name}</span>
                  </p>
                )}
              </div>

              {/* AI判定中の表示 */}
              {isDetecting && (
                <div className="rounded-lg bg-blue-50 p-4 flex items-center gap-3">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                  <div>
                    <p className="text-sm font-medium text-blue-800">AIがテンプレートを判定中...</p>
                    <p className="text-xs text-blue-600">帳票の内容を解析して最適なテンプレートを推定しています</p>
                  </div>
                </div>
              )}

              {/* 自動実行中の表示 */}
              {isAutoExecuting && (
                <div className="rounded-lg bg-green-100 border border-green-300 p-4 flex items-center gap-3">
                  <Zap className="h-5 w-5 text-green-600 animate-pulse" />
                  <div>
                    <p className="text-sm font-medium text-green-800">
                      高精度で判定完了！自動実行を開始します...
                    </p>
                    <p className="text-xs text-green-600">
                      信頼度が{Math.round(AUTO_EXECUTE_THRESHOLD * 100)}%以上のため、自動でOCRを実行しています
                    </p>
                  </div>
                </div>
              )}

              {/* AI判定結果の表示 */}
              {selectedFile && !isDetecting && !isAutoExecuting && detectionResult && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                  <div className="flex items-start gap-3">
                    <Sparkles className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-green-800">AI推定テンプレート</p>
                        {detectionResult.predictedConfidence >= 0.8 && (
                          <span className="text-xs bg-green-200 text-green-800 px-2 py-0.5 rounded-full">
                            高精度
                          </span>
                        )}
                      </div>
                      {detectionResult.predictedTemplateId ? (
                        <>
                          <p className="text-lg font-bold text-green-900 mt-1">
                            {ocrSettings.find(s => s.id === detectionResult.predictedTemplateId)?.displayName ||
                             ocrSettings.find(s => s.id === detectionResult.predictedTemplateId)?.name ||
                             '不明'}
                          </p>
                          <div className="flex items-center gap-2 mt-2">
                            <div className="flex-1 h-2 bg-green-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-green-600 rounded-full transition-all"
                                style={{ width: `${Math.round(detectionResult.predictedConfidence * 100)}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium text-green-700">
                              {Math.round(detectionResult.predictedConfidence * 100)}%
                            </span>
                          </div>
                          {detectionResult.reasoning && (
                            <p className="text-xs text-green-700 mt-2">{detectionResult.reasoning}</p>
                          )}
                          {/* 他の候補がある場合 */}
                          {detectionResult.candidates.length > 1 && (
                            <div className="mt-3 pt-3 border-t border-green-200">
                              <p className="text-xs font-medium text-green-700 mb-1">他の候補:</p>
                              <div className="flex flex-wrap gap-1">
                                {detectionResult.candidates.slice(1, 4).map((c) => (
                                  <span key={c.id} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                                    {ocrSettings.find(s => s.id === c.id)?.displayName ||
                                     ocrSettings.find(s => s.id === c.id)?.name ||
                                     c.id.slice(-6)} ({Math.round(c.confidence * 100)}%)
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="flex items-center gap-2 mt-1">
                          <AlertCircle className="h-4 w-4 text-amber-600" />
                          <p className="text-sm text-amber-700">
                            適切なテンプレートを判定できませんでした。手動で選択してください。
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* AI判定エラーの表示 */}
              {selectedFile && !isDetecting && detectionError && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-amber-800">AI判定に失敗しました</p>
                      <p className="text-xs text-amber-600 mt-1">{detectionError}</p>
                      <p className="text-xs text-amber-700 mt-2">手動でテンプレートを選択してください。</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: OCR設定選択 */}
              <div className="relative" style={{ zIndex: 1000 }}>
                <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                  2. OCR設定 {detectionResult?.predictedTemplateId && selectedSettingId === detectionResult.predictedTemplateId && (
                    <span className="text-xs font-normal text-green-600 ml-2">
                      <CheckCircle2 className="h-3 w-3 inline-block mr-1" />
                      AI推定を使用
                    </span>
                  )}
                </label>
                <select
                  value={selectedSettingId}
                  onChange={(e) => setSelectedSettingId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                  style={{ color: '#000000' }}
                  disabled={isDetecting || isAutoExecuting}
                >
                  <option value="">設定を選択してください</option>
                  {ocrSettings.map((setting) => (
                    <option key={setting.id} value={setting.id}>
                      {setting.displayName || setting.name}
                      {setting.templateType && ` (${setting.templateType})`}
                    </option>
                  ))}
                </select>
                {selectedSettingId && detectionResult?.predictedTemplateId &&
                 selectedSettingId !== detectionResult.predictedTemplateId && (
                  <p className="text-xs text-amber-600 mt-1">
                    AI推定とは異なるテンプレートが選択されています
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
                    if (isAutoExecuting) return;
                    setIsExecuteModalOpen(false);
                    setSelectedFile(null);
                    setSelectedSettingId('');
                    setExecuteError('');
                    setDetectionResult(null);
                    setDetectionError('');
                  }}
                  className="flex-1 rounded-lg border border-gray-300 py-2 px-4 font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isAutoExecuting}
                >
                  キャンセル
                </button>
                <button
                  onClick={handleExecute}
                  className="flex-1 rounded-lg bg-green-800 py-2 px-4 font-semibold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!selectedSettingId || !selectedFile || isDetecting || isAutoExecuting}
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
              <th className="p-3 text-left text-sm font-semibold text-gray-600">OCR設定名</th>
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
              historyList.map((item) => {
                // ファイル名を取得（長い場合は省略）
                const fullFileName = item.original_file_path.split('/').pop() || '';
                const displayFileName = fullFileName.length > 30
                  ? fullFileName.slice(0, 27) + '...'
                  : fullFileName;

                return (
                  <tr key={item.id} className="border-b hover:bg-gray-50">
                    <td className="p-3">{getStatusChip(item.status)}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-700" title={fullFileName}>
                          {displayFileName}
                        </span>
                        {item.status === 'completed' && (
                          item.isHumanConfirmed ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 border border-blue-200">
                              <CheckCircle className="w-3 h-3" />
                              確定
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                              <Clock className="w-3 h-3" />
                              未確定
                            </span>
                          )
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-sm text-gray-700">
                      {item.settingName}
                    </td>
                    <td className="p-3 text-sm text-gray-500">
                      {item.executed_at.toDate().toLocaleString()}
                    </td>
                    <td className="p-3 text-sm">
                      <Link
                        href={`/dashboard/history/view/${item.id}`}
                        className="font-medium text-green-800 hover:text-green-700"
                      >
                        詳細
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
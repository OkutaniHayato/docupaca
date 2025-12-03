"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { db, storage } from '@/config/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  Timestamp,
  orderBy,
  onSnapshot
} from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Upload, X, CheckCircle, Clock, Building2, FileText, Filter } from 'lucide-react';
import { Organization, OcrSetting } from '@/types/ocr';

// OCR履歴アイテムの型定義
interface OcrHistoryItem {
  id: string;
  setting_id: string;
  status: 'processing' | 'completed' | 'failed';
  original_file_path: string;
  executed_at: Timestamp;
  settingName?: string;
  organizationId?: string;
  organizationName?: string;
  isHumanConfirmed?: boolean;
}

interface OrganizationWithId extends Organization {
  id: string;
}

interface OcrSettingWithId extends OcrSetting {
  id: string;
}

/**
 * OCR実行履歴一覧ページ
 */
export default function HistoryPage() {
  const [historyList, setHistoryList] = useState<OcrHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { currentUser } = useAuth();

  // フィルター用のステート
  const [filterOrganizationId, setFilterOrganizationId] = useState<string>('');
  const [filterSettingId, setFilterSettingId] = useState<string>('');

  // 新規実行モーダル用のステート
  const [isExecuteModalOpen, setIsExecuteModalOpen] = useState(false);
  const [organizations, setOrganizations] = useState<OrganizationWithId[]>([]);
  const [ocrSettings, setOcrSettings] = useState<OcrSettingWithId[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>('');
  const [selectedSettingId, setSelectedSettingId] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [executeError, setExecuteError] = useState<string>('');
  const [isExecuting, setIsExecuting] = useState(false);

  // 履歴リストを取得する関数
  const fetchHistoryList = useCallback(async () => {
    if (!currentUser) return;

    try {
      // 組織一覧を取得
      const orgsRef = collection(db, 'organizations');
      const orgsQuery = query(orgsRef, where('owner_id', '==', currentUser.uid));
      const orgsSnapshot = await getDocs(orgsQuery);
      const orgsMap = new Map<string, string>();
      orgsSnapshot.docs.forEach(doc => {
        orgsMap.set(doc.id, doc.data().name);
      });

      // ユーザーが所有する OCR設定 の ID をすべて取得
      const settingsRef = collection(db, "ocr_settings");
      const settingsQuery = query(settingsRef, where("owner_id", "==", currentUser.uid));
      const settingsSnapshot = await getDocs(settingsQuery);

      // 設定IDと設定名・組織IDのマップを作成
      const settingsMap = new Map<string, { name: string; organizationId?: string }>();
      settingsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        settingsMap.set(doc.id, {
          name: data.displayName || data.name || doc.id,
          organizationId: data.organization_id,
        });
      });

      const settingIds = Array.from(settingsMap.keys());

      if (settingIds.length === 0) {
        setHistoryList([]);
        return;
      }

      // 履歴を検索
      const historyRef = collection(db, "ocr_history");
      const historyQuery = query(historyRef, where("setting_id", "in", settingIds));

      const historySnapshot = await getDocs(historyQuery);

      const histories: OcrHistoryItem[] = [];
      historySnapshot.forEach((doc) => {
        const data = doc.data();
        const settingInfo = settingsMap.get(data.setting_id);
        histories.push({
          id: doc.id,
          setting_id: data.setting_id,
          status: data.status,
          original_file_path: data.original_file_path,
          executed_at: data.executed_at,
          settingName: settingInfo?.name || data.setting_id,
          organizationId: settingInfo?.organizationId,
          organizationName: settingInfo?.organizationId ? orgsMap.get(settingInfo.organizationId) : undefined,
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

  // 組織一覧を取得
  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, 'organizations'),
      where('owner_id', '==', currentUser.uid),
      orderBy('name', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const orgs: OrganizationWithId[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as OrganizationWithId));
      setOrganizations(orgs);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // OCR設定を取得
  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, 'ocr_settings'),
      where('owner_id', '==', currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const settings: OcrSettingWithId[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as OcrSettingWithId));
      setOcrSettings(settings);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // フィルタリングされた履歴リスト
  const filteredHistoryList = useMemo(() => {
    return historyList.filter(item => {
      // 組織フィルター
      if (filterOrganizationId && item.organizationId !== filterOrganizationId) {
        return false;
      }
      // 帳票名フィルター
      if (filterSettingId && item.setting_id !== filterSettingId) {
        return false;
      }
      return true;
    });
  }, [historyList, filterOrganizationId, filterSettingId]);

  // フィルター用の組織でフィルタされた帳票リスト
  const filterableSettings = useMemo(() => {
    if (!filterOrganizationId) {
      return ocrSettings;
    }
    return ocrSettings.filter(s => s.organization_id === filterOrganizationId);
  }, [filterOrganizationId, ocrSettings]);

  // 選択した組織に紐づくテンプレートをフィルタ（新規実行用）
  const filteredSettings = useMemo(() => {
    if (!selectedOrganizationId) {
      // 「未分類」が選択された場合
      if (selectedOrganizationId === '') {
        return ocrSettings;
      }
      return [];
    }
    if (selectedOrganizationId === '_unassigned') {
      // 未分類（組織なし）のテンプレートのみ
      return ocrSettings.filter(s => !s.organization_id);
    }
    return ocrSettings.filter(s => s.organization_id === selectedOrganizationId);
  }, [selectedOrganizationId, ocrSettings]);

  // 組織選択時にテンプレート選択をリセット
  useEffect(() => {
    setSelectedSettingId('');
  }, [selectedOrganizationId]);

  // フィルター用：組織選択時に帳票フィルターをリセット
  useEffect(() => {
    setFilterSettingId('');
  }, [filterOrganizationId]);

  // ファイル選択ハンドラー
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setExecuteError('');
    }
  };

  // モーダルを閉じる
  const handleCloseModal = () => {
    setIsExecuteModalOpen(false);
    setSelectedFile(null);
    setSelectedOrganizationId('');
    setSelectedSettingId('');
    setExecuteError('');
  };

  // 実行ハンドラー
  const handleExecute = async () => {
    if (!currentUser) {
      setExecuteError('ユーザーが認証されていません');
      return;
    }

    if (!selectedSettingId) {
      setExecuteError('テンプレートを選択してください');
      return;
    }

    if (!selectedFile) {
      setExecuteError('ファイルを選択してください');
      return;
    }

    setExecuteError('');
    setIsExecuting(true);

    try {
      // 1. ファイルをCloud Storageにアップロード
      const timestamp = Date.now();
      const fileName = `${timestamp}_${selectedFile.name}`;
      const storageRef = ref(storage, `ocr_executions/${currentUser.uid}/${fileName}`);

      await uploadBytes(storageRef, selectedFile);
      const filePath = `ocr_executions/${currentUser.uid}/${fileName}`;

      // モーダルを閉じてテーブルでローディング表示
      handleCloseModal();

      // 一時的なアイテムを即座にUIに追加（楽観的更新）
      const tempItem: OcrHistoryItem = {
        id: `temp_${timestamp}`,
        setting_id: selectedSettingId,
        status: 'processing',
        original_file_path: filePath,
        executed_at: Timestamp.now(),
        settingName: ocrSettings.find(s => s.id === selectedSettingId)?.name || selectedSettingId,
      };

      // 新しいアイテムを先頭に追加
      setHistoryList(prev => [tempItem, ...prev]);

      // 2. executeOcr Cloud Functionを呼び出し
      const functions = getFunctions(undefined, 'asia-northeast1');
      const executeOcr = httpsCallable(functions, 'executeOcr');

      executeOcr({
        setting_id: selectedSettingId,
        file_path: filePath,
        user_id: currentUser.uid,
      }).then(() => {
        fetchHistoryList();
      }).catch((error) => {
        console.error('Execute error:', error);
        fetchHistoryList();
      });
    } catch (error) {
      console.error('Execute error:', error);
      setExecuteError(error instanceof Error ? error.message : '実行中にエラーが発生しました');
    } finally {
      setIsExecuting(false);
    }
  };

  // フィルターをクリア
  const handleClearFilters = () => {
    setFilterOrganizationId('');
    setFilterSettingId('');
  };

  // ステータスチップの表示
  const getStatusChip = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 flex items-center gap-1">
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            完了
          </span>
        );
      case 'failed':
        return (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 flex items-center gap-1">
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            失敗
          </span>
        );
      default:
        return (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 flex items-center gap-1">
            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-700"></div>
            処理中
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

      {/* フィルターエリア */}
      <div className="mb-4 p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="h-4 w-4 text-gray-600" />
          <span className="text-sm font-semibold text-gray-700">フィルター</span>
          {(filterOrganizationId || filterSettingId) && (
            <button
              onClick={handleClearFilters}
              className="ml-auto text-xs text-gray-500 hover:text-gray-700 underline"
            >
              クリア
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-4">
          {/* 組織フィルター */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              <Building2 className="h-3 w-3 inline-block mr-1" />
              組織（会社名）
            </label>
            <select
              value={filterOrganizationId}
              onChange={(e) => setFilterOrganizationId(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">すべての組織</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>

          {/* 帳票名フィルター */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              <FileText className="h-3 w-3 inline-block mr-1" />
              帳票名（OCR設定）
            </label>
            <select
              value={filterSettingId}
              onChange={(e) => setFilterSettingId(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">すべての帳票</option>
              {filterableSettings.map((setting) => (
                <option key={setting.id} value={setting.id}>
                  {setting.displayName || setting.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {(filterOrganizationId || filterSettingId) && (
          <div className="mt-2 text-xs text-gray-500">
            {filteredHistoryList.length} 件の結果
          </div>
        )}
      </div>

      {/* 新規実行モーダル */}
      {isExecuteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0, 0, 0, 0.1)' }}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between p-6 border-b">
              <h3 className="text-xl font-bold text-gray-900">帳票を実行</h3>
              <button
                onClick={handleCloseModal}
                className="text-gray-400 hover:text-gray-600"
                disabled={isExecuting}
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Step 1: ファイルアップロード */}
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  1. 帳票ファイル (PDF/画像)
                </label>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={handleFileChange}
                  disabled={isExecuting}
                  className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100 disabled:opacity-50"
                />
                {selectedFile && (
                  <p className="mt-2 text-sm text-gray-700">
                    選択中: <span className="font-medium">{selectedFile.name}</span>
                  </p>
                )}
              </div>

              {/* Step 2: 組織選択 */}
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  <Building2 className="h-4 w-4 inline-block mr-1" />
                  2. 組織（取引先）を選択
                </label>
                <select
                  value={selectedOrganizationId}
                  onChange={(e) => setSelectedOrganizationId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                  disabled={isExecuting}
                >
                  <option value="">-- 組織を選択 --</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                  {/* 未分類テンプレートがある場合のみ表示 */}
                  {ocrSettings.some(s => !s.organization_id) && (
                    <option value="_unassigned">（未分類）</option>
                  )}
                </select>
                {organizations.length === 0 && (
                  <p className="mt-1 text-xs text-gray-500">
                    組織が登録されていません。<Link href="/dashboard/organizations" className="text-green-600 hover:underline">組織マスタ</Link>から登録してください。
                  </p>
                )}
              </div>

              {/* Step 3: テンプレート選択 */}
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  <FileText className="h-4 w-4 inline-block mr-1" />
                  3. テンプレートを選択
                </label>
                <select
                  value={selectedSettingId}
                  onChange={(e) => setSelectedSettingId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-100"
                  disabled={isExecuting || !selectedOrganizationId}
                >
                  <option value="">-- テンプレートを選択 --</option>
                  {filteredSettings.map((setting) => (
                    <option key={setting.id} value={setting.id}>
                      {setting.displayName || setting.name}
                      {setting.templateType && ` (${setting.templateType})`}
                    </option>
                  ))}
                </select>
                {selectedOrganizationId && filteredSettings.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600">
                    この組織にはテンプレートが登録されていません。
                  </p>
                )}
                {!selectedOrganizationId && (
                  <p className="mt-1 text-xs text-gray-500">
                    組織を選択するとテンプレートが表示されます
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
                  onClick={handleCloseModal}
                  className="flex-1 rounded-lg border border-gray-300 py-2 px-4 font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50"
                  disabled={isExecuting}
                >
                  キャンセル
                </button>
                <button
                  onClick={handleExecute}
                  className="flex-1 rounded-lg bg-green-800 py-2 px-4 font-semibold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!selectedSettingId || !selectedFile || isExecuting}
                >
                  {isExecuting ? '実行中...' : '実行'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full table-fixed">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-left text-sm font-semibold text-gray-600" style={{ width: '90px' }}>ステータス</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600" style={{ width: '18%' }}>組織名</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600" style={{ width: '30%' }}>ファイル名</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600" style={{ width: '80px' }}>確定</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600" style={{ width: '20%' }}>OCR設定名</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600" style={{ width: '140px' }}>実行日時</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="p-3 text-center text-gray-500">読み込み中...</td>
              </tr>
            ) : filteredHistoryList.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-3 text-center text-gray-500">
                  {historyList.length === 0 ? '実行履歴はありません。' : 'フィルター条件に一致する履歴がありません。'}
                </td>
              </tr>
            ) : (
              filteredHistoryList.map((item) => {
                // ファイル名を取得（タイムスタンプ部分を除去）
                const fullFileName = item.original_file_path.split('/').pop() || '';
                // タイムスタンプ_ファイル名 形式の場合、タイムスタンプを除去
                const cleanFileName = fullFileName.replace(/^\d+_/, '');
                const displayFileName = cleanFileName.length > 40
                  ? cleanFileName.slice(0, 37) + '...'
                  : cleanFileName;

                return (
                  <tr key={item.id} className="border-b hover:bg-gray-50">
                    <td className="p-3">{getStatusChip(item.status)}</td>
                    <td className="p-3">
                      <span className="text-sm text-gray-700 truncate block">
                        {item.organizationName || '-'}
                      </span>
                    </td>
                    <td className="p-3">
                      <Link
                        href={`/dashboard/history/view/${item.id}`}
                        className="text-sm text-green-800 hover:text-green-600 hover:underline font-medium"
                        title={cleanFileName}
                      >
                        {displayFileName}
                      </Link>
                    </td>
                    <td className="p-3">
                      {item.status === 'completed' && (
                        item.isHumanConfirmed ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                            <CheckCircle className="w-3 h-3" />
                            確定
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
                            <Clock className="w-3 h-3" />
                            未確定
                          </span>
                        )
                      )}
                    </td>
                    <td className="p-3">
                      <span className="text-sm text-gray-700">
                        {item.settingName}
                      </span>
                    </td>
                    <td className="p-3 text-sm text-gray-500">
                      {item.executed_at.toDate().toLocaleString()}
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

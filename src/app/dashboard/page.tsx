"use client";

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/config/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  Timestamp,
  orderBy,
  limit
} from 'firebase/firestore';
import { Settings, ArrowRight, CheckCircle, Clock } from 'lucide-react';

// 型定義
interface OcrSettingItem {
  id: string;
  name: string;
  displayName?: string;
  organization_id?: string;
  organizationName?: string;
  created_at?: Timestamp;
}

interface OcrHistoryItem {
  id: string;
  setting_id: string;
  status: 'processing' | 'completed' | 'failed';
  original_file_path: string;
  executed_at: Timestamp;
  settingName?: string;
  organizationName?: string;
  isHumanConfirmed?: boolean;
}

interface Organization {
  id: string;
  name: string;
}

/**
 * ダッシュボード トップページ
 * 実データを表示
 */
export default function DashboardPage() {
  const [ocrSettings, setOcrSettings] = useState<OcrSettingItem[]>([]);
  const [historyList, setHistoryList] = useState<OcrHistoryItem[]>([]);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const { currentUser } = useAuth();

  // OCR設定一覧を取得
  const fetchOcrSettings = useCallback(async () => {
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

      // OCR設定を取得
      const settingsRef = collection(db, 'ocr_settings');
      const settingsQuery = query(
        settingsRef,
        where('owner_id', '==', currentUser.uid)
      );
      const settingsSnapshot = await getDocs(settingsQuery);

      const settings: OcrSettingItem[] = settingsSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name || doc.id,
          displayName: data.displayName,
          organization_id: data.organization_id,
          organizationName: data.organization_id ? orgsMap.get(data.organization_id) : undefined,
          created_at: data.created_at,
        };
      });

      // 作成日時の降順にソート
      settings.sort((a, b) => {
        const timeA = a.created_at?.toMillis() || 0;
        const timeB = b.created_at?.toMillis() || 0;
        return timeB - timeA;
      });

      setOcrSettings(settings.slice(0, 6)); // 最新6件を表示
    } catch (error) {
      console.error('Error fetching OCR settings:', error);
    } finally {
      setIsLoadingSettings(false);
    }
  }, [currentUser]);

  // 履歴リストを取得
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

      // OCR設定を取得
      const settingsRef = collection(db, 'ocr_settings');
      const settingsQuery = query(settingsRef, where('owner_id', '==', currentUser.uid));
      const settingsSnapshot = await getDocs(settingsQuery);

      const settingsMap = new Map<string, { name: string; organizationName?: string }>();
      settingsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        settingsMap.set(doc.id, {
          name: data.displayName || data.name || doc.id,
          organizationName: data.organization_id ? orgsMap.get(data.organization_id) : undefined,
        });
      });

      const settingIds = Array.from(settingsMap.keys());

      if (settingIds.length === 0) {
        setHistoryList([]);
        return;
      }

      // 履歴を取得（最大20件）
      const historyRef = collection(db, 'ocr_history');
      const historyQuery = query(historyRef, where('setting_id', 'in', settingIds));
      const historySnapshot = await getDocs(historyQuery);

      const histories: OcrHistoryItem[] = historySnapshot.docs.map(doc => {
        const data = doc.data();
        const settingInfo = settingsMap.get(data.setting_id);
        return {
          id: doc.id,
          setting_id: data.setting_id,
          status: data.status,
          original_file_path: data.original_file_path,
          executed_at: data.executed_at,
          settingName: settingInfo?.name || data.setting_id,
          organizationName: settingInfo?.organizationName,
          isHumanConfirmed: data.isHumanConfirmed || false,
        };
      });

      // 実行日時の降順にソート
      histories.sort((a, b) => {
        const timeA = a.executed_at?.toMillis() || 0;
        const timeB = b.executed_at?.toMillis() || 0;
        return timeB - timeA;
      });

      setHistoryList(histories.slice(0, 20)); // 最新20件
    } catch (error) {
      console.error('Error fetching history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [currentUser]);

  useEffect(() => {
    fetchOcrSettings();
    fetchHistoryList();
  }, [fetchOcrSettings, fetchHistoryList]);

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
      {/* OCR設定一覧 */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-gray-800">OCR設定一覧</h2>
        <Link
          href="/dashboard/settings"
          className="flex items-center gap-1 text-sm text-green-700 hover:text-green-800 font-medium"
        >
          すべて見る
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {isLoadingSettings ? (
        <div className="text-center text-gray-500 py-8">読み込み中...</div>
      ) : ocrSettings.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
          <Settings className="h-12 w-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-600 mb-4">OCR設定がまだありません</p>
          <Link
            href="/dashboard/settings/create"
            className="inline-block rounded-lg bg-green-800 py-2 px-4 font-semibold text-white hover:bg-green-700"
          >
            OCR設定を作成
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ocrSettings.map(setting => (
            <Link
              key={setting.id}
              href={`/dashboard/settings/${setting.id}`}
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md hover:border-green-300 transition-all"
            >
              <h3 className="font-semibold text-green-800 truncate">
                {setting.displayName || setting.name}
              </h3>
              {setting.organizationName && (
                <p className="text-xs text-gray-500 mt-1">
                  {setting.organizationName}
                </p>
              )}
              <p className="text-sm text-gray-500 mt-2">
                作成日: {setting.created_at?.toDate().toLocaleDateString('ja-JP') || '不明'}
              </p>
            </Link>
          ))}
        </div>
      )}

      {/* 最近の実行履歴 */}
      <div className="flex items-center justify-between mt-8 mb-4">
        <h2 className="text-2xl font-bold text-gray-800">最近の実行履歴</h2>
        <Link
          href="/dashboard/history"
          className="flex items-center gap-1 text-sm text-green-700 hover:text-green-800 font-medium"
        >
          すべて見る
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full table-fixed">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-left text-sm font-semibold text-gray-600" style={{ width: '90px' }}>ステータス</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600" style={{ width: '20%' }}>組織名</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600" style={{ width: '25%' }}>ファイル名</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600" style={{ width: '70px' }}>確定</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600" style={{ width: '20%' }}>OCR設定名</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600" style={{ width: '140px' }}>実行日時</th>
            </tr>
          </thead>
          <tbody>
            {isLoadingHistory ? (
              <tr>
                <td colSpan={6} className="p-3 text-center text-gray-500">読み込み中...</td>
              </tr>
            ) : historyList.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-3 text-center text-gray-500">実行履歴はありません</td>
              </tr>
            ) : (
              historyList.map((item) => {
                const fullFileName = item.original_file_path.split('/').pop() || '';
                const cleanFileName = fullFileName.replace(/^\d+_/, '');
                const displayFileName = cleanFileName.length > 30
                  ? cleanFileName.slice(0, 27) + '...'
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
                      <span className="text-sm text-gray-700 truncate block">
                        {item.settingName}
                      </span>
                    </td>
                    <td className="p-3 text-sm text-gray-500">
                      {item.executed_at?.toDate().toLocaleString('ja-JP', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
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

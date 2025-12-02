"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/config/firebase';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
  doc,
  deleteDoc
} from 'firebase/firestore';
import { Trash2, Copy, Building2, Settings, Plus, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Organization } from '@/types/ocr';

interface OcrSetting {
  id: string;
  name: string;
  model_name: string;
  organization_id?: string;
  created_at: Timestamp;
}

interface OrganizationWithId extends Organization {
  id: string;
}

/**
 * OCR設定一覧ページ
 * 組織でフィルタリング可能
 */
export default function OcrSettingsPage() {
  const [settingsList, setSettingsList] = useState<OcrSetting[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationWithId[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const { currentUser } = useAuth();
  const router = useRouter();

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

  // OCR設定一覧を取得
  useEffect(() => {
    if (!currentUser) {
      setIsLoading(false);
      return;
    }

    const q = query(
      collection(db, 'ocr_settings'),
      where('owner_id', '==', currentUser.uid),
      orderBy('created_at', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const settings: OcrSetting[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as OcrSetting));
      setSettingsList(settings);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // フィルタリングされた設定一覧
  const filteredSettings = selectedOrgId
    ? selectedOrgId === '_unassigned'
      ? settingsList.filter(s => !s.organization_id)
      : settingsList.filter(s => s.organization_id === selectedOrgId)
    : settingsList;

  // 組織名を取得
  const getOrgName = (orgId?: string) => {
    if (!orgId) return '未分類';
    const org = organizations.find(o => o.id === orgId);
    return org?.name || '不明';
  };

  /**
   * 削除処理
   */
  const handleDeleteSetting = async (id: string) => {
    if (!window.confirm("この設定を削除してもよろしいですか？この操作は取り消せません。")) {
      return;
    }

    setIsDeleting(id);
    try {
      await deleteDoc(doc(db, "ocr_settings", id));
    } catch (error) {
      console.error("Error deleting setting: ", error);
      alert("削除に失敗しました。");
    } finally {
      setIsDeleting(null);
    }
  };

  /**
   * テンプレートとしてコピー
   */
  const handleCopyAsTemplate = (id: string) => {
    router.push(`/dashboard/settings/new?template=${id}`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
        <span className="ml-2 text-gray-600">読み込み中...</span>
      </div>
    );
  }

  return (
    <div>
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">OCR設定</h1>
          <p className="mt-1 text-sm text-gray-600">
            帳票ごとのOCR抽出設定を管理します
          </p>
        </div>
        <Link
          href="/dashboard/settings/new"
          className="flex items-center gap-2 rounded-lg bg-green-700 py-2 px-4 font-semibold text-white hover:bg-green-600 transition-colors"
        >
          <Plus className="h-5 w-5" />
          新規作成
        </Link>
      </div>

      {/* 組織選択 */}
      <div className="mb-6 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-gray-400" />
          <select
            value={selectedOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-green-500 focus:ring-2 focus:ring-green-500"
          >
            <option value="">すべての組織</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
            <option value="_unassigned">未分類</option>
          </select>
        </div>
        <span className="text-sm text-gray-500">
          {filteredSettings.length}件の設定
        </span>
      </div>

      {/* 設定一覧 */}
      {filteredSettings.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <Settings className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            {selectedOrgId ? '該当する設定がありません' : '設定がありません'}
          </h3>
          <p className="mt-2 text-sm text-gray-500">
            「新規作成」から最初の設定を登録してください
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  設定名
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  組織
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  使用モデル
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  作成日
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredSettings.map((setting) => (
                <tr key={setting.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <Link
                      href={`/dashboard/settings/edit/${setting.id}`}
                      className="text-sm font-medium text-green-700 hover:text-green-600"
                    >
                      {setting.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      setting.organization_id
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {getOrgName(setting.organization_id)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                    {setting.model_name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {setting.created_at?.toDate().toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleCopyAsTemplate(setting.id)}
                        className="text-blue-600 hover:text-blue-500 disabled:opacity-50"
                        disabled={isDeleting !== null}
                        title="テンプレートとしてコピー"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteSetting(setting.id)}
                        className="text-red-600 hover:text-red-500 disabled:opacity-50"
                        disabled={isDeleting === setting.id}
                        title="削除"
                      >
                        {isDeleting === setting.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

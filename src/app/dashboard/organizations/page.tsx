"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/config/firebase';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { Organization } from '@/types/ocr';
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  Loader2,
  ChevronRight,
  Database
} from 'lucide-react';
import Link from 'next/link';

interface OrganizationWithId extends Organization {
  id: string;
}

export default function OrganizationsPage() {
  const { currentUser } = useAuth();
  const [organizations, setOrganizations] = useState<OrganizationWithId[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // モーダル状態
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<OrganizationWithId | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '' });

  // 組織一覧を取得
  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, 'organizations'),
      where('owner_id', '==', currentUser.uid),
      orderBy('created_at', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const orgs: OrganizationWithId[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as OrganizationWithId));
      setOrganizations(orgs);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // モーダルを開く（新規作成）
  const handleOpenCreate = () => {
    setEditingOrg(null);
    setFormData({ name: '', description: '' });
    setIsModalOpen(true);
  };

  // モーダルを開く（編集）
  const handleOpenEdit = (org: OrganizationWithId) => {
    setEditingOrg(org);
    setFormData({
      name: org.name,
      description: org.description || '',
    });
    setIsModalOpen(true);
  };

  // モーダルを閉じる
  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingOrg(null);
    setFormData({ name: '', description: '' });
  }, []);

  // 保存
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !formData.name.trim()) return;

    setIsSaving(true);

    try {
      if (editingOrg) {
        // 更新
        await updateDoc(doc(db, 'organizations', editingOrg.id), {
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          updated_at: serverTimestamp(),
        });
      } else {
        // 新規作成
        await addDoc(collection(db, 'organizations'), {
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          owner_id: currentUser.uid,
          created_at: serverTimestamp(),
        });
      }
      handleCloseModal();
    } catch (error) {
      console.error('保存エラー:', error);
      alert('保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // 削除
  const handleDelete = async (org: OrganizationWithId) => {
    if (!confirm(`「${org.name}」を削除しますか？\n\n※この組織に紐づくOCR設定は削除されません。`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'organizations', org.id));
    } catch (error) {
      console.error('削除エラー:', error);
      alert('削除に失敗しました');
    }
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
          <h1 className="text-2xl font-bold text-gray-900">組織マスタ</h1>
          <p className="mt-1 text-sm text-gray-600">
            OCR設定を紐づける取引先・会社を管理します
          </p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="flex items-center gap-2 rounded-lg bg-green-700 py-2 px-4 font-semibold text-white hover:bg-green-600 transition-colors"
        >
          <Plus className="h-5 w-5" />
          組織を追加
        </button>
      </div>

      {/* 組織一覧 */}
      {organizations.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <Building2 className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">組織がありません</h3>
          <p className="mt-2 text-sm text-gray-500">
            「組織を追加」ボタンから取引先や会社を登録してください
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  組織名
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  説明
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  カスタムDB
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {organizations.map((org) => (
                <tr key={org.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Link
                      href={`/dashboard/organizations/${org.id}`}
                      className="flex items-center group"
                    >
                      <Building2 className="h-5 w-5 text-gray-400 mr-3 group-hover:text-green-600" />
                      <span className="text-sm font-medium text-gray-900 group-hover:text-green-600">
                        {org.name}
                      </span>
                      <ChevronRight className="h-4 w-4 text-gray-400 ml-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-gray-500">
                      {org.description || '-'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <Link
                      href={`/dashboard/organizations/${org.id}`}
                      className="inline-flex items-center gap-1 text-sm text-green-600 hover:text-green-800"
                    >
                      <Database className="h-4 w-4" />
                      <span>管理</span>
                    </Link>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <button
                      onClick={() => handleOpenEdit(org)}
                      className="text-green-600 hover:text-green-900 mr-3"
                      title="編集"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(org)}
                      className="text-red-600 hover:text-red-900"
                      title="削除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* モーダル */}
      {isModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0, 0, 0, 0.1)' }}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingOrg ? '組織を編集' : '組織を追加'}
              </h2>
              <button
                onClick={handleCloseModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                  組織名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  required
                  placeholder="例: 株式会社ABC"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                  説明（オプション）
                </label>
                <textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  placeholder="例: 主要取引先、請求書形式Aを使用"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="rounded-lg bg-gray-200 py-2 px-4 font-semibold text-gray-700 hover:bg-gray-300"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !formData.name.trim()}
                  className="flex items-center gap-2 rounded-lg bg-green-700 py-2 px-4 font-semibold text-white hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      保存中...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      保存
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

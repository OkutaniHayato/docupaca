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
import {
  OrgLearningDoc,
  OrgLearningDocType,
  Organization,
} from '@/types/ocr';
import {
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  Loader2,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Clock,
  FileText,
  Building2,
  Filter,
} from 'lucide-react';

interface OrgLearningDocWithId extends OrgLearningDoc {
  id: string;
}

interface OrganizationWithId extends Organization {
  id: string;
}

// ドキュメントタイプの定義（カテゴリ別）
const DOC_TYPE_CATEGORIES = [
  {
    label: 'マスタ系',
    types: [
      { value: 'customer_master' as OrgLearningDocType, label: '顧客マスタ' },
      { value: 'item_master' as OrgLearningDocType, label: '品目マスタ' },
      { value: 'account_master' as OrgLearningDocType, label: '勘定科目マスタ' },
      { value: 'tax_master' as OrgLearningDocType, label: '税区分マスタ' },
      { value: 'department_master' as OrgLearningDocType, label: '部門マスタ' },
      { value: 'vendor_master' as OrgLearningDocType, label: '仕入先マスタ' },
      { value: 'employee_master' as OrgLearningDocType, label: '従業員マスタ' },
    ],
  },
  {
    label: 'ルール系',
    types: [
      { value: 'rule' as OrgLearningDocType, label: '業務ルール' },
      { value: 'exception' as OrgLearningDocType, label: '例外ルール' },
    ],
  },
  {
    label: '帳票系',
    types: [
      { value: 'invoice' as OrgLearningDocType, label: '請求書' },
      { value: 'quotation' as OrgLearningDocType, label: '見積書' },
      { value: 'purchase_order' as OrgLearningDocType, label: '発注書' },
      { value: 'delivery_note' as OrgLearningDocType, label: '納品書' },
      { value: 'receipt' as OrgLearningDocType, label: '領収書' },
      { value: 'contract' as OrgLearningDocType, label: '契約書' },
    ],
  },
  {
    label: 'フォーマット定義',
    types: [
      { value: 'csv_format' as OrgLearningDocType, label: 'CSVフォーマット' },
      { value: 'excel_format' as OrgLearningDocType, label: 'Excelフォーマット' },
      { value: 'pdf_template' as OrgLearningDocType, label: 'PDFテンプレート' },
    ],
  },
  {
    label: 'その他',
    types: [
      { value: 'other' as OrgLearningDocType, label: 'その他' },
    ],
  },
];

// フラットなタイプリスト（フィルタ用）
const DOC_TYPES: { value: OrgLearningDocType; label: string }[] = DOC_TYPE_CATEGORIES.flatMap(cat => cat.types);

export default function KnowledgePage() {
  const { currentUser } = useAuth();
  const [organizations, setOrganizations] = useState<OrganizationWithId[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [docs, setDocs] = useState<OrgLearningDocWithId[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // フィルタ
  const [filterType, setFilterType] = useState<OrgLearningDocType | ''>('');

  // モーダル状態
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<OrgLearningDocWithId | null>(null);
  const [formData, setFormData] = useState<{
    type: OrgLearningDocType;
    title: string;
    content: string;
  }>({
    type: 'rule',
    title: '',
    content: '',
  });

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

      // 最初の組織を選択
      if (orgs.length > 0 && !selectedOrgId) {
        setSelectedOrgId(orgs[0].id);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, selectedOrgId]);

  // 選択した組織のドキュメント一覧を取得
  useEffect(() => {
    if (!selectedOrgId) {
      setDocs([]);
      return;
    }

    const q = query(
      collection(db, 'orgLearningDocs'),
      where('orgId', '==', selectedOrgId),
      orderBy('updatedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loadedDocs: OrgLearningDocWithId[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as OrgLearningDocWithId));
      setDocs(loadedDocs);
    });

    return () => unsubscribe();
  }, [selectedOrgId]);

  // フィルタリングされたドキュメント
  const filteredDocs = filterType
    ? docs.filter(d => d.type === filterType)
    : docs;

  // モーダルを開く（新規作成）
  const handleOpenCreate = () => {
    setEditingDoc(null);
    setFormData({
      type: 'rule',
      title: '',
      content: '',
    });
    setIsModalOpen(true);
  };

  // モーダルを開く（編集）
  const handleOpenEdit = (docItem: OrgLearningDocWithId) => {
    setEditingDoc(docItem);
    setFormData({
      type: docItem.type,
      title: docItem.title,
      content: docItem.content,
    });
    setIsModalOpen(true);
  };

  // モーダルを閉じる
  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingDoc(null);
    setFormData({
      type: 'rule',
      title: '',
      content: '',
    });
  }, []);

  // 保存
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !selectedOrgId || !formData.title.trim() || !formData.content.trim()) return;

    setIsSaving(true);

    try {
      if (editingDoc) {
        // 更新
        await updateDoc(doc(db, 'orgLearningDocs', editingDoc.id), {
          type: formData.type,
          title: formData.title.trim(),
          content: formData.content.trim(),
          updatedAt: serverTimestamp(),
          updatedBy: currentUser.uid,
          syncStatus: 'pending', // 更新したら再同期が必要
        });
      } else {
        // 新規作成
        await addDoc(collection(db, 'orgLearningDocs'), {
          orgId: selectedOrgId,
          type: formData.type,
          title: formData.title.trim(),
          content: formData.content.trim(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: currentUser.uid,
          syncStatus: 'pending',
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
  const handleDelete = async (docItem: OrgLearningDocWithId) => {
    if (!confirm(`「${docItem.title}」を削除しますか？\n\n※File Searchからも削除されます。`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'orgLearningDocs', docItem.id));
    } catch (error) {
      console.error('削除エラー:', error);
      alert('削除に失敗しました');
    }
  };

  // 手動同期
  const handleSync = async () => {
    if (!currentUser || !selectedOrgId) return;

    setIsSyncing(true);
    setSyncMessage(null);

    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_FUNCTIONS_URL || ''}/syncOrgLearningDocsHttp`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            orgId: selectedOrgId,
            forceResync: false,
          }),
        }
      );

      const data = await response.json();

      if (data.success) {
        setSyncMessage({
          type: 'success',
          message: `同期完了: ${data.result.stats.syncedDocs}件成功, ${data.result.stats.failedDocs}件失敗`,
        });
      } else {
        setSyncMessage({
          type: 'error',
          message: data.error || '同期に失敗しました',
        });
      }
    } catch (error) {
      console.error('同期エラー:', error);
      setSyncMessage({
        type: 'error',
        message: '同期に失敗しました',
      });
    } finally {
      setIsSyncing(false);
      // 3秒後にメッセージをクリア
      setTimeout(() => setSyncMessage(null), 5000);
    }
  };

  // 同期ステータスのアイコンを取得
  const getSyncStatusIcon = (status?: string) => {
    switch (status) {
      case 'synced':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'syncing':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'pending':
      default:
        return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

  // 同期ステータスのラベルを取得
  const getSyncStatusLabel = (status?: string) => {
    switch (status) {
      case 'synced':
        return '同期済み';
      case 'syncing':
        return '同期中...';
      case 'failed':
        return '同期失敗';
      case 'pending':
      default:
        return '未同期';
    }
  };

  // ドキュメントタイプのラベルを取得
  const getTypeLabel = (type: OrgLearningDocType) => {
    return DOC_TYPES.find(t => t.value === type)?.label || type;
  };

  // 日時フォーマット
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formatDate = (date: any) => {
    if (!date) return '-';
    // Firestoreの Timestamp は toDate() メソッドを持つ
    const d = date.toDate ? date.toDate() : (date instanceof Date ? date : new Date(date));
    return d.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
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
          <h1 className="text-2xl font-bold text-gray-900">ナレッジ管理</h1>
          <p className="mt-1 text-sm text-gray-600">
            組織ごとの業務ルール・マスタデータをAIに学習させます
          </p>
        </div>
        <div className="flex items-center gap-2">
          {syncMessage && (
            <div
              className={`px-3 py-1 rounded text-sm ${
                syncMessage.type === 'success'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              }`}
            >
              {syncMessage.message}
            </div>
          )}
          <button
            onClick={handleSync}
            disabled={!selectedOrgId || isSyncing}
            className="flex items-center gap-2 rounded-lg bg-blue-600 py-2 px-4 font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`h-5 w-5 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? '同期中...' : '同期実行'}
          </button>
          <button
            onClick={handleOpenCreate}
            disabled={!selectedOrgId}
            className="flex items-center gap-2 rounded-lg bg-green-700 py-2 px-4 font-semibold text-white hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-5 w-5" />
            ナレッジを追加
          </button>
        </div>
      </div>

      {/* 組織選択とフィルタ */}
      <div className="mb-6 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-gray-400" />
          <select
            value={selectedOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-green-500 focus:ring-2 focus:ring-green-500"
          >
            <option value="">組織を選択</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-5 w-5 text-gray-400" />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as OrgLearningDocType | '')}
            className="rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-green-500 focus:ring-2 focus:ring-green-500"
          >
            <option value="">すべてのタイプ</option>
            {DOC_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        <span className="text-sm text-gray-500">
          {filteredDocs.length}件のナレッジ
        </span>
      </div>

      {/* ドキュメント一覧 */}
      {organizations.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <Building2 className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">組織がありません</h3>
          <p className="mt-2 text-sm text-gray-500">
            先に「組織マスタ」から組織を作成してください
          </p>
        </div>
      ) : !selectedOrgId ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <Building2 className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">組織を選択してください</h3>
          <p className="mt-2 text-sm text-gray-500">
            左上のセレクトから組織を選択してください
          </p>
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <BookOpen className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">ナレッジがありません</h3>
          <p className="mt-2 text-sm text-gray-500">
            「ナレッジを追加」ボタンから業務ルールやマスタデータを登録してください
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  タイトル
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  タイプ
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  同期ステータス
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  更新日時
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredDocs.map((docItem) => (
                <tr key={docItem.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      <FileText className="h-5 w-5 text-gray-400 mr-3" />
                      <div>
                        <span className="text-sm font-medium text-gray-900">
                          {docItem.title}
                        </span>
                        <p className="text-xs text-gray-500 truncate max-w-xs">
                          {docItem.content.substring(0, 50)}...
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                      {getTypeLabel(docItem.type)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {getSyncStatusIcon(docItem.syncStatus)}
                      <span className="text-sm text-gray-600">
                        {getSyncStatusLabel(docItem.syncStatus)}
                      </span>
                    </div>
                    {docItem.syncError && (
                      <p className="text-xs text-red-500 mt-1 truncate max-w-xs" title={docItem.syncError}>
                        {docItem.syncError}
                      </p>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-500">
                      {formatDate(docItem.updatedAt)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <button
                      onClick={() => handleOpenEdit(docItem)}
                      className="text-green-600 hover:text-green-900 mr-3"
                      title="編集"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(docItem)}
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
        <div className="fixed inset-0 flex items-center justify-center z-50 px-8" style={{ backgroundColor: 'rgba(0, 0, 0, 0.1)' }}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {editingDoc ? 'ナレッジを編集' : 'ナレッジを追加'}
                </h2>
                <p className="text-sm text-green-600 flex items-center gap-1 mt-1">
                  <Building2 className="h-4 w-4" />
                  {organizations.find(org => org.id === selectedOrgId)?.name || '組織未選択'}
                </p>
              </div>
              <button
                onClick={handleCloseModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label htmlFor="type" className="block text-sm font-medium text-gray-700">
                  タイプ <span className="text-red-500">*</span>
                </label>
                <select
                  id="type"
                  value={formData.type}
                  onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value as OrgLearningDocType }))}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-green-500 focus:ring-2 focus:ring-green-500"
                >
                  {DOC_TYPE_CATEGORIES.map((category) => (
                    <optgroup key={category.label} label={category.label}>
                      {category.types.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="title" className="block text-sm font-medium text-gray-700">
                  タイトル <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  required
                  placeholder="例: 顧客コード割当ルール"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label htmlFor="content" className="block text-sm font-medium text-gray-700">
                  コンテンツ <span className="text-red-500">*</span>
                  <span className="text-xs text-gray-500 ml-2">(マークダウン形式推奨)</span>
                </label>
                <textarea
                  id="content"
                  value={formData.content}
                  onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                  required
                  rows={12}
                  placeholder={`例:
# 顧客コード割当ルール

## 基本ルール
- 顧客名に「株式会社ABC」が含まれる場合 → 顧客コード: C001
- 顧客名に「有限会社XYZ」が含まれる場合 → 顧客コード: C002

## 例外ルール
- 「ABC商事」は「株式会社ABC」とは異なる顧客（コード: C003）`}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 font-mono text-sm"
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
                  disabled={isSaving || !formData.title.trim() || !formData.content.trim()}
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

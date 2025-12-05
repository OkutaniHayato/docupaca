"use client";

import React, { useState, useEffect, use, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/config/firebase';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { Organization, CustomDatabase, CustomRecord, CustomField } from '@/types/ocr';
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  Loader2,
  Database,
  Table,
  Settings,
} from 'lucide-react';
import Link from 'next/link';

interface OrganizationWithId extends Organization {
  id: string;
}

interface CustomDatabaseWithId extends CustomDatabase {
  id: string;
}

interface CustomRecordWithId extends CustomRecord {
  id: string;
}

export default function DatabaseRecordsPage({
  params,
}: {
  params: Promise<{ id: string; databaseId: string }>;
}) {
  const { id: orgId, databaseId } = use(params);
  const { currentUser } = useAuth();
  const [organization, setOrganization] = useState<OrganizationWithId | null>(null);
  const [database, setDatabase] = useState<CustomDatabaseWithId | null>(null);
  const [records, setRecords] = useState<CustomRecordWithId[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // モーダル状態
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CustomRecordWithId | null>(null);
  const [formData, setFormData] = useState<{ [fieldId: string]: string | number | null }>({});
  const [isSaving, setIsSaving] = useState(false);

  // 組織とDB情報を取得
  useEffect(() => {
    if (!currentUser || !orgId || !databaseId) return;

    const fetchData = async () => {
      try {
        // 組織を取得
        const orgDoc = await getDoc(doc(db, 'organizations', orgId));
        if (!orgDoc.exists()) {
          setError('組織が見つかりません');
          setIsLoading(false);
          return;
        }
        const orgData = orgDoc.data() as Organization;
        if (orgData.owner_id !== currentUser.uid) {
          setError('この組織へのアクセス権限がありません');
          setIsLoading(false);
          return;
        }
        setOrganization({ id: orgDoc.id, ...orgData });

        // DBを取得
        const dbDoc = await getDoc(doc(db, 'customDatabases', databaseId));
        if (!dbDoc.exists()) {
          setError('カスタムDBが見つかりません');
          setIsLoading(false);
          return;
        }
        const dbData = dbDoc.data() as CustomDatabase;
        if (dbData.ownerId !== currentUser.uid || dbData.organizationId !== orgId) {
          setError('このカスタムDBへのアクセス権限がありません');
          setIsLoading(false);
          return;
        }
        setDatabase({ id: dbDoc.id, ...dbData });
      } catch (err) {
        console.error('データ取得エラー:', err);
        setError('データの取得に失敗しました');
      }
    };

    fetchData();
  }, [currentUser, orgId, databaseId]);

  // レコード一覧を取得
  useEffect(() => {
    if (!currentUser || !databaseId) return;

    const q = query(
      collection(db, 'customRecords'),
      where('databaseId', '==', databaseId),
      where('ownerId', '==', currentUser.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const recs: CustomRecordWithId[] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      } as CustomRecordWithId));
      setRecords(recs);
      setIsLoading(false);
    }, (err) => {
      console.error('レコード一覧の取得エラー:', err);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, databaseId]);

  // フォームデータを初期化
  const initFormData = useCallback(() => {
    if (!database) return {};
    const data: { [fieldId: string]: string | number | null } = {};
    database.fields.forEach((field) => {
      data[field.id] = '';
    });
    return data;
  }, [database]);

  // モーダルを開く（新規作成）
  const handleOpenCreate = () => {
    setEditingRecord(null);
    setFormData(initFormData());
    setIsModalOpen(true);
  };

  // モーダルを開く（編集）
  const handleOpenEdit = (record: CustomRecordWithId) => {
    setEditingRecord(record);
    setFormData({ ...record.data });
    setIsModalOpen(true);
  };

  // モーダルを閉じる
  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingRecord(null);
    setFormData({});
  }, []);

  // フォームデータを更新
  const handleUpdateFormData = (fieldId: string, value: string, field: CustomField) => {
    let parsedValue: string | number | null = value;

    if (field.type === 'number' || field.type === 'currency') {
      if (value === '') {
        parsedValue = null;
      } else {
        const num = parseFloat(value);
        parsedValue = isNaN(num) ? null : num;
      }
    }

    setFormData((prev) => ({ ...prev, [fieldId]: parsedValue }));
  };

  // 保存
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !database) return;

    // バリデーション
    for (const field of database.fields) {
      if (field.required) {
        const value = formData[field.id];
        if (value === null || value === undefined || value === '') {
          alert(`「${field.name}」は必須項目です`);
          return;
        }
      }
    }

    setIsSaving(true);

    try {
      if (editingRecord) {
        // 更新
        await updateDoc(doc(db, 'customRecords', editingRecord.id), {
          data: formData,
          updatedAt: serverTimestamp(),
        });
      } else {
        // 新規作成
        await addDoc(collection(db, 'customRecords'), {
          databaseId: databaseId,
          organizationId: orgId,
          data: formData,
          ownerId: currentUser.uid,
          createdAt: serverTimestamp(),
        });
      }
      handleCloseModal();
    } catch (err) {
      console.error('保存エラー:', err);
      alert('保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // 削除
  const handleDelete = async (record: CustomRecordWithId) => {
    if (!confirm('このレコードを削除しますか？')) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'customRecords', record.id));
    } catch (err) {
      console.error('削除エラー:', err);
      alert('削除に失敗しました');
    }
  };

  // 値をフォーマット
  const formatValue = (value: string | number | null | undefined, field: CustomField): string => {
    if (value === null || value === undefined || value === '') return '-';

    switch (field.type) {
      case 'currency':
        return `¥${Number(value).toLocaleString()}`;
      case 'number':
        return Number(value).toLocaleString();
      case 'date':
        return String(value);
      default:
        return String(value);
    }
  };

  // 入力タイプを取得
  const getInputType = (field: CustomField): string => {
    switch (field.type) {
      case 'number':
      case 'currency':
        return 'number';
      case 'date':
        return 'date';
      default:
        return 'text';
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

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">{error}</p>
        <Link
          href="/dashboard/organizations"
          className="mt-4 inline-flex items-center text-green-600 hover:text-green-800"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          組織一覧に戻る
        </Link>
      </div>
    );
  }

  if (!organization || !database) {
    return null;
  }

  // フィールドをソート
  const sortedFields = [...database.fields].sort((a, b) => a.order - b.order);

  return (
    <div>
      {/* パンくずリスト */}
      <div className="mb-4">
        <Link
          href={`/dashboard/organizations/${orgId}`}
          className="inline-flex items-center text-sm text-gray-500 hover:text-green-600"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          {organization.name} に戻る
        </Link>
      </div>

      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Database className="h-6 w-6 text-green-600" />
            {database.name}
          </h1>
          {database.description && (
            <p className="mt-1 text-sm text-gray-600">{database.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/organizations/${orgId}/databases/${databaseId}/edit`}
            className="flex items-center gap-2 rounded-lg bg-gray-200 py-2 px-4 font-semibold text-gray-700 hover:bg-gray-300 transition-colors"
          >
            <Settings className="h-4 w-4" />
            項目定義を編集
          </Link>
          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-2 rounded-lg bg-green-700 py-2 px-4 font-semibold text-white hover:bg-green-600 transition-colors"
          >
            <Plus className="h-5 w-5" />
            レコード追加
          </button>
        </div>
      </div>

      {/* レコード一覧 */}
      {records.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <Table className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">レコードがありません</h3>
          <p className="mt-2 text-sm text-gray-500">
            「レコード追加」ボタンからデータを登録してください
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {sortedFields.map((field) => (
                    <th
                      key={field.id}
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                    >
                      {field.name}
                      {field.required && <span className="text-red-500 ml-1">*</span>}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {records.map((record) => (
                  <tr key={record.id} className="hover:bg-gray-50">
                    {sortedFields.map((field) => (
                      <td key={field.id} className="px-4 py-3 whitespace-nowrap">
                        <span className="text-sm text-gray-900">
                          {formatValue(record.data[field.id], field)}
                        </span>
                      </td>
                    ))}
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      <button
                        onClick={() => handleOpenEdit(record)}
                        className="text-green-600 hover:text-green-900 mr-3"
                        title="編集"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(record)}
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
        </div>
      )}

      {/* レコード件数 */}
      <div className="mt-4 text-sm text-gray-500 text-right">
        {records.length}件のレコード
      </div>

      {/* モーダル */}
      {isModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0, 0, 0, 0.1)' }}>
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingRecord ? 'レコードを編集' : 'レコードを追加'}
              </h2>
              <button
                onClick={handleCloseModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              {sortedFields.map((field) => (
                <div key={field.id}>
                  <label
                    htmlFor={`field-${field.id}`}
                    className="block text-sm font-medium text-gray-700"
                  >
                    {field.name}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <input
                    type={getInputType(field)}
                    id={`field-${field.id}`}
                    value={formData[field.id] ?? ''}
                    onChange={(e) => handleUpdateFormData(field.id, e.target.value, field)}
                    required={field.required}
                    step={field.type === 'currency' || field.type === 'number' ? 'any' : undefined}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    {field.type === 'text' && 'テキスト形式'}
                    {field.type === 'number' && '数値形式'}
                    {field.type === 'date' && '日付形式（YYYY-MM-DD）'}
                    {field.type === 'currency' && '金額形式（数値で入力）'}
                  </p>
                </div>
              ))}

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
                  disabled={isSaving}
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

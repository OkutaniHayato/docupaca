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
import {
  Organization,
  CustomDatabase,
  CustomRecord,
  CustomField,
  CustomRecordSingleValue,
} from '@/types/ocr';
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

// フォーム用の明細行データ
interface FormDetailRow {
  [fieldId: string]: string | number | null;
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
  const [singleFormData, setSingleFormData] = useState<{ [fieldId: string]: CustomRecordSingleValue }>({});
  const [detailRows, setDetailRows] = useState<FormDetailRow[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // 組織とDB情報を取得
  useEffect(() => {
    if (!currentUser || !orgId || !databaseId) return;

    const fetchData = async () => {
      try {
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
      const recs: CustomRecordWithId[] = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      } as CustomRecordWithId));
      setRecords(recs);
      setIsLoading(false);
    }, (err) => {
      console.error('レコード一覧の取得エラー:', err);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, databaseId]);

  // フィールドを種別でフィルタ
  const getSingleFields = useCallback(() => {
    if (!database) return [];
    return database.fields
      .filter((f) => f.category === 'single' || !f.category)
      .sort((a, b) => a.order - b.order);
  }, [database]);

  const getDetailFields = useCallback(() => {
    if (!database) return [];
    return database.fields
      .filter((f) => f.category === 'detail')
      .sort((a, b) => a.order - b.order);
  }, [database]);

  // 空の明細行を作成
  const createEmptyDetailRow = useCallback((): FormDetailRow => {
    const row: FormDetailRow = {};
    getDetailFields().forEach((field) => {
      row[field.id] = '';
    });
    return row;
  }, [getDetailFields]);

  // フォームデータを初期化
  const initFormData = useCallback(() => {
    const singleData: { [fieldId: string]: CustomRecordSingleValue } = {};
    getSingleFields().forEach((field) => {
      singleData[field.id] = '';
    });
    setSingleFormData(singleData);

    // 明細項目がある場合は1行だけ追加
    if (getDetailFields().length > 0) {
      setDetailRows([createEmptyDetailRow()]);
    } else {
      setDetailRows([]);
    }
  }, [getSingleFields, getDetailFields, createEmptyDetailRow]);

  // モーダルを開く（新規作成）
  const handleOpenCreate = () => {
    setEditingRecord(null);
    initFormData();
    setIsModalOpen(true);
  };

  // モーダルを開く（編集）
  const handleOpenEdit = (record: CustomRecordWithId) => {
    setEditingRecord(record);
    setSingleFormData({ ...(record.singleData || {}) });
    setDetailRows(record.detailRows?.length ? [...record.detailRows] : [createEmptyDetailRow()]);
    setIsModalOpen(true);
  };

  // モーダルを閉じる
  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingRecord(null);
    setSingleFormData({});
    setDetailRows([]);
  }, []);

  // 単一フィールドの更新
  const handleUpdateSingleField = (fieldId: string, value: string, field: CustomField) => {
    let parsedValue: CustomRecordSingleValue = value;

    if (field.type === 'number' || field.type === 'currency') {
      if (value === '') {
        parsedValue = null;
      } else {
        const num = parseFloat(value);
        parsedValue = isNaN(num) ? null : num;
      }
    }

    setSingleFormData((prev) => ({ ...prev, [fieldId]: parsedValue }));
  };

  // 明細行の更新
  const handleUpdateDetailRow = (rowIndex: number, fieldId: string, value: string, field: CustomField) => {
    let parsedValue: string | number | null = value;

    if (field.type === 'number' || field.type === 'currency') {
      if (value === '') {
        parsedValue = null;
      } else {
        const num = parseFloat(value);
        parsedValue = isNaN(num) ? null : num;
      }
    }

    setDetailRows((prev) => {
      const newRows = [...prev];
      newRows[rowIndex] = { ...newRows[rowIndex], [fieldId]: parsedValue };
      return newRows;
    });
  };

  // 明細行を追加
  const handleAddDetailRow = () => {
    setDetailRows((prev) => [...prev, createEmptyDetailRow()]);
  };

  // 明細行を削除
  const handleRemoveDetailRow = (rowIndex: number) => {
    if (detailRows.length <= 1) {
      alert('最低1行は必要です');
      return;
    }
    setDetailRows((prev) => prev.filter((_, i) => i !== rowIndex));
  };

  // 保存
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !database) return;

    // 単一フィールドのバリデーション
    for (const field of getSingleFields()) {
      if (field.required) {
        const value = singleFormData[field.id];
        if (value === null || value === undefined || value === '') {
          alert(`「${field.name}」は必須項目です`);
          return;
        }
      }
    }

    // 明細フィールドのバリデーション
    const detailFieldsRequired = getDetailFields().filter((f) => f.required);
    for (let rowIndex = 0; rowIndex < detailRows.length; rowIndex++) {
      const row = detailRows[rowIndex];
      for (const field of detailFieldsRequired) {
        const value = row[field.id];
        if (value === null || value === undefined || value === '') {
          alert(`明細行${rowIndex + 1}の「${field.name}」は必須項目です`);
          return;
        }
      }
    }

    setIsSaving(true);

    try {
      const recordData = {
        singleData: singleFormData,
        detailRows: detailRows,
      };

      if (editingRecord) {
        await updateDoc(doc(db, 'customRecords', editingRecord.id), {
          ...recordData,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, 'customRecords'), {
          databaseId: databaseId,
          organizationId: orgId,
          ...recordData,
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

  const singleFields = getSingleFields();
  const detailFields = getDetailFields();
  const allFields = [...database.fields].sort((a, b) => a.order - b.order);

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
                  {allFields.map((field) => (
                    <th
                      key={field.id}
                      className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap ${
                        field.category === 'detail'
                          ? 'text-blue-600 bg-blue-50'
                          : 'text-gray-500'
                      }`}
                    >
                      {field.name}
                      {field.category === 'detail' && (
                        <span className="ml-1 text-blue-400">(明細)</span>
                      )}
                      {field.required && <span className="text-red-500 ml-1">*</span>}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {records.map((record) => {
                  // 明細行の数を計算（最低1行）
                  const detailRowCount = Math.max(1, record.detailRows?.length || 0);

                  return Array.from({ length: detailRowCount }).map((_, rowIndex) => (
                    <tr
                      key={`${record.id}-${rowIndex}`}
                      className={`hover:bg-gray-50 ${
                        rowIndex > 0 ? 'border-t border-gray-100' : ''
                      }`}
                    >
                      {allFields.map((field) => {
                        if (field.category === 'detail') {
                          // 明細フィールド: 各行に値を表示
                          const detailValue = record.detailRows?.[rowIndex]?.[field.id];
                          return (
                            <td
                              key={field.id}
                              className="px-4 py-2 bg-blue-50/30"
                            >
                              <span className="text-sm text-gray-900">
                                {formatValue(detailValue, field)}
                              </span>
                            </td>
                          );
                        } else {
                          // 単一フィールド: 各行に同じ値を表示
                          return (
                            <td
                              key={field.id}
                              className="px-4 py-2"
                            >
                              <span className="text-sm text-gray-900">
                                {formatValue(record.singleData?.[field.id], field)}
                              </span>
                            </td>
                          );
                        }
                      })}
                      {/* 操作ボタン: 最初の行のみ表示 */}
                      {rowIndex === 0 && (
                        <td
                          rowSpan={detailRowCount}
                          className="px-4 py-3 whitespace-nowrap text-right align-top"
                        >
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
                      )}
                    </tr>
                  ));
                })}
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
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white z-10">
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

            <form onSubmit={handleSave} className="p-6 space-y-6">
              {/* 単一項目 */}
              {singleFields.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b">
                    基本項目
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {singleFields.map((field) => (
                      <div key={field.id}>
                        <label
                          htmlFor={`single-${field.id}`}
                          className="block text-sm font-medium text-gray-700"
                        >
                          {field.name}
                          {field.required && <span className="text-red-500 ml-1">*</span>}
                        </label>
                        <input
                          type={getInputType(field)}
                          id={`single-${field.id}`}
                          value={singleFormData[field.id] ?? ''}
                          onChange={(e) => handleUpdateSingleField(field.id, e.target.value, field)}
                          required={field.required}
                          step={field.type === 'currency' || field.type === 'number' ? 'any' : undefined}
                          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 明細項目 */}
              {detailFields.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3 pb-2 border-b">
                    <h3 className="text-sm font-semibold text-blue-700">
                      明細項目
                    </h3>
                    <button
                      type="button"
                      onClick={handleAddDetailRow}
                      className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                    >
                      <Plus className="h-4 w-4" />
                      行を追加
                    </button>
                  </div>

                  <div className="space-y-3">
                    {detailRows.map((row, rowIndex) => (
                      <div
                        key={rowIndex}
                        className="p-4 bg-blue-50 rounded-lg border border-blue-200"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-medium text-blue-700">
                            行 {rowIndex + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveDetailRow(rowIndex)}
                            className="text-red-500 hover:text-red-700"
                            title="この行を削除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {detailFields.map((field) => (
                            <div key={field.id}>
                              <label
                                htmlFor={`detail-${rowIndex}-${field.id}`}
                                className="block text-xs font-medium text-gray-600"
                              >
                                {field.name}
                                {field.required && <span className="text-red-500 ml-1">*</span>}
                              </label>
                              <input
                                type={getInputType(field)}
                                id={`detail-${rowIndex}-${field.id}`}
                                value={row[field.id] ?? ''}
                                onChange={(e) =>
                                  handleUpdateDetailRow(rowIndex, field.id, e.target.value, field)
                                }
                                required={field.required}
                                step={field.type === 'currency' || field.type === 'number' ? 'any' : undefined}
                                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={handleAddDetailRow}
                    className="mt-3 w-full flex items-center justify-center gap-2 p-2 border-2 border-dashed border-blue-300 rounded-lg text-blue-500 hover:border-blue-500 hover:text-blue-600 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    明細行を追加
                  </button>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t">
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

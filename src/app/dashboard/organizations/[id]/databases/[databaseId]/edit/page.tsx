"use client";

import React, { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/config/firebase';
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import { Organization, CustomDatabase, CustomField, CustomFieldType, CustomFieldCategory } from '@/types/ocr';
import {
  ArrowLeft,
  Plus,
  Trash2,
  GripVertical,
  Save,
  Loader2,
  Database,
  AlertTriangle,
} from 'lucide-react';
import Link from 'next/link';

interface OrganizationWithId extends Organization {
  id: string;
}

interface CustomDatabaseWithId extends CustomDatabase {
  id: string;
}

const FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'テキスト' },
  { value: 'number', label: '数値' },
  { value: 'date', label: '日付' },
  { value: 'currency', label: '金額' },
];

const FIELD_CATEGORIES: { value: CustomFieldCategory; label: string }[] = [
  { value: 'single', label: '単一' },
  { value: 'detail', label: '明細' },
];

export default function EditDatabasePage({
  params,
}: {
  params: Promise<{ id: string; databaseId: string }>;
}) {
  const { id: orgId, databaseId } = use(params);
  const router = useRouter();
  const { currentUser } = useAuth();
  const [organization, setOrganization] = useState<OrganizationWithId | null>(null);
  const [database, setDatabase] = useState<CustomDatabaseWithId | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // フォームデータ
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<CustomField[]>([]);

  // ドラッグ中のフィールドインデックス
  const [dragIndex, setDragIndex] = useState<number | null>(null);

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

        // フォームデータを初期化
        setName(dbData.name);
        setDescription(dbData.description || '');
        setFields([...dbData.fields].sort((a, b) => a.order - b.order));
      } catch (err) {
        console.error('データ取得エラー:', err);
        setError('データの取得に失敗しました');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [currentUser, orgId, databaseId]);

  // フィールドを追加
  const handleAddField = (category: CustomFieldCategory = 'single') => {
    setFields([
      ...fields,
      {
        id: uuidv4(),
        name: '',
        type: 'text',
        category,
        required: false,
        order: fields.length,
      },
    ]);
  };

  // フィールドを削除
  const handleRemoveField = (index: number) => {
    if (fields.length <= 1) {
      alert('最低1つのフィールドが必要です');
      return;
    }
    const newFields = fields.filter((_, i) => i !== index);
    setFields(newFields.map((f, i) => ({ ...f, order: i })));
  };

  // フィールドを更新
  const handleUpdateField = (
    index: number,
    key: keyof CustomField,
    value: string | boolean
  ) => {
    const newFields = [...fields];
    newFields[index] = { ...newFields[index], [key]: value };
    setFields(newFields);
  };

  // ドラッグ開始
  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  // ドラッグオーバー
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;

    const newFields = [...fields];
    const [removed] = newFields.splice(dragIndex, 1);
    newFields.splice(index, 0, removed);
    setFields(newFields.map((f, i) => ({ ...f, order: i })));
    setDragIndex(index);
  };

  // ドラッグ終了
  const handleDragEnd = () => {
    setDragIndex(null);
  };

  // 保存
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !databaseId) return;

    // バリデーション
    if (!name.trim()) {
      alert('DB名を入力してください');
      return;
    }

    const emptyFields = fields.filter((f) => !f.name.trim());
    if (emptyFields.length > 0) {
      alert('すべてのフィールドに名前を入力してください');
      return;
    }

    // 重複チェック
    const fieldNames = fields.map((f) => f.name.trim());
    const duplicates = fieldNames.filter(
      (name, index) => fieldNames.indexOf(name) !== index
    );
    if (duplicates.length > 0) {
      alert(`フィールド名が重複しています: ${duplicates[0]}`);
      return;
    }

    setIsSaving(true);

    try {
      await updateDoc(doc(db, 'customDatabases', databaseId), {
        name: name.trim(),
        description: description.trim() || null,
        fields: fields.map((f, i) => ({
          ...f,
          name: f.name.trim(),
          order: i,
        })),
        updatedAt: serverTimestamp(),
      });

      router.push(`/dashboard/organizations/${orgId}/databases/${databaseId}`);
    } catch (err) {
      console.error('保存エラー:', err);
      alert('保存に失敗しました');
    } finally {
      setIsSaving(false);
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

  return (
    <div>
      {/* パンくずリスト */}
      <div className="mb-4">
        <Link
          href={`/dashboard/organizations/${orgId}/databases/${databaseId}`}
          className="inline-flex items-center text-sm text-gray-500 hover:text-green-600"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          {database.name} に戻る
        </Link>
      </div>

      {/* ヘッダー */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Database className="h-6 w-6 text-green-600" />
          項目定義を編集
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          カスタムDBの名前と項目定義を編集できます
        </p>
      </div>

      {/* 注意事項 */}
      <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-yellow-800">
          <p className="font-medium">項目定義の変更について</p>
          <p className="mt-1">
            項目を削除すると、既存レコードの該当データも参照できなくなります。
            データ型の変更は既存データに影響する可能性があります。
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 基本情報 */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">基本情報</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                DB名 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="例: 注文管理、在庫リスト"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                説明（オプション）
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="例: 日次の注文データを管理するためのDB"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
        </div>

        {/* フィールド定義 */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">項目定義</h2>
              <p className="text-sm text-gray-500 mt-1">
                単一項目：請求書番号など1つの値 / 明細項目：商品リストなど複数行
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleAddField('single')}
                className="flex items-center gap-1 text-sm text-green-600 hover:text-green-800 px-2 py-1 border border-green-600 rounded"
              >
                <Plus className="h-4 w-4" />
                単一項目
              </button>
              <button
                type="button"
                onClick={() => handleAddField('detail')}
                className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 px-2 py-1 border border-blue-600 rounded"
              >
                <Plus className="h-4 w-4" />
                明細項目
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {/* ヘッダー */}
            <div className="hidden md:grid md:grid-cols-12 gap-3 text-xs font-medium text-gray-500 uppercase tracking-wider px-2">
              <div className="col-span-1"></div>
              <div className="col-span-2">種別</div>
              <div className="col-span-3">項目名</div>
              <div className="col-span-2">データ型</div>
              <div className="col-span-2">必須</div>
              <div className="col-span-2"></div>
            </div>

            {/* フィールド一覧 */}
            {fields.map((field, index) => (
              <div
                key={field.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                className={`grid grid-cols-1 md:grid-cols-12 gap-3 items-center p-3 rounded-lg border ${
                  dragIndex === index
                    ? 'border-green-500 bg-green-50'
                    : field.category === 'detail'
                    ? 'border-blue-200 bg-blue-50'
                    : 'border-gray-200 bg-gray-50'
                }`}
              >
                {/* ドラッグハンドル */}
                <div className="col-span-1 flex items-center justify-center cursor-move">
                  <GripVertical className="h-5 w-5 text-gray-400" />
                </div>

                {/* 種別 */}
                <div className="col-span-1 md:col-span-2">
                  <select
                    value={field.category || 'single'}
                    onChange={(e) =>
                      handleUpdateField(index, 'category', e.target.value as CustomFieldCategory)
                    }
                    className={`w-full rounded-md border px-2 py-2 text-sm focus:ring-1 ${
                      field.category === 'detail'
                        ? 'border-blue-300 bg-blue-100 text-blue-800 focus:border-blue-500 focus:ring-blue-500'
                        : 'border-gray-300 focus:border-green-500 focus:ring-green-500'
                    }`}
                  >
                    {FIELD_CATEGORIES.map((cat) => (
                      <option key={cat.value} value={cat.value}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 項目名 */}
                <div className="col-span-1 md:col-span-3">
                  <input
                    type="text"
                    value={field.name}
                    onChange={(e) => handleUpdateField(index, 'name', e.target.value)}
                    placeholder="項目名"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500"
                  />
                </div>

                {/* データ型 */}
                <div className="col-span-1 md:col-span-2">
                  <select
                    value={field.type}
                    onChange={(e) =>
                      handleUpdateField(index, 'type', e.target.value as CustomFieldType)
                    }
                    className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500"
                  >
                    {FIELD_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 必須 */}
                <div className="col-span-1 md:col-span-2 flex items-center">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => handleUpdateField(index, 'required', e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <span className="text-sm text-gray-700 md:hidden">必須</span>
                  </label>
                </div>

                {/* 削除ボタン */}
                <div className="col-span-1 md:col-span-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleRemoveField(index)}
                    className="p-2 text-gray-400 hover:text-red-600"
                    title="削除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* フィールド追加ボタン（下部） */}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => handleAddField('single')}
              className="flex-1 flex items-center justify-center gap-2 p-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-green-500 hover:text-green-600 transition-colors"
            >
              <Plus className="h-5 w-5" />
              単一項目を追加
            </button>
            <button
              type="button"
              onClick={() => handleAddField('detail')}
              className="flex-1 flex items-center justify-center gap-2 p-3 border-2 border-dashed border-blue-300 rounded-lg text-blue-500 hover:border-blue-500 hover:text-blue-600 transition-colors"
            >
              <Plus className="h-5 w-5" />
              明細項目を追加
            </button>
          </div>
        </div>

        {/* 送信ボタン */}
        <div className="flex justify-end gap-3">
          <Link
            href={`/dashboard/organizations/${orgId}/databases/${databaseId}`}
            className="rounded-lg bg-gray-200 py-2 px-4 font-semibold text-gray-700 hover:bg-gray-300"
          >
            キャンセル
          </Link>
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
  );
}

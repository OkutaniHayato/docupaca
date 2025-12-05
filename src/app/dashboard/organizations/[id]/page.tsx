"use client";

import React, { useState, useEffect, use } from 'react';
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
  deleteDoc,
} from 'firebase/firestore';
import { Organization, CustomDatabase } from '@/types/ocr';
import {
  Building2,
  Plus,
  ArrowLeft,
  Database,
  Loader2,
  Trash2,
  Pencil,
  Table,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';

interface OrganizationWithId extends Organization {
  id: string;
}

interface CustomDatabaseWithId extends CustomDatabase {
  id: string;
}

export default function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: orgId } = use(params);
  const { currentUser } = useAuth();
  const [organization, setOrganization] = useState<OrganizationWithId | null>(null);
  const [databases, setDatabases] = useState<CustomDatabaseWithId[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 組織情報を取得
  useEffect(() => {
    if (!currentUser || !orgId) return;

    const fetchOrganization = async () => {
      try {
        const orgDoc = await getDoc(doc(db, 'organizations', orgId));
        if (orgDoc.exists()) {
          const orgData = orgDoc.data() as Organization;
          if (orgData.owner_id !== currentUser.uid) {
            setError('この組織へのアクセス権限がありません');
            setIsLoading(false);
            return;
          }
          setOrganization({ id: orgDoc.id, ...orgData });
        } else {
          setError('組織が見つかりません');
        }
      } catch (err) {
        console.error('組織の取得エラー:', err);
        setError('組織の取得に失敗しました');
      }
    };

    fetchOrganization();
  }, [currentUser, orgId]);

  // カスタムDB一覧を取得
  useEffect(() => {
    if (!currentUser || !orgId) return;

    const q = query(
      collection(db, 'customDatabases'),
      where('organizationId', '==', orgId),
      where('ownerId', '==', currentUser.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const dbs: CustomDatabaseWithId[] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      } as CustomDatabaseWithId));
      setDatabases(dbs);
      setIsLoading(false);
    }, (err) => {
      console.error('カスタムDB一覧の取得エラー:', err);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, orgId]);

  // カスタムDBを削除
  const handleDeleteDatabase = async (database: CustomDatabaseWithId) => {
    if (!confirm(`「${database.name}」を削除しますか？\n\n※このDBに登録されているレコードも削除されます。`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'customDatabases', database.id));
    } catch (err) {
      console.error('削除エラー:', err);
      alert('削除に失敗しました');
    }
  };

  // データ型のラベル
  const getFieldTypeLabel = (type: string) => {
    switch (type) {
      case 'text': return 'テキスト';
      case 'number': return '数値';
      case 'date': return '日付';
      case 'currency': return '金額';
      default: return type;
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

  if (!organization) {
    return null;
  }

  return (
    <div>
      {/* パンくずリスト */}
      <div className="mb-4">
        <Link
          href="/dashboard/organizations"
          className="inline-flex items-center text-sm text-gray-500 hover:text-green-600"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          組織一覧に戻る
        </Link>
      </div>

      {/* 組織情報ヘッダー */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-green-100 rounded-lg">
              <Building2 className="h-8 w-8 text-green-700" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{organization.name}</h1>
              {organization.description && (
                <p className="mt-1 text-gray-600">{organization.description}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* カスタムDB セクション */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Database className="h-5 w-5 text-green-600" />
              カスタムDB
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              この組織に紐づくカスタムデータベースを管理します
            </p>
          </div>
          <Link
            href={`/dashboard/organizations/${orgId}/databases/new`}
            className="flex items-center gap-2 rounded-lg bg-green-700 py-2 px-4 font-semibold text-white hover:bg-green-600 transition-colors"
          >
            <Plus className="h-5 w-5" />
            新規DB作成
          </Link>
        </div>

        {/* カスタムDB一覧 */}
        {databases.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <Table className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-4 text-lg font-medium text-gray-900">
              カスタムDBがありません
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              「新規DB作成」ボタンからカスタムデータベースを作成してください
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {databases.map((database) => (
              <div
                key={database.id}
                className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Database className="h-5 w-5 text-green-600" />
                    <h3 className="font-semibold text-gray-900">{database.name}</h3>
                  </div>
                  <div className="flex items-center gap-1">
                    <Link
                      href={`/dashboard/organizations/${orgId}/databases/${database.id}/edit`}
                      className="p-1 text-gray-400 hover:text-green-600"
                      title="項目定義を編集"
                    >
                      <Pencil className="h-4 w-4" />
                    </Link>
                    <button
                      onClick={() => handleDeleteDatabase(database)}
                      className="p-1 text-gray-400 hover:text-red-600"
                      title="削除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {database.description && (
                  <p className="text-sm text-gray-600 mb-3">{database.description}</p>
                )}

                {/* フィールド一覧（簡易表示） */}
                <div className="mb-3">
                  <p className="text-xs text-gray-500 mb-1">項目定義（{database.fields.length}件）</p>
                  <div className="flex flex-wrap gap-1">
                    {database.fields.slice(0, 5).map((field) => (
                      <span
                        key={field.id}
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700"
                      >
                        {field.name}
                        <span className="ml-1 text-gray-400">({getFieldTypeLabel(field.type)})</span>
                      </span>
                    ))}
                    {database.fields.length > 5 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-500">
                        +{database.fields.length - 5}件
                      </span>
                    )}
                  </div>
                </div>

                {/* レコード管理リンク */}
                <Link
                  href={`/dashboard/organizations/${orgId}/databases/${database.id}`}
                  className="flex items-center justify-between w-full p-2 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
                >
                  <span className="text-sm font-medium">レコードを管理</span>
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

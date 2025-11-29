"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db, storage } from '@/config/firebase';
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
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
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
  Upload,
  File,
  FileSpreadsheet,
  Image,
} from 'lucide-react';

interface OrgLearningDocWithId extends OrgLearningDoc {
  id: string;
}

interface OrganizationWithId extends Organization {
  id: string;
}

// ドキュメントタイプの定義
const DOC_TYPES: { value: OrgLearningDocType; label: string }[] = [
  { value: 'rule', label: '業務ルール' },
  { value: 'customer_master', label: '顧客マスタ' },
  { value: 'item_master', label: '品目マスタ' },
  { value: 'account_master', label: '勘定科目マスタ' },
  { value: 'tax_master', label: '税区分マスタ' },
  { value: 'department_master', label: '部門マスタ' },
  { value: 'exception', label: '例外ルール' },
  { value: 'other', label: 'その他' },
];

// サポートするファイルタイプ
const SUPPORTED_FILE_TYPES = {
  'application/pdf': { label: 'PDF', icon: FileText },
  'text/csv': { label: 'CSV', icon: FileSpreadsheet },
  'application/vnd.ms-excel': { label: 'Excel', icon: FileSpreadsheet },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { label: 'Excel', icon: FileSpreadsheet },
  'image/png': { label: '画像', icon: Image },
  'image/jpeg': { label: '画像', icon: Image },
  'image/webp': { label: '画像', icon: Image },
};

const ACCEPTED_FILE_TYPES = Object.keys(SUPPORTED_FILE_TYPES).join(',');

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
  const [inputMode, setInputMode] = useState<'text' | 'file'>('text');
  const [formData, setFormData] = useState<{
    type: OrgLearningDocType;
    title: string;
    content: string;
  }>({
    type: 'rule',
    title: '',
    content: '',
  });

  // ファイルアップロード状態
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setInputMode('text');
    setFormData({
      type: 'rule',
      title: '',
      content: '',
    });
    setSelectedFile(null);
    setUploadError(null);
    setIsModalOpen(true);
  };

  // モーダルを開く（編集）
  const handleOpenEdit = (docItem: OrgLearningDocWithId) => {
    setEditingDoc(docItem);
    setInputMode(docItem.sourceType === 'file' ? 'file' : 'text');
    setFormData({
      type: docItem.type,
      title: docItem.title,
      content: docItem.content,
    });
    setSelectedFile(null);
    setUploadError(null);
    setIsModalOpen(true);
  };

  // モーダルを閉じる
  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingDoc(null);
    setInputMode('text');
    setFormData({
      type: 'rule',
      title: '',
      content: '',
    });
    setSelectedFile(null);
    setUploadError(null);
  }, []);

  // ファイル選択ハンドラ
  const handleFileSelect = (file: File) => {
    // ファイルタイプチェック
    if (!Object.keys(SUPPORTED_FILE_TYPES).includes(file.type)) {
      setUploadError('サポートされていないファイル形式です。PDF、CSV、Excel、画像ファイルをアップロードしてください。');
      return;
    }

    // ファイルサイズチェック（10MB制限）
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('ファイルサイズは10MB以下にしてください。');
      return;
    }

    setSelectedFile(file);
    setUploadError(null);

    // タイトルが空の場合、ファイル名をセット
    if (!formData.title) {
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
      setFormData(prev => ({ ...prev, title: nameWithoutExt }));
    }
  };

  // ドラッグ＆ドロップハンドラ
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  // ファイル入力変更ハンドラ
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  // ファイルをアップロードしてテキスト抽出
  const uploadAndParseFile = async (): Promise<{ url: string; content: string }> => {
    if (!selectedFile || !currentUser || !selectedOrgId) {
      throw new Error('ファイルまたはユーザー情報が不足しています');
    }

    setIsUploading(true);

    try {
      // Firebase Storageにアップロード
      const timestamp = Date.now();
      const storagePath = `knowledge/${selectedOrgId}/${timestamp}_${selectedFile.name}`;
      const storageRef = ref(storage, storagePath);

      await uploadBytes(storageRef, selectedFile);
      const downloadUrl = await getDownloadURL(storageRef);

      setIsUploading(false);
      setIsParsing(true);

      // Cloud Functionでテキスト抽出
      const token = await currentUser.getIdToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_FUNCTIONS_URL || ''}/parseKnowledgeFileHttp`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            fileUrl: downloadUrl,
            fileName: selectedFile.name,
            mimeType: selectedFile.type,
            orgId: selectedOrgId,
          }),
        }
      );

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'ファイルの解析に失敗しました');
      }

      return {
        url: downloadUrl,
        content: data.content,
      };
    } finally {
      setIsUploading(false);
      setIsParsing(false);
    }
  };

  // 保存
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !selectedOrgId || !formData.title.trim()) return;

    // テキストモードの場合はコンテンツ必須
    if (inputMode === 'text' && !formData.content.trim()) return;
    // ファイルモードの場合はファイル選択必須（編集時は除く）
    if (inputMode === 'file' && !selectedFile && !editingDoc) return;

    setIsSaving(true);

    try {
      let content = formData.content;
      let sourceFileUrl: string | undefined;
      let sourceFileName: string | undefined;
      let sourceFileMimeType: string | undefined;
      let sourceFileSize: number | undefined;

      // ファイルモードでファイルが選択されている場合
      if (inputMode === 'file' && selectedFile) {
        const result = await uploadAndParseFile();
        content = result.content;
        sourceFileUrl = result.url;
        sourceFileName = selectedFile.name;
        sourceFileMimeType = selectedFile.type;
        sourceFileSize = selectedFile.size;
      }

      if (editingDoc) {
        // 更新
        const updateData: Record<string, unknown> = {
          type: formData.type,
          title: formData.title.trim(),
          content: content.trim(),
          updatedAt: serverTimestamp(),
          updatedBy: currentUser.uid,
          syncStatus: 'pending',
          sourceType: inputMode,
        };

        // ファイル情報がある場合は追加
        if (sourceFileUrl) {
          updateData.sourceFileUrl = sourceFileUrl;
          updateData.sourceFileName = sourceFileName;
          updateData.sourceFileMimeType = sourceFileMimeType;
          updateData.sourceFileSize = sourceFileSize;
        }

        await updateDoc(doc(db, 'orgLearningDocs', editingDoc.id), updateData);
      } else {
        // 新規作成
        const newDoc: Record<string, unknown> = {
          orgId: selectedOrgId,
          type: formData.type,
          title: formData.title.trim(),
          content: content.trim(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: currentUser.uid,
          syncStatus: 'pending',
          sourceType: inputMode,
        };

        // ファイル情報がある場合は追加
        if (sourceFileUrl) {
          newDoc.sourceFileUrl = sourceFileUrl;
          newDoc.sourceFileName = sourceFileName;
          newDoc.sourceFileMimeType = sourceFileMimeType;
          newDoc.sourceFileSize = sourceFileSize;
        }

        await addDoc(collection(db, 'orgLearningDocs'), newDoc);
      }
      handleCloseModal();
    } catch (error) {
      console.error('保存エラー:', error);
      if (error instanceof Error) {
        setUploadError(error.message);
      } else {
        alert('保存に失敗しました');
      }
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

  // ソースタイプのアイコンを取得
  const getSourceTypeIcon = (docItem: OrgLearningDocWithId) => {
    if (docItem.sourceType === 'file' && docItem.sourceFileMimeType) {
      const fileType = SUPPORTED_FILE_TYPES[docItem.sourceFileMimeType as keyof typeof SUPPORTED_FILE_TYPES];
      if (fileType) {
        const IconComponent = fileType.icon;
        return <IconComponent className="h-5 w-5 text-gray-400 mr-3" />;
      }
    }
    return <FileText className="h-5 w-5 text-gray-400 mr-3" />;
  };

  // 日時フォーマット
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formatDate = (date: any) => {
    if (!date) return '-';
    const d = date.toDate ? date.toDate() : (date instanceof Date ? date : new Date(date));
    return d.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // ファイルサイズフォーマット
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
                      {getSourceTypeIcon(docItem)}
                      <div>
                        <span className="text-sm font-medium text-gray-900">
                          {docItem.title}
                        </span>
                        {docItem.sourceType === 'file' && docItem.sourceFileName && (
                          <p className="text-xs text-blue-600">
                            📎 {docItem.sourceFileName}
                            {docItem.sourceFileSize && ` (${formatFileSize(docItem.sourceFileSize)})`}
                          </p>
                        )}
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
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
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
              {/* 入力モード切替タブ */}
              <div className="flex border-b border-gray-200">
                <button
                  type="button"
                  onClick={() => setInputMode('text')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    inputMode === 'text'
                      ? 'border-green-600 text-green-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <FileText className="h-4 w-4 inline mr-2" />
                  テキスト入力
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('file')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    inputMode === 'file'
                      ? 'border-green-600 text-green-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Upload className="h-4 w-4 inline mr-2" />
                  ファイルアップロード
                </button>
              </div>

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
                  {DOC_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
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

              {inputMode === 'text' ? (
                // テキスト入力モード
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
              ) : (
                // ファイルアップロードモード
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    ファイル <span className="text-red-500">*</span>
                    <span className="text-xs text-gray-500 ml-2">(PDF, CSV, Excel, 画像)</span>
                  </label>

                  {/* ドロップゾーン */}
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                      isDragOver
                        ? 'border-green-500 bg-green-50'
                        : selectedFile
                        ? 'border-green-300 bg-green-50'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ACCEPTED_FILE_TYPES}
                      onChange={handleFileInputChange}
                      className="hidden"
                    />

                    {selectedFile ? (
                      <div className="flex items-center justify-center gap-3">
                        <File className="h-8 w-8 text-green-600" />
                        <div className="text-left">
                          <p className="text-sm font-medium text-gray-900">{selectedFile.name}</p>
                          <p className="text-xs text-gray-500">{formatFileSize(selectedFile.size)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedFile(null);
                          }}
                          className="ml-2 text-gray-400 hover:text-gray-600"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <Upload className="mx-auto h-12 w-12 text-gray-400" />
                        <p className="mt-2 text-sm text-gray-600">
                          ドラッグ＆ドロップ または クリックしてファイルを選択
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          PDF, CSV, Excel (.xlsx), 画像 (PNG, JPEG) - 最大10MB
                        </p>
                      </>
                    )}
                  </div>

                  {/* エラーメッセージ */}
                  {uploadError && (
                    <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
                      <p className="text-sm text-red-600">{uploadError}</p>
                    </div>
                  )}

                  {/* 編集時の既存ファイル情報 */}
                  {editingDoc?.sourceType === 'file' && editingDoc.sourceFileName && !selectedFile && (
                    <div className="mt-3 p-3 bg-gray-50 rounded-md">
                      <p className="text-sm text-gray-600">
                        現在のファイル: <span className="font-medium">{editingDoc.sourceFileName}</span>
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        新しいファイルを選択すると置き換えられます
                      </p>
                    </div>
                  )}

                  {/* 抽出されたコンテンツのプレビュー（編集モードでファイルアップロード済みの場合） */}
                  {editingDoc?.sourceType === 'file' && formData.content && (
                    <div className="mt-3">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        抽出されたテキスト（編集可能）
                      </label>
                      <textarea
                        value={formData.content}
                        onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                        rows={8}
                        className="block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 font-mono text-sm"
                      />
                    </div>
                  )}
                </div>
              )}

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
                  disabled={
                    isSaving ||
                    isUploading ||
                    isParsing ||
                    !formData.title.trim() ||
                    (inputMode === 'text' && !formData.content.trim()) ||
                    (inputMode === 'file' && !selectedFile && !editingDoc)
                  }
                  className="flex items-center gap-2 rounded-lg bg-green-700 py-2 px-4 font-semibold text-white hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      アップロード中...
                    </>
                  ) : isParsing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      解析中...
                    </>
                  ) : isSaving ? (
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

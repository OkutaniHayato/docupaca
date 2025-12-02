"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import {
  Sparkles,
  ArrowLeftRight,
  Image as ImageIcon,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  BookOpen,
  Check
} from 'lucide-react';
import { ExtractionField, Organization, OrgLearningDoc } from '@/types/ocr';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/config/firebase';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';

// 組織の型（IDを含む）
interface OrganizationWithId extends Organization {
  id: string;
}

// ナレッジドキュメントの型（IDを含む）
interface OrgLearningDocWithId extends OrgLearningDoc {
  id: string;
}

// PDFプレビューコンポーネントを動的インポート（SSR無効化）
const PdfPreview = dynamic(
  () => import('@/components/PdfPreview'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-8">
        <p className="text-gray-500">PDFを読み込んでいます...</p>
      </div>
    )
  }
);

// OCR設定フォームのデータ型
export interface OcrSettingFormData {
  name: string;
  model_name: string;
  prompt_text: string;
  extraction_fields: ExtractionField[];
  sample_file_path?: string; // Firebase Storageのファイルパス
  // 組織（取引先）紐付け
  organization_id?: string;
  // AI自動判定用メタ情報（オプショナル）
  displayName?: string;
  templateType?: string;
  exampleKeywords?: string[];
  // RAGコード提案（機能④）
  enableRagCodeSuggestion?: boolean;
  // 紐付けるナレッジドキュメントID（RAG用）
  linkedKnowledgeIds?: string[];
}

// 後方互換性のため、ExtractionFieldを再エクスポート
export type { ExtractionField };

interface OcrSettingFormProps {
  initialData?: OcrSettingFormData;
  onSave: (data: OcrSettingFormData, file: File | null) => Promise<void>;
  isLoading: boolean;
  saveButtonText?: string;
  isTemplateMode?: boolean; // テンプレートからコピーモード
  settingId?: string; // 編集モード時のOCR設定ID（ナレッジ紐付けに使用）
}

interface PreviewContentProps {
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  imagePreviewUrl: string | null;
  uploadedFile: File | null;
  sampleFilePath: string | undefined;
  onPdfLoadSuccess: ({ numPages }: { numPages: number }) => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
}

// --- プレビューエリア（UI） ---
const PreviewContent = ({
  handleFileChange,
  imagePreviewUrl,
  uploadedFile,
  sampleFilePath,
  onPdfLoadSuccess,
  onAnalyze,
  isAnalyzing,
}: PreviewContentProps) => {
  // ファイルタイプを判定（新規アップロードまたは既存ファイル）
  const isPdf = uploadedFile?.type === "application/pdf" ||
                (sampleFilePath && sampleFilePath.toLowerCase().endsWith('.pdf'));

  return (
    <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm h-full">
      {/* ヘッダー：タイトルとAIボタン */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900">帳票プレビュー</h3>
        {uploadedFile && (
          <button
            type="button"
            onClick={onAnalyze}
            disabled={isAnalyzing}
            className="flex items-center gap-2 rounded-lg bg-green-700 py-2 px-4 font-semibold text-white hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Sparkles className={`h-4 w-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
            {isAnalyzing ? 'AI解析中...' : 'AIで自動生成'}
          </button>
        )}
      </div>

      {/* ファイルアップロード */}
      <div className="mb-4">
        <label htmlFor="file-upload" className="block text-sm font-medium text-gray-700">
          帳票ファイル (画像 / PDF)
        </label>
        <input
          id="file-upload"
          type="file"
          accept="image/*,application/pdf"
          onChange={handleFileChange}
          disabled={isAnalyzing}
          className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-green-100 file:text-green-800 hover:file:bg-green-200 disabled:opacity-50"
        />
      </div>

      {/* プレビューエリア（A4サイズに対応） */}
      <div className="relative border border-gray-300 rounded-md bg-gray-50 min-h-[842px] max-h-[1000px] flex items-center justify-center overflow-hidden">
        {!imagePreviewUrl ? (
          <div className="text-center text-gray-500">
            <ImageIcon className="mx-auto h-12 w-12 text-gray-400" />
            <p>プレビューする画像またはPDFをアップロードしてください。</p>
          </div>
        ) : isPdf ? (
          <PdfPreview
            fileUrl={imagePreviewUrl}
            onLoadSuccess={onPdfLoadSuccess}
          />
        ) : (
          <div className="relative w-full h-full min-h-[800px]">
            <Image
              src={imagePreviewUrl}
              alt="帳票プレビュー"
              fill
              style={{ objectFit: "contain" }}
            />
          </div>
        )}
      </div>

      {/* 説明テキスト */}
      {uploadedFile && (
        <p className="mt-3 text-xs text-gray-500 text-center">
          アップロードした帳票をAIが解析し、OCR設定を自動生成します
        </p>
      )}
    </div>
  );
};

/**
 * OCR設定の「新規作成」と「編集」で共通のフォームコンポーネント
 */
export default function OcrSettingForm({
  initialData,
  onSave,
  isLoading,
  saveButtonText = "保存する",
  isTemplateMode = false,
  settingId
}: OcrSettingFormProps) {
  const { currentUser } = useAuth();

  const [formData, setFormData] = useState<OcrSettingFormData>(
    initialData || {
      name: '',
      model_name: 'gemini-2.5-flash-lite',
      prompt_text: '',
      extraction_fields: [],
      organization_id: '',
      enableRagCodeSuggestion: false,
      linkedKnowledgeIds: [],
    }
  );

  // 組織一覧
  const [organizations, setOrganizations] = useState<OrganizationWithId[]>([]);

  // 選択された組織のナレッジドキュメント一覧
  const [knowledgeDocs, setKnowledgeDocs] = useState<OrgLearningDocWithId[]>([]);

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

  // 選択された組織のナレッジドキュメントを取得
  useEffect(() => {
    if (!formData.organization_id) {
      setKnowledgeDocs([]);
      return;
    }

    const q = query(
      collection(db, 'orgLearningDocs'),
      where('orgId', '==', formData.organization_id),
      orderBy('title', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs: OrgLearningDocWithId[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      } as OrgLearningDocWithId));
      setKnowledgeDocs(docs);

      // settingIdがある場合、現在リンクされているナレッジを初期選択
      if (settingId && !formData.linkedKnowledgeIds?.length) {
        const linkedIds = docs
          .filter(doc => !doc.settingIds || doc.settingIds.length === 0 || doc.settingIds.includes(settingId))
          .map(doc => doc.id);
        setFormData(prev => ({
          ...prev,
          linkedKnowledgeIds: linkedIds,
        }));
      }
    });

    return () => unsubscribe();
  }, [formData.organization_id, settingId]);

  // initialDataが変更されたときにformDataを更新
  useEffect(() => {
    if (initialData) {
      // 後方互換性: type プロパティがない場合は 'single' をデフォルトとする
      const normalizedData = {
        ...initialData,
        extraction_fields: initialData.extraction_fields.map(field => ({
          ...field,
          type: field.type || 'single',
        }))
      };
      setFormData(normalizedData);

      // サンプルファイルがある場合はStorageから読み込んでプレビュー表示
      if (initialData.sample_file_path) {
        const loadSampleFile = async () => {
          try {
            const { storage } = await import('@/config/firebase');
            const { ref, getDownloadURL } = await import('firebase/storage');

            const fileRef = ref(storage, initialData.sample_file_path);
            const downloadUrl = await getDownloadURL(fileRef);
            setImagePreviewUrl(downloadUrl);
            console.log('既存のサンプルファイルを読み込みました:', downloadUrl);
          } catch (error) {
            console.error('サンプルファイルの読み込みに失敗しました:', error);
          }
        };

        loadSampleFile();
      }
    }
  }, [initialData]);

  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldInstruction, setNewFieldInstruction] = useState('');
  const [newFieldType, setNewFieldType] = useState<'single' | 'array'>('single');
  const [newChildFields, setNewChildFields] = useState<Array<{name: string, instruction: string}>>([]);
  const [tempChildName, setTempChildName] = useState('');
  const [tempChildInstruction, setTempChildInstruction] = useState('');

  const [layout, setLayout] = useState<'form-left' | 'form-right'>('form-left');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);

  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());

  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    console.log('ファイルが選択されました:', file);
    if (file) {
      setUploadedFile(file);

      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }

      const newPreviewUrl = URL.createObjectURL(file);
      setImagePreviewUrl(newPreviewUrl);
      console.log('プレビューURLを設定しました:', newPreviewUrl);

    } else {
      setUploadedFile(null);
      setImagePreviewUrl(null);
      console.log('ファイルがクリアされました');
    }
  };

  const onPdfLoadSuccess = ({ numPages }: { numPages: number }) => {
    // PDF読み込み成功時のコールバック（現在は特に処理なし）
    console.log(`PDF loaded: ${numPages} pages`);
  };

  const handleAddField = () => {
    if (!newFieldName || !newFieldInstruction) {
      alert("項目名と抽出指示を入力してください。");
      return;
    }

    if (formData.extraction_fields.some(field => field.name === newFieldName)) {
      alert("エラー: 項目名 (name) が重複しています。");
      return;
    }

    if (newFieldType === 'array' && newChildFields.length === 0) {
      alert("配列フィールドには少なくとも1つの子フィールドが必要です。");
      return;
    }

    const newField: ExtractionField = {
      name: newFieldName,
      instruction: newFieldInstruction,
      type: newFieldType,
      ...(newFieldType === 'array' && {
        children: newChildFields.map(child => ({
          name: child.name,
          instruction: child.instruction,
          type: 'single' as const,
        }))
      })
    };

    setFormData(prev => ({
      ...prev,
      extraction_fields: [...prev.extraction_fields, newField]
    }));

    // リセット
    setNewFieldName('');
    setNewFieldInstruction('');
    setNewFieldType('single');
    setNewChildFields([]);
  };

  const handleAddChildField = () => {
    if (!tempChildName || !tempChildInstruction) {
      alert("子フィールド名と抽出指示を入力してください。");
      return;
    }

    if (newChildFields.some(child => child.name === tempChildName)) {
      alert("エラー: 子フィールド名が重複しています。");
      return;
    }

    setNewChildFields(prev => [
      ...prev,
      { name: tempChildName, instruction: tempChildInstruction }
    ]);

    setTempChildName('');
    setTempChildInstruction('');
  };

  const handleDeleteChildField = (childName: string) => {
    setNewChildFields(prev => prev.filter(child => child.name !== childName));
  };

  const toggleFieldExpansion = (fieldName: string) => {
    setExpandedFields(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fieldName)) {
        newSet.delete(fieldName);
      } else {
        newSet.add(fieldName);
      }
      return newSet;
    });
  };

  const handleDeleteField = (fieldName: string) => {
    if (window.confirm(`項目「${fieldName}」を削除しますか？`)) {
      setFormData(prev => ({
        ...prev,
        extraction_fields: prev.extraction_fields.filter(field => field.name !== fieldName)
      }));
    }
  };
  
  const handleAiGenerate = async () => {
    if (!uploadedFile) {
      alert("先に帳票ファイル（画像またはPDF）をアップロードしてください。");
      return;
    }

    setIsAnalyzing(true);

    try {
      // FormDataを作成してファイルを送信
      const apiFormData = new FormData();
      apiFormData.append('file', uploadedFile);

      // テンプレートモードの場合、既存のフィールド構造を送信
      if (isTemplateMode && formData.extraction_fields.length > 0) {
        apiFormData.append('existing_fields', JSON.stringify(formData.extraction_fields));
      }

      const response = await fetch('/api/analyze-document', {
        method: 'POST',
        body: apiFormData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '解析に失敗しました');
      }

      const result = await response.json();

      if (result.success && result.data) {
        // 再帰的に type と children を正規化する関数
        const normalizeField = (field: Partial<ExtractionField>): ExtractionField => {
          const normalizedField: ExtractionField = {
            name: field.name || '',
            instruction: field.instruction || '',
            type: (field.type || 'single') as 'single' | 'array',
          };

          // 配列フィールドの場合、子フィールドも再帰的に正規化
          if (normalizedField.type === 'array' && field.children && Array.isArray(field.children)) {
            normalizedField.children = field.children.map(normalizeField);
          }

          return normalizedField;
        };

        if (isTemplateMode && formData.extraction_fields.length > 0) {
          // テンプレートモード：既存フィールド構造を維持しながらinstructionを更新
          const updatedFields = formData.extraction_fields.map((existingField) => {
            // AIレスポンスから同じ名前のフィールドを探す
            const aiField = result.data.extractionFields.find(
              (f: ExtractionField) => f.name === existingField.name
            );

            if (aiField) {
              // instructionを更新、構造は既存のものを維持
              const updatedField: ExtractionField = {
                ...existingField,
                instruction: aiField.instruction || existingField.instruction,
              };

              // 配列フィールドの場合、子フィールドのinstructionも更新
              if (existingField.type === 'array' && existingField.children) {
                updatedField.children = existingField.children.map((existingChild) => {
                  const aiChild = aiField.children?.find(
                    (c: ExtractionField) => c.name === existingChild.name
                  );
                  return {
                    ...existingChild,
                    instruction: aiChild?.instruction || existingChild.instruction,
                  };
                });
              }

              return updatedField;
            }

            // 対応するフィールドが見つからない場合は既存のフィールドをそのまま使用
            return existingField;
          });

          setFormData(prev => ({
            ...prev,
            prompt_text: result.data.extractionInstruction,
            extraction_fields: updatedFields,
          }));

          alert('AI解析が完了しました！既存のフィールド構造を維持したまま、抽出指示が更新されました。');
        } else {
          // 通常モード：新規フィールド生成
          const normalizedFields = result.data.extractionFields.map(normalizeField);

          setFormData(prev => ({
            ...prev,
            name: `${result.data.documentName}の設定`,
            prompt_text: result.data.extractionInstruction,
            extraction_fields: normalizedFields,
          }));

          alert('AI解析が完了しました！設定が自動入力されました。');
        }
      } else {
        throw new Error('解析結果が不正です');
      }
    } catch (error) {
      console.error('AI解析エラー:', error);
      alert(
        `AI解析中にエラーが発生しました: ${
          error instanceof Error ? error.message : '不明なエラー'
        }`
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSave(formData, uploadedFile);
  };

  // --- メインフォーム（UI） ---
  const FormContent = (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* (フォームの中身は変更なし) */}
      {/* ... */}
            {/* --- 1. 基本設定エリア --- */}
      <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
         <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">
            設定名 (例：「請求書Aパターン」)
          </label>
          <input
            type="text"
            id="name"
            value={formData.name}
            onChange={handleChange}
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
            placeholder="請求書Aパターン"
            disabled={isLoading}
          />
        </div>

        {/* 組織（取引先）選択 */}
        <div className="mt-4">
          <label htmlFor="organization_id" className="block text-sm font-medium text-gray-700">
            組織（取引先）
          </label>
          <select
            id="organization_id"
            value={formData.organization_id || ''}
            onChange={handleChange}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
            disabled={isLoading}
          >
            <option value="">-- 組織を選択 --</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
          {organizations.length === 0 && (
            <p className="mt-1 text-xs text-gray-500">
              組織が登録されていません。<a href="/dashboard/organizations" className="text-green-600 hover:underline">組織マスタ</a>から登録してください。
            </p>
          )}
        </div>

        <div className="mt-4">
          <label htmlFor="model_name" className="block text-sm font-medium text-gray-700">
            使用するAIモデル
          </label>
          <select
            id="model_name"
            value={formData.model_name}
            onChange={handleChange}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
            disabled={isLoading}
          >
            <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite (推奨)</option>
            <option value="gemini-2.5-flash">Gemini 2.5 Flash (高性能)</option>
            <option value="gemini-2.5-pro">Gemini 2.5 Pro (最高性能)</option>
          </select>
        </div>

        {/* RAGコード提案機能トグル（組織が選択されている場合のみ表示） */}
        {formData.organization_id && (
          <div className="mt-4">
            <div className="flex items-center justify-between p-4 bg-purple-50 rounded-lg border border-purple-200">
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-purple-600" />
                <div>
                  <span className="block text-sm font-medium text-gray-900">
                    RAGによるコード提案
                  </span>
                  <span className="text-xs text-gray-500">
                    OCR実行時に顧客コード・品目コード・勘定科目などを自動提案
                  </span>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.enableRagCodeSuggestion || false}
                  onChange={(e) => setFormData(prev => ({ ...prev, enableRagCodeSuggestion: e.target.checked }))}
                  className="sr-only peer"
                  disabled={isLoading}
                />
                <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-purple-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
              </label>
            </div>

            {/* ナレッジドキュメント選択（RAG有効時のみ表示） */}
            {formData.enableRagCodeSuggestion && (
              <div className="mt-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-5 w-5 text-blue-600" />
                    <span className="text-sm font-medium text-gray-900">
                      使用するナレッジ
                    </span>
                  </div>
                  {knowledgeDocs.length > 0 && (
                    <span className="text-xs text-gray-500">
                      {formData.linkedKnowledgeIds?.length || 0}/{knowledgeDocs.length} 件選択中
                    </span>
                  )}
                </div>

                {knowledgeDocs.length === 0 ? (
                  <div className="text-sm text-gray-500">
                    <p>この組織にはナレッジが登録されていません。</p>
                    <Link
                      href={`/dashboard/organizations/${formData.organization_id}/knowledge`}
                      className="text-blue-600 hover:underline"
                    >
                      ナレッジを登録する →
                    </Link>
                  </div>
                ) : (
                  <>
                    {/* 選択済みナレッジをタグで表示 */}
                    <div className="flex flex-wrap gap-2 mb-3">
                      {knowledgeDocs
                        .filter(doc => formData.linkedKnowledgeIds?.includes(doc.id))
                        .map(doc => {
                          const isUniversal = !doc.settingIds || doc.settingIds.length === 0;
                          return (
                            <span
                              key={doc.id}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                                isUniversal
                                  ? 'bg-green-100 text-green-800 border border-green-200'
                                  : 'bg-blue-100 text-blue-800 border border-blue-200'
                              }`}
                            >
                              {doc.title}
                              <button
                                type="button"
                                onClick={() => {
                                  const newIds = (formData.linkedKnowledgeIds || []).filter(id => id !== doc.id);
                                  setFormData(prev => ({ ...prev, linkedKnowledgeIds: newIds }));
                                }}
                                className="hover:opacity-70"
                                disabled={isLoading}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          );
                        })}
                      {(!formData.linkedKnowledgeIds || formData.linkedKnowledgeIds.length === 0) && (
                        <span className="text-xs text-gray-400 italic">ナレッジが選択されていません</span>
                      )}
                    </div>

                    {/* ナレッジ選択リスト */}
                    <div className="space-y-1 max-h-40 overflow-y-auto border border-gray-200 rounded-md bg-white p-2">
                      {knowledgeDocs.map((doc) => {
                        const isLinked = formData.linkedKnowledgeIds?.includes(doc.id) ?? false;
                        const isUniversal = !doc.settingIds || doc.settingIds.length === 0;

                        return (
                          <label
                            key={doc.id}
                            className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                              isLinked ? 'bg-blue-50' : 'hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isLinked}
                              onChange={(e) => {
                                const newIds = e.target.checked
                                  ? [...(formData.linkedKnowledgeIds || []), doc.id]
                                  : (formData.linkedKnowledgeIds || []).filter(id => id !== doc.id);
                                setFormData(prev => ({ ...prev, linkedKnowledgeIds: newIds }));
                              }}
                              className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                              disabled={isLoading}
                            />
                            <div className="flex-1 min-w-0 flex items-center gap-2">
                              <span className="text-sm text-gray-900 truncate">{doc.title}</span>
                              {isUniversal && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                                  共通
                                </span>
                              )}
                              <span className="text-xs text-gray-400">{doc.type}</span>
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    <p className="mt-2 text-xs text-gray-500">
                      「共通」のナレッジは全OCR設定で使用されます
                    </p>
                  </>
                )}
              </div>
            )}

            <p className="mt-1 text-xs text-gray-500">
              有効にすると、OCR実行完了時にナレッジを参照してコード提案を自動実行します
            </p>
          </div>
        )}
      </div>

      {/* --- AI自動判定用メタ情報 --- */}
      <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="h-5 w-5 text-green-600" />
          <h3 className="text-lg font-medium text-gray-900">AI自動判定設定</h3>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          帳票アップロード時にAIが自動でテンプレートを判定するための設定です。設定すると、帳票を選んだ時にこのテンプレートが自動で推定されます。
        </p>

        {/* 表示名 */}
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium text-gray-700">
            表示名（オプション）
          </label>
          <input
            type="text"
            id="displayName"
            value={formData.displayName || ''}
            onChange={handleChange}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
            placeholder="UIに表示される名前（設定しない場合は設定名が使用されます）"
            disabled={isLoading}
          />
        </div>

        {/* テンプレートタイプ */}
        <div className="mt-4">
          <label htmlFor="templateType" className="block text-sm font-medium text-gray-700">
            帳票タイプ（オプション）
          </label>
          <input
            type="text"
            id="templateType"
            value={formData.templateType || ''}
            onChange={handleChange}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
            placeholder="例: 請求書、見積書、注文書、納品書"
            disabled={isLoading}
          />
          <p className="mt-1 text-xs text-gray-500">
            帳票の種類を入力すると、AIがより正確に判定できます
          </p>
        </div>

        {/* 判定キーワード */}
        <div className="mt-4">
          <label htmlFor="exampleKeywords" className="block text-sm font-medium text-gray-700">
            判定キーワード（オプション）
          </label>
          <input
            type="text"
            id="exampleKeywords"
            value={formData.exampleKeywords?.join(', ') || ''}
            onChange={(e) => {
              const keywords = e.target.value
                .split(',')
                .map(k => k.trim())
                .filter(k => k.length > 0);
              setFormData(prev => ({
                ...prev,
                exampleKeywords: keywords.length > 0 ? keywords : undefined
              }));
            }}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
            placeholder="例: 請求書, INVOICE, 御請求書, 株式会社ABC"
            disabled={isLoading}
          />
          <p className="mt-1 text-xs text-gray-500">
            帳票内に含まれる特徴的なキーワードをカンマ区切りで入力（タイトル、会社名、固定ラベルなど）
          </p>
        </div>
      </div>

      {/* --- 2. 抽出指示 (AI) エリア --- */}
      <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
        <div className="flex justify-between items-center">
          <label htmlFor="prompt_text" className="block text-sm font-medium text-gray-700">
            抽出指示（チャット形式）
          </label>
          <button
            type="button"
            onClick={handleAiGenerate}
            className="flex items-center text-sm text-green-700 hover:text-green-600 disabled:opacity-50"
            disabled={isLoading || !uploadedFile || isAnalyzing}
            title={!uploadedFile ? "先にファイルをアップロードしてください" : "AIで抽出指示を自動生成"}
          >
            <Sparkles className={`mr-1 h-4 w-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
            {isAnalyzing ? '解析中...' : 'AIで自動生成'}
          </button>
        </div>
        <textarea
          id="prompt_text"
          rows={5}
          value={formData.prompt_text}
          onChange={handleChange}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
          placeholder="例: 「発行日(issueDate) と 会社名(companyName) を抜き出してください」"
          disabled={isLoading}
        />
      </div>
      
      {/* --- 3. 抽出フィールド手動追加 --- */}
      <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
        <div className="flex justify-between items-center">
          <label className="block text-sm font-medium text-gray-700">
            抽出フィールド (手動追加)
          </label>
          <button
            type="button"
            onClick={handleAiGenerate}
            className="flex items-center text-sm text-green-700 hover:text-green-600 disabled:opacity-50"
            disabled={isLoading || !uploadedFile || isAnalyzing}
            title={!uploadedFile ? "先にファイルをアップロードしてください" : "AIで抽出指示を自動生成"}
          >
            <Sparkles className={`mr-1 h-4 w-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
            {isAnalyzing ? '解析中...' : 'AIで自動生成'}
          </button>
        </div>
        {/* フィールドタイプ選択 */}
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            フィールドタイプ
          </label>
          <div className="flex gap-4">
            <label className="flex items-center">
              <input
                type="radio"
                value="single"
                checked={newFieldType === 'single'}
                onChange={(e) => setNewFieldType(e.target.value as 'single' | 'array')}
                className="mr-2"
                disabled={isLoading}
              />
              <span className="text-sm text-gray-700">単一値</span>
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                value="array"
                checked={newFieldType === 'array'}
                onChange={(e) => setNewFieldType(e.target.value as 'single' | 'array')}
                className="mr-2"
                disabled={isLoading}
              />
              <span className="text-sm text-gray-700">配列（繰り返し項目）</span>
            </label>
          </div>
        </div>

        {/* 基本情報入力 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <input
            type="text"
            value={newFieldName}
            onChange={(e) => setNewFieldName(e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
            placeholder="項目名 (例: lineItems)"
            disabled={isLoading}
          />
          <input
            type="text"
            value={newFieldInstruction}
            onChange={(e) => setNewFieldInstruction(e.target.value)}
            className="md:col-span-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
            placeholder={newFieldType === 'array' ? '抽出指示 (例: 請求書の明細行リスト)' : '抽出指示 (例: 請求書の合計金額)'}
            disabled={isLoading}
          />
        </div>

        {/* 配列フィールドの子フィールド管理 */}
        {newFieldType === 'array' && (
          <div className="mt-4 pl-6 border-l-4 border-green-200 bg-green-50 p-4 rounded">
            <h4 className="text-sm font-medium text-gray-900 mb-3">子フィールド（配列の各項目に含まれる情報）</h4>

            {/* 子フィールドリスト */}
            {newChildFields.length > 0 && (
              <div className="mb-3 space-y-2">
                {newChildFields.map((child, index) => (
                  <div key={index} className="flex items-center justify-between bg-white p-2 rounded border border-gray-200">
                    <div className="flex-1">
                      <span className="font-medium text-sm text-gray-900">{child.name}</span>
                      <span className="text-sm text-gray-500 ml-2">- {child.instruction}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteChildField(child.name)}
                      className="ml-2 text-red-600 hover:text-red-800"
                      disabled={isLoading}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 子フィールド追加フォーム */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                type="text"
                value={tempChildName}
                onChange={(e) => setTempChildName(e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 placeholder-gray-500 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                placeholder="子フィールド名 (例: itemName)"
                disabled={isLoading}
              />
              <input
                type="text"
                value={tempChildInstruction}
                onChange={(e) => setTempChildInstruction(e.target.value)}
                className="md:col-span-2 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 placeholder-gray-500 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                placeholder="抽出指示 (例: 商品名)"
                disabled={isLoading}
              />
            </div>
            <button
              type="button"
              onClick={handleAddChildField}
              className="mt-2 flex items-center gap-1 rounded-md bg-green-600 py-1.5 px-3 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
              disabled={isLoading}
            >
              <Plus className="h-4 w-4" />
              子フィールドを追加
            </button>
          </div>
        )}

        {/* フィールド追加ボタン */}
        <button
          type="button"
          onClick={handleAddField}
          className="mt-4 shrink-0 rounded-lg bg-gray-600 py-2 px-4 font-semibold text-white hover:bg-gray-500 disabled:opacity-50"
          disabled={isLoading}
        >
          フィールドを追加
        </button>
        
         <div className="mt-6 flow-root">
          <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
            <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
              <table className="min-w-full divide-y divide-gray-300">
                 <thead>
                  <tr>
                    <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-0">項目名</th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">タイプ</th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">抽出指示</th>
                    <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-0">
                      <span className="sr-only">アクション</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {formData.extraction_fields.map((field) => (
                    <React.Fragment key={field.name}>
                      {/* 親フィールド行 */}
                      <tr className={field.type === 'array' ? 'bg-green-50' : ''}>
                        <td className="py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-0">
                          <div className="flex items-center gap-2">
                            {field.type === 'array' && field.children && field.children.length > 0 && (
                              <button
                                type="button"
                                onClick={() => toggleFieldExpansion(field.name)}
                                className="text-gray-600 hover:text-gray-900"
                              >
                                {expandedFields.has(field.name) ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </button>
                            )}
                            <span>{field.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-4 text-sm text-gray-500">
                          <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                            field.type === 'array' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                          }`}>
                            {field.type === 'array' ? '配列' : '単一値'}
                          </span>
                        </td>
                        <td className="px-3 py-4 text-sm text-gray-500">{field.instruction}</td>
                        <td className="relative py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-0">
                          <button
                            type="button"
                            onClick={() => handleDeleteField(field.name)}
                            className="text-red-600 hover:text-red-900 disabled:opacity-50"
                            disabled={isLoading}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>

                      {/* 子フィールド行（配列の場合、展開されている時のみ表示） */}
                      {field.type === 'array' && field.children && expandedFields.has(field.name) && (
                        field.children.map((child) => (
                          <tr key={`${field.name}.${child.name}`} className="bg-gray-50">
                            <td className="py-3 pl-12 pr-3 text-sm text-gray-700 sm:pl-8">
                              <span className="flex items-center gap-2">
                                <span className="text-gray-400">└</span>
                                {child.name}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-500">
                              <span className="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800">
                                子フィールド
                              </span>
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-500">{child.instruction}</td>
                            <td className="relative py-3 pl-3 pr-4 text-right text-sm font-medium sm:pr-0">
                              {/* 子フィールドは個別削除不可（親ごと削除） */}
                            </td>
                          </tr>
                        ))
                      )}
                    </React.Fragment>
                  ))}
                  {formData.extraction_fields.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-sm text-gray-500">
                        追加されたフィールドはありません
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      
      {/* --- 4. 保存/キャンセルボタン --- */}
      <div className="flex justify-end space-x-4">
        <Link
          href="/dashboard/settings"
          className={`rounded-lg bg-gray-200 py-2 px-4 font-semibold text-gray-700 hover:bg-gray-300 ${isLoading ? 'pointer-events-none opacity-50' : ''}`}
        >
          キャンセル
        </Link>
        <button
          type="submit"
          className="rounded-lg bg-green-800 py-2 px-4 font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          disabled={isLoading}
        >
          {isLoading ? `${saveButtonText}中...` : saveButtonText}
        </button>
      </div>
    </form>
  );

  return (
    <div>
      <div className="mb-4 text-right">
        <button
          onClick={() => setLayout(layout === 'form-left' ? 'form-right' : 'form-left')}
          className="inline-flex items-center rounded-md bg-gray-200 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-300"
        >
          <ArrowLeftRight className="mr-2 h-4 w-4" />
          レイアウト切り替え
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className={`${layout === 'form-left' ? 'order-1' : 'order-2'}`}>
          {FormContent}
        </div>
        <div className={`${layout === 'form-left' ? 'order-2' : 'order-1'}`}>
          <PreviewContent
            handleFileChange={handleFileChange}
            imagePreviewUrl={imagePreviewUrl}
            uploadedFile={uploadedFile}
            sampleFilePath={formData.sample_file_path}
            onPdfLoadSuccess={onPdfLoadSuccess}
            onAnalyze={handleAiGenerate}
            isAnalyzing={isAnalyzing}
          />
        </div>
      </div>
    </div>
  );
}
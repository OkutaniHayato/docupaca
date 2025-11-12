"use client";

import React, { useState } from 'react'; 
import Link from 'next/link';
import Image from 'next/image'; 
import { 
  Sparkles, 
  X, 
  ArrowLeftRight, 
  Image as ImageIcon, 
  Check,
  Edit2,
  Ban 
} from 'lucide-react';

// --- ▼ 修正箇所 ▼ ---
// ★ 1.【最重要】'react-pdf' のルートからインポートするように修正
import { Document, Page, pdfjs } from 'react-pdf';
// import { Document, Page } from 'react-pdf/dist/cjs/entry.webpack'; // <-- 削除 (エラーの原因)
// import { pdfjs } from 'react-pdf/dist/cjs/pdf'; // <-- 削除 (上記に統合)
// --- ▲ 修正箇所 ▲ ---

// ★ 2. CSS パス (これらは正しい 'esm' パスです)
import 'react-pdf/dist/esm/Page/AnnotationLayer.css'; 
import 'react-pdf/dist/esm/Page/TextLayer.css'; 

// ワーカーパス (pdfjs が正しくインポートされていれば、これは機能します)
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;


// 抽出フィールドの型定義
export interface ExtractionField {
  name: string; 
  instruction: string;
}
export interface OcrSettingFormData {
  name: string;
  model_name: string;
  prompt_text: string;
  extraction_fields: ExtractionField[];
}

interface OcrSettingFormProps {
  initialData?: OcrSettingFormData;
  onSave: (data: OcrSettingFormData) => Promise<void>;
  isLoading: boolean;
  saveButtonText?: string;
}

// ★ 3. Props から 'layout' と 'setLayout' を削除
interface PreviewContentProps {
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  imagePreviewUrl: string | null;
  uploadedFile: File | null;
  pdfNumPages: number | null;
  onPdfLoadSuccess: ({ numPages }: { numPages: number }) => void;
}

// --- プレビューエリア（UI） ---
const PreviewContent = ({
  // ★ 4. 引数から 'layout' と 'setLayout' を削除
  handleFileChange,
  imagePreviewUrl,
  uploadedFile,
  pdfNumPages,
  onPdfLoadSuccess,
}: PreviewContentProps) => (
    <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm h-full">
      <h3 className="text-lg font-medium text-gray-900">帳票プレビュー</h3>
      <div className="mt-4">
        <label htmlFor="file-upload" className="block text-sm font-medium text-gray-700">
          帳票ファイル (画像 / PDF)
        </label>
        <input 
          id="file-upload" 
          type="file" 
          accept="image/*,application/pdf"
          onChange={handleFileChange}
          className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-green-100 file:text-green-800 hover:file:bg-green-200 disabled:opacity-50"
        />
      </div>
      
      <div className="relative mt-4 border border-gray-300 rounded-md bg-gray-50 min-h-[400px] max-h-[600px] flex items-center justify-center overflow-hidden">
        {!imagePreviewUrl ? (
          <div className="text-center text-gray-500">
            <ImageIcon className="mx-auto h-12 w-12 text-gray-400" />
            <p>プレビューする画像またはPDFをアップロードしてください。</p>
          </div>
        ) : (uploadedFile?.type === "application/pdf") ? (
          <div className="w-full h-full overflow-auto">
            <Document
              file={imagePreviewUrl}
              onLoadSuccess={onPdfLoadSuccess}
              // ★ 5. 'error: Error' と型を追加
              onLoadError={(error: Error) => console.error('PDF load error:', error)}
              className="flex justify-center"
              loading="PDFを読み込んでいます..."
            >
              <Page 
                pageNumber={1} 
                width={400} 
              />
            </Document>
            {pdfNumPages && (
              <p className="text-center text-sm text-gray-500">
                1 / {pdfNumPages} ページ (プレビューは1ページ目のみ)
              </p>
            )}
          </div>
        ) : (
          <div className="relative w-full h-full min-h-[400px]">
            <Image 
              src={imagePreviewUrl} 
              alt="帳票プレビュー" 
              fill 
              style={{ objectFit: "contain" }} 
            />
          </div>
        )}
      </div>
    </div>
);

/**
 * OCR設定の「新規作成」と「編集」で共通のフォームコンポーネント
 */
export default function OcrSettingForm({
  initialData,
  onSave,
  isLoading,
  saveButtonText = "保存する"
}: OcrSettingFormProps) {
  
  const [formData, setFormData] = useState<OcrSettingFormData>(
    initialData || {
      name: '',
      model_name: 'gemini-2.5-flash-lite',
      prompt_text: '',
      extraction_fields: [],
    }
  );
  
  // ( ... 残りの State やハンドラ関数は変更なし ... )
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldInstruction, setNewFieldInstruction] = useState('');

  const [layout, setLayout] = useState<'form-left' | 'form-right'>('form-left');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);

  const [editingField, setEditingField] = useState<string | null>(null); 
  const [tempEditInstruction, setTempEditInstruction] = useState(''); 
  
  const [pdfNumPages, setPdfNumPages] = useState<number | null>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
      setPdfNumPages(null); 

      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
      
      const newPreviewUrl = URL.createObjectURL(file);
      setImagePreviewUrl(newPreviewUrl);

    } else {
      setUploadedFile(null);
      setImagePreviewUrl(null);
    }
  };

  const onPdfLoadSuccess = ({ numPages }: { numPages: number }) => {
    setPdfNumPages(numPages);
  };

  const handleAddField = () => {
    if (newFieldName && newFieldInstruction) {
      if (formData.extraction_fields.some(field => field.name === newFieldName)) {
        alert("エラー: 項目名 (name) が重複しています。");
        return;
      }
      const newField: ExtractionField = { name: newFieldName, instruction: newFieldInstruction };
      setFormData(prev => ({ ...prev, extraction_fields: [...prev.extraction_fields, newField] }));
      setNewFieldName('');
      setNewFieldInstruction('');
    }
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
    console.log("AIによる自動生成を開始 (ファイル:", uploadedFile.name, ")");
    // ( ... AI生成ロジック ... )
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSave(formData); 
  };
  
  const handleEditClick = (field: ExtractionField) => {
    setEditingField(field.name);
    setTempEditInstruction(field.instruction);
  };

  const handleCancelEdit = () => {
    setEditingField(null);
    setTempEditInstruction('');
  };

  const handleSaveEdit = () => {
    if (!editingField) return;

    setFormData(prev => ({
      ...prev,
      extraction_fields: prev.extraction_fields.map(field => 
        field.name === editingField 
          ? { ...field, instruction: tempEditInstruction } 
          : field
      )
    }));
    
    setEditingField(null);
    setTempEditInstruction('');
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
            disabled={isLoading || !uploadedFile}
            title={!uploadedFile ? "先にファイルをアップロードしてください" : "AIで抽出指示を自動生成"}
          >
            <Sparkles className="mr-1 h-4 w-4" />
            AIで自動生成
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
            disabled={isLoading || !uploadedFile}
            title={!uploadedFile ? "先にファイルをアップロードしてください" : "AIで抽出指示を自動生成"}
          >
            <Sparkles className="mr-1 h-4 w-4" />
            AIで自動生成
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
          <input
            type="text"
            value={newFieldName}
            onChange={(e) => setNewFieldName(e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
            placeholder="項目名 (例: totalAmount)"
            disabled={isLoading}
          />
          <input
            type="text"
            value={newFieldInstruction}
            onChange={(e) => setNewFieldInstruction(e.target.value)}
            className="md:col-span-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
            placeholder="抽出指示 (例: 請求書の合計金額)"
            disabled={isLoading}
          />
        </div>
        <button
          type="button"
          onClick={handleAddField}
          className="mt-3 shrink-0 rounded-lg bg-gray-600 py-2 px-4 font-semibold text-white hover:bg-gray-500 disabled:opacity-50"
          disabled={isLoading}
        >
          追加
        </button>
        
         <div className="mt-6 flow-root">
          <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
            <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
              <table className="min-w-full divide-y divide-gray-300">
                 <thead>
                  <tr>
                    <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-0">項目名 (name)</th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">抽出指示 (instruction)</th>
                    <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-0">
                      <span className="sr-only">アクション</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {formData.extraction_fields.map((field) => (
                    <tr key={field.name}>
                      {editingField === field.name ? (
                        <>
                          <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-0">
                            {field.name}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                            <input
                              type="text"
                              value={tempEditInstruction}
                              onChange={(e) => setTempEditInstruction(e.target.value)}
                              className="block w-full rounded-md border border-gray-300 px-2 py-1 text-gray-900 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500"
                            />
                          </td>
                          <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-0">
                            <button
                              type="button"
                              onClick={handleSaveEdit}
                              className="text-green-600 hover:text-green-900"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelEdit}
                              className="ml-2 text-gray-500 hover:text-gray-800"
                            >
                              <Ban className="h-4 w-4" />
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-0">{field.name}</td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{field.instruction}</td>
                          <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-0">
                            <button
                              type="button"
                              onClick={() => handleEditClick(field)}
                              className="text-green-600 hover:text-green-900 disabled:opacity-50"
                              disabled={isLoading || !!editingField} 
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteField(field.name)}
                              className="ml-2 text-red-600 hover:text-red-900 disabled:opacity-50"
                              disabled={isLoading || !!editingField} 
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                  {formData.extraction_fields.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-4 text-center text-sm text-gray-500">
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
          disabled={isLoading || !!editingField} 
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
          {/* ★ 9. Props から layout/setLayout を削除 */}
          <PreviewContent 
            handleFileChange={handleFileChange}
            imagePreviewUrl={imagePreviewUrl}
            uploadedFile={uploadedFile}
            pdfNumPages={pdfNumPages}
            onPdfLoadSuccess={onPdfLoadSuccess}
          />
        </div>
      </div>
    </div>
  );
}
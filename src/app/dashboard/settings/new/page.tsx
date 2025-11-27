"use client";

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { db, storage } from '@/config/firebase';
import { collection, addDoc, serverTimestamp, doc, getDoc } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

import OcrSettingForm, { OcrSettingFormData } from '../OcrSettingForm'; 

/**
 * OCR
 * (OcrSettingForm 
 */
export default function NewOcrSettingPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateData, setTemplateData] = useState<OcrSettingFormData | null>(null);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser } = useAuth();
  const templateId = searchParams.get('template');

  // テンプレートIDが指定されている場合、データを読み込む
  useEffect(() => {
    const fetchTemplateData = async () => {
      if (!templateId || !currentUser) return;

      setIsLoadingTemplate(true);
      try {
        const docRef = doc(db, "ocr_settings", templateId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          // テンプレートとしてコピー：sample_file_pathはnullにして、名前は「（コピー）」を付ける
          setTemplateData({
            name: `${data.name}（コピー）`,
            model_name: data.model_name,
            prompt_text: data.prompt_text,
            extraction_fields: data.extraction_fields || [],
            sample_file_path: undefined, // 新しいファイルをアップロードさせるため
          });
        } else {
          setError("テンプレートが見つかりませんでした。");
        }
      } catch (err) {
        console.error("Error fetching template:", err);
        setError("テンプレートの読み込みに失敗しました。");
      } finally {
        setIsLoadingTemplate(false);
      }
    };

    fetchTemplateData();
  }, [templateId, currentUser]);

  /**
   * フォームの保存処理（ファイルアップロード含む）
   */
  const handleSave = async (data: OcrSettingFormData, file: File | null) => {
    setError(null);
    if (!currentUser) {
      setError("認証情報が見つかりません。再度ログインしてください。");
      return;
    }

    setIsLoading(true);

    try {
      let sampleFilePath: string | undefined = undefined;

      // ファイルがアップロードされている場合は、Firebase Storageに保存
      if (file) {
        const fileExtension = file.name.split('.').pop();
        const fileName = `${currentUser.uid}_${Date.now()}.${fileExtension}`;
        const filePath = `ocr_settings/${currentUser.uid}/${fileName}`;
        const storageRef = ref(storage, filePath);

        console.log('ファイルをStorageにアップロード中:', filePath);
        await uploadBytes(storageRef, file);
        console.log('ファイルのアップロードが完了しました');

        sampleFilePath = filePath;
      }

      // Firestoreに保存
      const settingData = {
        name: data.name,
        owner_id: currentUser.uid,
        prompt_text: data.prompt_text,
        extraction_fields: data.extraction_fields,
        model_name: data.model_name,
        sample_file_path: sampleFilePath,
        created_at: serverTimestamp(),
      };

      await addDoc(collection(db, "ocr_settings"), settingData);

      // 設定一覧ページに戻る
      router.push('/dashboard/settings');

    } catch (err: unknown) {
      console.error("Error saving OCR setting: ", err);
      setError("設定の保存に失敗しました。" + (err instanceof Error ? err.message : ''));
    } finally {
      setIsLoading(false);
    }
  };

  // テンプレート読み込み中の表示
  if (isLoadingTemplate) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-gray-500">テンプレートを読み込んでいます...</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">
        {templateId ? 'テンプレートからOCR設定を作成' : 'OCR設定を新規作成'}
      </h2>

      {templateId && (
        <div className="p-4 mb-4 bg-blue-50 border border-blue-200 rounded-lg text-blue-800">
          テンプレートから新しい設定を作成します。新しい帳票ファイルをアップロードして、「AIで自動生成」ボタンを押すと、既存のフィールド構造を維持したまま抽出指示が更新されます。
        </div>
      )}

      {error && (
        <div className="p-4 mb-4 bg-red-100 border border-red-300 rounded-lg text-red-800">
          {error}
        </div>
      )}

      <OcrSettingForm
        initialData={templateData || undefined}
        onSave={handleSave}
        isLoading={isLoading}
        saveButtonText="作成する"
        isTemplateMode={!!templateId}
      />
    </div>
  );
}
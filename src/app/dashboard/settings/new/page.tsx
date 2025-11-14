"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { db, storage } from '@/config/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

// 
import OcrSettingForm, { OcrSettingFormData } from '../OcrSettingForm'; 

/**
 * OCR
 * (OcrSettingForm 
 */
export default function NewOcrSettingPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { currentUser } = useAuth();

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

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">
        OCR設定を新規作成
      </h2>
      
      {/* */}
      {error && (
        <div className="p-4 mb-4 bg-red-100 border border-red-300 rounded-lg text-red-800">
          {error}
        </div>
      )}

      {/* */}
      <OcrSettingForm
        onSave={handleSave}
        isLoading={isLoading}
        saveButtonText="作成する"
      />
    </div>
  );
}
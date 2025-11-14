"use client";

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { db, storage } from '@/config/firebase';

import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage'; 
import OcrSettingForm, { OcrSettingFormData } from '../../OcrSettingForm'; 

/**
 * OCR
 * (OcrSettingForm 
 */
export default function EditOcrSettingPage() {
  // 
  const [initialData, setInitialData] = useState<OcrSettingFormData | null>(null);
  
  // 2
  const [isFetching, setIsFetching] = useState(true); // 
  const [isSaving, setIsSaving] = useState(false); // 

  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const params = useParams();
  const { currentUser } = useAuth();
  
  const settingId = params.id as string; //

  // 
  useEffect(() => {
    if (!settingId || !currentUser) return;

    const fetchSettingData = async () => {
      setIsFetching(true);
      setError(null);
      try {
        const docRef = doc(db, "ocr_settings", settingId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          
          if (data.owner_id !== currentUser.uid) {
            setError("この設定を編集する権限がありません。");
            return;
          }

          // initialDataに設定
          setInitialData({
            name: data.name,
            model_name: data.model_name,
            prompt_text: data.prompt_text,
            extraction_fields: data.extraction_fields || [],
            sample_file_path: data.sample_file_path,
          });
          
        } else {
          setError("指定された設定が見つかりません。");
        }
      } catch (err) {
        console.error("Error fetching document: ", err);
        setError("データの読み込みに失敗しました。");
      } finally {
        setIsFetching(false);
      }
    };

    fetchSettingData();
  }, [settingId, currentUser]);

  /**
   * 設定の更新処理（ファイルアップロード含む）
   */
  const handleUpdate = async (data: OcrSettingFormData, file: File | null) => {
    setError(null);
    setIsSaving(true);

    if (!currentUser) {
      setError("認証情報が見つかりません。");
      setIsSaving(false);
      return;
    }

    try {
      let sampleFilePath = data.sample_file_path; // 既存のパスを保持

      // 新しいファイルがアップロードされている場合は、Firebase Storageに保存
      if (file) {
        const fileExtension = file.name.split('.').pop();
        const fileName = `${currentUser.uid}_${Date.now()}.${fileExtension}`;
        const filePath = `ocr_settings/${currentUser.uid}/${fileName}`;
        const storageRef = ref(storage, filePath);

        console.log('新しいファイルをStorageにアップロード中:', filePath);
        await uploadBytes(storageRef, file);
        console.log('ファイルのアップロードが完了しました');

        sampleFilePath = filePath;
      }

      // Firestoreのドキュメントを更新
      const docRef = doc(db, "ocr_settings", settingId);

      await updateDoc(docRef, {
        name: data.name,
        model_name: data.model_name,
        prompt_text: data.prompt_text,
        extraction_fields: data.extraction_fields,
        sample_file_path: sampleFilePath,
      });

      // 設定一覧ページに戻る
      router.push('/dashboard/settings');

    } catch (err: unknown) {
      console.error("Error updating OCR setting: ", err);
      setError("設定の更新に失敗しました。" + (err instanceof Error ? err.message : ''));
    } finally {
      setIsSaving(false);
    }
  };

  // --- 
  if (isFetching) {
    return (
      <div className="flex justify-center items-center h-40">
        <p className="text-gray-500">設定を読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 mb-4 bg-red-100 border border-red-300 rounded-lg text-red-800">
        {error}
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">
        OCR設定を編集
      </h2>
      
      {initialData && (
        <OcrSettingForm
          initialData={initialData}
          onSave={handleUpdate}
          isLoading={isSaving}
          saveButtonText="更新する"
        />
      )}
    </div>
  );
}
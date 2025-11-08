"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation'; //
import { useAuth } from '@/context/AuthContext';
import { db } from '@/config/firebase';
import { 
  doc, 
  getDoc, //
  updateDoc, //
} from 'firebase/firestore'; 

/**
 * OCR設定 編集ページ（動的ルート: /edit/[id]）
 * URL の [id] に基づいて Firestore から既存データを読み込み、
 * フォームに表示・更新する
 */
export default function EditOcrSettingPage() {
  // フォームの状態
  const [settingName, setSettingName] = useState('');
  const [modelName, setModelName] = useState('gemini-2.5-flash-lite');
  const [promptText, setPromptText] = useState('');
  const [extractionFields, setExtractionFields] = useState<string[]>([]);
  const [newField, setNewField] = useState('');
  
  // UIの状態
  const [isLoading, setIsLoading] = useState(false); // 保存ローディング
  const [isFetching, setIsFetching] = useState(true); // 読込ローディング
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const params = useParams(); //
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
          
          //
          if (data.owner_id !== currentUser.uid) {
            setError("この設定を編集する権限がありません。");
            return;
          }

          // 取得したデータでフォームの state を更新
          setSettingName(data.name);
          setModelName(data.model_name);
          setPromptText(data.prompt_text);
          setExtractionFields(data.extraction_fields || []);
          
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
  }, [settingId, currentUser]); //

  /**
   * 抽出フィールドを手動で追加する
   */
  const handleAddField = () => {
    if (newField && !extractionFields.includes(newField)) {
      setExtractionFields([...extractionFields, newField]);
      setNewField('');
    }
  };

  /**
   * フォーム送信ハンドラ (Firestore のドキュメントを「更新」)
   */
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      // 更新するドキュメントへの参照
      const docRef = doc(db, "ocr_settings", settingId); //

      // 更新するデータ (created_at 以外)
      const updatedData = {
        name: settingName,
        prompt_text: promptText,
        extraction_fields: extractionFields,
        model_name: modelName,
        // owner_id は変更しない
        // updated_at: serverTimestamp() // (スキーマにはないが、必要なら追加)
      };

      // Firestore のドキュメントを「更新」
      await updateDoc(docRef, updatedData); //

      // 更新成功後、一覧ページにリダイレクト
      router.push('/dashboard/settings');

    } catch (err: unknown) {
      console.error("Error updating OCR setting: ", err);
      setError("設定の更新に失敗しました。" + (err instanceof Error ? err.message : ''));
    } finally {
      setIsLoading(false);
    }
  };

  // --- 読込ローディング / エラー表示 ---
  if (isFetching) {
    return <p className="text-center text-gray-500">設定を読み込み中...</p>;
  }
  if (error) {
    return <p className="text-center text-red-600">{error}</p>;
  }

  // --- メインフォーム (UIは 'new' ページとほぼ同じ) ---
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">
        OCR設定を編集
      </h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* --- 1. 基本設定エリア --- */}
        <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
          {/* 設定名 */}
          <div>
            <label htmlFor="settingName" className="block text-sm font-medium text-gray-700">
              設定名
            </label>
            <input
              type="text"
              id="settingName"
              value={settingName}
              onChange={(e) => setSettingName(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
              disabled={isLoading}
            />
          </div>

          {/* AIモデル選択 */}
          <div className="mt-4">
            <label htmlFor="modelName" className="block text-sm font-medium text-gray-700">
              使用するAIモデル
            </label>
            <select
              id="modelName"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
              disabled={isLoading}
            >
              <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite (デフォルト)</option>
              <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
            </select>
          </div>
        </div>

        {/* --- 2. 抽出指示 (プロンプト) エリア --- */}
        <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
          <label htmlFor="promptText" className="block text-sm font-medium text-gray-700">
            抽出指示（チャット形式）
          </label>
          <textarea
            id="promptText"
            rows={5}
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
            placeholder="例: 「発行日(issueDate) と 会社名(companyName) を抜き出してください」"
            disabled={isLoading}
          />
        </div>
        
        {/* --- 3. 抽出フィールドプレビューエリア --- */}
        <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
          <label className="block text-sm font-medium text-gray-700">
            抽出フィールド (手動追加)
          </label>
          <div className="flex space-x-2">
            <input
              type="text"
              value={newField}
              onChange={(e) => setNewField(e.target.value)}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
              placeholder="例: totalAmount"
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={handleAddField}
              className="shrink-0 rounded-lg bg-gray-600 py-2 px-4 font-semibold text-white hover:bg-gray-500 disabled:opacity-50"
              disabled={isLoading}
            >
              追加
            </button>
          </div>
          <div className="mt-4 space-x-2">
            {extractionFields.map((field) => (
              <span 
                key={field} 
                className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800"
              >
                {field}
              </span>
            ))}
          </div>
        </div>

        {/* --- 4. 保存/キャンセルボタン --- */}
        <div className="flex justify-end space-x-4">
          <Link
            href="/dashboard/settings"
            className={`rounded-lg bg-gray-200 py-2 px-4 font-semibold text-gray-700 hover:bg-gray-300 ${isLoading ? 'pointer-events-none opacity-50' : ''}`}
          >
            キャンセル
          </Link> {/* */}
          <button
            type="submit"
            className="rounded-lg bg-green-800 py-2 px-4 font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            disabled={isLoading}
          >
            {isLoading ? '更新中...' : '更新する'}
          </button>
        </div>
      </form>
    </div>
  );
}
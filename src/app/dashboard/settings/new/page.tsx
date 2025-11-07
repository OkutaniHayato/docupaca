"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation'; //
import { useAuth } from '@/context/AuthContext'; //
import { db } from '@/config/firebase'; //
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'; //

/**
 * OCR設定 新規作成ページ
 */
export default function NewOcrSettingPage() {
  // フォームの状態
  const [settingName, setSettingName] = useState('');
  const [modelName, setModelName] = useState('gemini-2.5-flash-lite');
  const [promptText, setPromptText] = useState('');
  const [extractionFields, setExtractionFields] = useState<string[]>([]);
  const [newField, setNewField] = useState('');
  
  // UIの状態
  const [isLoading, setIsLoading] = useState(false); //
  const [error, setError] = useState<string | null>(null); //

  const router = useRouter(); //
  const { currentUser } = useAuth(); //

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
   * フォーム送信ハンドラ (Firestore への保存)
   */
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => { //
    e.preventDefault();
    setError(null);

    if (!currentUser) { //
      setError("認証情報が見つかりません。再度ログインしてください。");
      return;
    }

    setIsLoading(true); //

    try {
      // DBスキーマ  に基づくデータ
      const settingData = {
        name: settingName,
        owner_id: currentUser.uid, //
        prompt_text: promptText,
        extraction_fields: extractionFields,
        model_name: modelName,
        created_at: serverTimestamp(), //
      };

      // Firestore の 'ocr_settings' コレクションにドキュメントを追加
      await addDoc(collection(db, "ocr_settings"), settingData);

      // 保存成功後、一覧ページにリダイレクト
      router.push('/dashboard/settings');

    } catch (err: unknown) {
      console.error("Error saving OCR setting: ", err);
      setError("設定の保存に失敗しました。" + (err instanceof Error ? err.message : ''));
    } finally {
      setIsLoading(false); //
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">
        OCR設定を新規作成
      </h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* --- 1. 基本設定エリア --- */}
        <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
          {/* 設定名 */}
          <div>
            <label htmlFor="settingName" className="block text-sm font-medium text-gray-700">
              設定名 (例：「請求書Aパターン」)
            </label>
            <input
              type="text"
              id="settingName"
              value={settingName}
              onChange={(e) => setSettingName(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
              placeholder="請求書Aパターン"
              disabled={isLoading} //
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
              disabled={isLoading} //
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
          <p className="text-sm text-gray-500 mb-2">
            「請求書から 会社名(companyName) と 合計金額(totalAmount) を抽出して」のように指示してください。
          </p>
          <textarea
            id="promptText"
            rows={5}
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
            placeholder="例: 「発行日(issueDate) と 会社名(companyName) を抜き出してください」"
            disabled={isLoading} //
          />
        </div>
        
        {/* --- 3. 抽出フィールドプレビューエリア --- */}
        <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
          <label className="block text-sm font-medium text-gray-700">
            抽出フィールド (手動追加)
          </label>
          {/* ... (p タグ) ... */}
          <div className="flex space-x-2">
            <input
              type="text"
              value={newField}
              onChange={(e) => setNewField(e.target.value)}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
              placeholder="例: totalAmount"
              disabled={isLoading} //
            />
            <button
              type="button"
              onClick={handleAddField}
              // 【Linter 修正】 flex-shrink-0 -> shrink-0
              className="shrink-0 rounded-lg bg-gray-600 py-2 px-4 font-semibold text-white hover:bg-gray-500 disabled:opacity-50"
              disabled={isLoading} //
            >
              追加
            </button>
          </div>
          
          {/* ... (追加されたフィールドのリスト) ... */}
        </div>
        
        {/* エラーメッセージ表示 */}
        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        {/* --- 4. 保存/キャンセルボタン --- */}
        <div className="flex justify-end space-x-4">
          <Link
            href="/dashboard/settings"
            // ローディング中はクリックできないように
            className={`rounded-lg bg-gray-200 py-2 px-4 font-semibold text-gray-700 hover:bg-gray-300 ${isLoading ? 'pointer-events-none opacity-50' : ''}`}
          >
            キャンセル
          </Link>
          <button
            type="submit"
            className="rounded-lg bg-green-800 py-2 px-4 font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            disabled={isLoading} //
          >
            {isLoading ? '保存中...' : '保存する'}
          </button>
        </div>
      </form>
    </div>
  );
}
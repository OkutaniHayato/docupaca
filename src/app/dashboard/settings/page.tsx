"use client"; 

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext'; 
import { db } from '@/config/firebase'; 
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  Timestamp,
  doc, 
  deleteDoc 
} from 'firebase/firestore'; 

interface OcrSetting {
  id: string; 
  name: string;
  model_name: string;
  created_at: Timestamp; 
}

/**
 * OCR設定一覧ページ
 * (削除機能を追加)
 */
export default function OcrSettingsPage() {
  const [settingsList, setSettingsList] = useState<OcrSetting[]>([]); 
  const [isLoading, setIsLoading] = useState(true); // 
  const [isDeleting, setIsDeleting] = useState<string | null>(null); //
  const { currentUser } = useAuth(); 

  // 
  useEffect(() => {
    if (!currentUser) {
      setIsLoading(false);
      return;
    }

    const fetchSettings = async () => {
      setIsLoading(true); // 
      try {
        const settingsRef = collection(db, "ocr_settings");
        const q = query(settingsRef, where("owner_id", "==", currentUser.uid));
        const querySnapshot = await getDocs(q);
        
        const settings: OcrSetting[] = [];
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          settings.push({
            id: doc.id,
            name: data.name,
            model_name: data.model_name,
            created_at: data.created_at,
          });
        });
        
        setSettingsList(settings);

      } catch (error) {
        console.error("Error fetching OCR settings: ", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSettings();
  }, [currentUser]); 

  /**
   * */
  const handleDeleteSetting = async (id: string) => {
    if (!window.confirm("この設定を削除してもよろしいですか？この操作は取り消せません。")) {
      return;
    }

    setIsDeleting(id); //
    try {
      // Firestore 
      await deleteDoc(doc(db, "ocr_settings", id));
      
      // 
      setSettingsList(prevList => prevList.filter(setting => setting.id !== id));

    } catch (error) {
      console.error("Error deleting setting: ", error);
      alert("削除に失敗しました。");
    } finally {
      setIsDeleting(null); //
    }
  };


  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">
          OCR設定
        </h2>
        
        <Link 
          href="/dashboard/settings/new"
          // 
          className={`rounded-lg bg-green-800 py-2 px-4 font-semibold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${isLoading || isDeleting ? 'pointer-events-none opacity-50' : ''}`}
        >
          新規作成
        </Link>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-left text-sm font-semibold text-gray-600">設定名</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600">使用モデル</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600">作成日</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600">アクション</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={4} className="p-3 text-center text-gray-500">
                  読み込み中...
                </td>
              </tr>
            ) : settingsList.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-3 text-center text-gray-500">
                  設定がありません。「新規作成」から最初の設定を登録してください。
                </td>
              </tr>
            ) : (
              settingsList.map((setting) => (
                <tr key={setting.id} className="border-b hover:bg-gray-50">
                  <td className="p-3 text-sm font-medium text-green-800">
                    {setting.name}
                  </td>
                  <td className="p-3 text-sm text-gray-700">
                    {setting.model_name}
                  </td>
                  <td className="p-3 text-sm text-gray-500">
                    {setting.created_at.toDate().toLocaleDateString()}
                  </td>
                  <td className="p-3 text-sm space-x-4">
                    {/* ---  */}
                    <Link 
                      href={`/dashboard/settings/edit/${setting.id}`} 
                      // 
                      className={`font-medium text-green-800 hover:text-green-700 ${isDeleting ? 'pointer-events-none opacity-50' : ''}`}
                    >
                      編集
                    </Link>
                    {/* ---  */}
                    <button
                      onClick={() => handleDeleteSetting(setting.id)}
                      // Error 
                      className="font-medium text-red-600 hover:text-red-500 disabled:opacity-50"
                      // 
                      disabled={isDeleting === setting.id || isLoading}
                    >
                      {isDeleting === setting.id ? '削除中...' : '削除'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
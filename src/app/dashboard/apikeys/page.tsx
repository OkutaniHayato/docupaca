"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/config/firebase';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  getDocs, 
  serverTimestamp, 
  Timestamp,
  doc, 
  deleteDoc 
} from 'firebase/firestore';

interface ApiKeyMeta {
  id: string;
  created_at: Timestamp;
}

// 
async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * API
 * (
 */
export default function ApiKeysPage() {
  const [keysList, setKeysList] = useState<ApiKeyMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true); //
  const [isDeleting, setIsDeleting] = useState<string | null>(null); //
  const [newKey, setNewKey] = useState<string | null>(null); 
  const { currentUser } = useAuth();

  //
  useEffect(() => {
    if (!currentUser) {
      setIsLoading(false); //
      return;
    }

    const fetchKeys = async () => {
      setIsLoading(true); //
      try {
        const q = query(
          collection(db, "api_keys"), 
          where("user_id", "==", currentUser.uid)
        );
        const querySnapshot = await getDocs(q);
        const keys: ApiKeyMeta[] = [];
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          keys.push({
            id: doc.id,
            created_at: data.created_at,
          });
        });
        setKeysList(keys);
      } catch (error) {
        console.error("Error fetching API keys: ", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchKeys();
  }, [currentUser]);

  /**
   * */
  const handleGenerateKey = async () => {
    if (!currentUser) return;

    setIsLoading(true); //
    setNewKey(null); 

    try {
      const randomValues = crypto.getRandomValues(new Uint8Array(20));
      const randomPart = Array.from(randomValues).map(b => b.toString(16).padStart(2, '0')).join('');
      const generatedKey = `dpk_${randomPart}`; 

      const hashedKey = await hashKey(generatedKey);

      // 
      const docRef = await addDoc(collection(db, "api_keys"), {
        user_id: currentUser.uid,
        key_hash: hashedKey,
        created_at: serverTimestamp(),
      });

      setNewKey(generatedKey);
      
      // 
      setKeysList(prevList => [
        ...prevList, 
        { id: docRef.id, created_at: Timestamp.now() } // 
      ]);

    } catch (error) {
      console.error("Error generating key: ", error);
      alert("キーの生成に失敗しました。");
    } finally {
      setIsLoading(false); //
    }
  };

  /**
   * */
  const handleDeleteKey = async (id: string) => {
    if (!window.confirm("このAPIキーを削除してもよろしいですか？\nこのキーを使用しているアプリケーションは動作しなくなります。")) {
      return;
    }

    setIsDeleting(id); //
    try {
      // Firestore 
      await deleteDoc(doc(db, "api_keys", id));
      
      // 
      setKeysList(prevList => prevList.filter(key => key.id !== id));

    } catch (error) {
      console.error("Error deleting API key: ", error);
      alert("キーの削除に失敗しました。");
    } finally {
      setIsDeleting(null); //
    }
  };


  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">
          API
        </h2>
        <button
          onClick={handleGenerateKey}
          disabled={isLoading || !!isDeleting} //
          // 
          className="rounded-lg bg-green-800 py-2 px-4 font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {isLoading ? '生成中...' : '新しいAPIキーを生成'}
        </button>
      </div>

      {/* */}
      {newKey && (
        <div className="mb-6 p-4 bg-green-100 border border-green-300 rounded-lg">
          <h3 className="font-semibold text-green-900">新しいAPIキーが生成されました</h3>
          <p className="text-sm text-green-800">
            このキーは**一度しか表示されません**。安全な場所にコピーして保管してください。
          </p>
          <input
            type="text"
            readOnly
            value={newKey}
            // 
            className="mt-2 block w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 font-mono text-sm"
          />
        </div>
      )}

      {/* */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-left text-sm font-semibold text-gray-600">キー (識別用)</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600">作成日</th>
              <th className="p-3 text-left text-sm font-semibold text-gray-600">アクション</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? ( //
              <tr>
                <td colSpan={3} className="p-3 text-center text-gray-500">
                  読み込み中...
                </td>
              </tr>
            ) : keysList.length === 0 ? ( //
              <tr>
                <td colSpan={3} className="p-3 text-center text-gray-500">
                  APIキーはありません。
                </td>
              </tr>
            ) : (
              keysList.map((key) => (
                <tr key={key.id} className="border-b hover:bg-gray-50">
                  <td className="p-3 text-sm font-mono text-gray-700">
                    API Key (ID: ...{key.id.slice(-6)}) 
                  </td>
                  <td className="p-3 text-sm text-gray-500">
                    {key.created_at.toDate().toLocaleString()}
                  </td>
                  <td className="p-3 text-sm">
                    {/* ---  */}
                    <button 
                      onClick={() => handleDeleteKey(key.id)}
                      // Error 
                      className="font-medium text-red-600 hover:text-red-500 disabled:opacity-50"
                      // 
                      disabled={isDeleting === key.id || isLoading}
                    >
                      {isDeleting === key.id ? '削除中...' : '削除'}
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
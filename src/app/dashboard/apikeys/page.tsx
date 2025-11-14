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
import { Copy, Trash2, Info, Key } from 'lucide-react';

interface ApiKeyMeta {
  id: string;
  key_prefix: string; // キーのプレフィックス（例: "dpk_abc123..."）
  created_at: Timestamp;
}

// SHA-256ハッシュ生成関数
async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * APIキー・エンドポイント管理画面
 * 外部API連携用のAPIキーを発行・管理し、OCR APIエンドポイント情報を確認できる
 */
export default function ApiKeysPage() {
  const [keysList, setKeysList] = useState<ApiKeyMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null); // モーダル表示用
  const [showModal, setShowModal] = useState(false);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const { currentUser } = useAuth();

  // プロジェクトIDから Cloud Functions のエンドポイントURLを生成
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'your-project-id';
  const functionRegion = 'asia-northeast1';
  const functionName = 'executeOcr';
  const apiEndpoint = `https://${functionRegion}-${projectId}.cloudfunctions.net/${functionName}`;

  // APIキー一覧を取得
  useEffect(() => {
    if (!currentUser) {
      setIsLoading(false);
      return;
    }

    const fetchKeys = async () => {
      setIsLoading(true);
      try {
        const q = query(
          collection(db, "api_keys"),
          where("user_id", "==", currentUser.uid)
        );
        const querySnapshot = await getDocs(q);
        const keys: ApiKeyMeta[] = [];
        querySnapshot.forEach((docSnapshot) => {
          const data = docSnapshot.data();
          keys.push({
            id: docSnapshot.id,
            key_prefix: data.key_prefix || `dpk_${docSnapshot.id.slice(0, 8)}...`,
            created_at: data.created_at,
          });
        });
        // 新しい順に並び替え
        keys.sort((a, b) => b.created_at.toMillis() - a.created_at.toMillis());
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
   * 新しいAPIキーを生成
   */
  const handleGenerateKey = async () => {
    if (!currentUser) return;

    setIsLoading(true);
    setNewKey(null);

    try {
      // ランダムな40文字の16進数文字列を生成
      const randomValues = crypto.getRandomValues(new Uint8Array(20));
      const randomPart = Array.from(randomValues).map(b => b.toString(16).padStart(2, '0')).join('');
      const generatedKey = `dpk_${randomPart}`; // "dpk_" プレフィックス

      const hashedKey = await hashKey(generatedKey);

      // プレフィックス（最初の12文字 + "..."）を保存
      const keyPrefix = `${generatedKey.slice(0, 12)}...`;

      // Firestoreに保存
      const docRef = await addDoc(collection(db, "api_keys"), {
        user_id: currentUser.uid,
        key_hash: hashedKey,
        key_prefix: keyPrefix,
        created_at: serverTimestamp(),
      });

      // 新しいキーを表示するためにモーダルを開く
      setNewKey(generatedKey);
      setShowModal(true);

      // リストに追加
      setKeysList(prevList => [
        { id: docRef.id, key_prefix: keyPrefix, created_at: Timestamp.now() },
        ...prevList
      ]);

    } catch (error) {
      console.error("Error generating key: ", error);
      alert("キーの生成に失敗しました。");
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * APIキーを削除
   */
  const handleDeleteKey = async (id: string) => {
    if (!window.confirm("このAPIキーを削除してもよろしいですか？\nこのキーを使用しているアプリケーションは動作しなくなります。")) {
      return;
    }

    setIsDeleting(id);
    try {
      await deleteDoc(doc(db, "api_keys", id));
      setKeysList(prevList => prevList.filter(key => key.id !== id));
    } catch (error) {
      console.error("Error deleting API key: ", error);
      alert("キーの削除に失敗しました。");
    } finally {
      setIsDeleting(null);
    }
  };

  /**
   * テキストをクリップボードにコピー
   */
  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKeyId(id);
      setTimeout(() => setCopiedKeyId(null), 2000); // 2秒後にリセット
    } catch (error) {
      console.error("Failed to copy: ", error);
      alert("コピーに失敗しました。");
    }
  };

  /**
   * モーダルを閉じる
   */
  const closeModal = () => {
    setShowModal(false);
    setNewKey(null);
  };

  return (
    <div className="space-y-6">
      {/* ページヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">
            APIキー・エンドポイント管理
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            外部連携用のAPIキーを発行・管理し、OCR APIエンドポイント情報を確認できます
          </p>
        </div>
        <button
          onClick={handleGenerateKey}
          disabled={isLoading || !!isDeleting}
          className="flex items-center gap-2 rounded-lg bg-[#166534] py-2.5 px-4 font-semibold text-white hover:bg-[#14532d] disabled:opacity-50 transition-colors"
        >
          <Key className="h-4 w-4" />
          新しいAPIキーを作成
        </button>
      </div>

      {/* エンドポイント情報エリア */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm p-6">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-[#166534] mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <h3 className="font-semibold text-gray-800 mb-2">API連携の仕組み</h3>
            <p className="text-sm text-gray-600 mb-4">
              実際のOCR処理は、このエンドポイント経由で外部のFirebase Cloud Functionsで実行されます。
              以下のエンドポイントURLに対して、発行したAPIキーを使用してリクエストを送信してください。
            </p>

            <div className="bg-gray-50 border border-gray-200 rounded-md p-4">
              <label className="block text-xs font-semibold text-gray-600 mb-2">
                OCR実行エンドポイント (Cloud Functions)
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono text-gray-800 bg-white border border-gray-300 rounded px-3 py-2">
                  {apiEndpoint}
                </code>
                <button
                  onClick={() => handleCopy(apiEndpoint, 'endpoint')}
                  className="flex items-center gap-1.5 rounded-md bg-gray-100 hover:bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors"
                >
                  <Copy className="h-4 w-4" />
                  {copiedKeyId === 'endpoint' ? 'コピーしました！' : 'コピー'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* APIキー管理エリア */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h3 className="font-semibold text-gray-800">発行済みAPIキー</h3>
          <p className="text-sm text-gray-600 mt-1">
            セキュリティのため、完全なキーは生成時のみ表示されます
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200">
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  キー (プレフィックス)
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  作成日
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  アクション
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {isLoading ? (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-gray-500">
                    読み込み中...
                  </td>
                </tr>
              ) : keysList.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-gray-500">
                    APIキーはまだ作成されていません。「新しいAPIキーを作成」ボタンから作成できます。
                  </td>
                </tr>
              ) : (
                keysList.map((key) => (
                  <tr key={key.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <code className="text-sm font-mono text-gray-800">
                        {key.key_prefix}
                      </code>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {key.created_at.toDate().toLocaleString('ja-JP', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleDeleteKey(key.id)}
                          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                          disabled={isDeleting === key.id || isLoading}
                        >
                          <Trash2 className="h-4 w-4" />
                          {isDeleting === key.id ? '削除中...' : '削除'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* キー生成モーダル */}
      {showModal && newKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
            {/* モーダルヘッダー */}
            <div className="border-b border-gray-200 px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-800">
                新しいAPIキーが生成されました
              </h3>
            </div>

            {/* モーダルコンテンツ */}
            <div className="px-6 py-4 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-md p-4">
                <p className="text-sm text-amber-900 font-medium">
                  ⚠️ このキーは二度と表示されません。安全に保管してください。
                </p>
                <p className="text-xs text-amber-800 mt-1">
                  このAPIキーを紛失した場合、新しいキーを生成する必要があります。
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  APIキー
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={newKey}
                    className="flex-1 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#166534]"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    onClick={() => handleCopy(newKey, 'modal')}
                    className="flex items-center gap-1.5 rounded-md bg-[#166534] hover:bg-[#14532d] px-4 py-2 text-sm font-medium text-white transition-colors"
                  >
                    <Copy className="h-4 w-4" />
                    {copiedKeyId === 'modal' ? 'コピーしました！' : 'コピー'}
                  </button>
                </div>
              </div>
            </div>

            {/* モーダルフッター */}
            <div className="border-t border-gray-200 px-6 py-4 flex justify-end">
              <button
                onClick={closeModal}
                className="rounded-md bg-gray-100 hover:bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
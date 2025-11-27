"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/config/firebase';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { CorrectionLearningSettings } from '@/types/ocr';
import {
  GraduationCap,
  Save,
  Clock,
  Calendar,
  Hash,
  Power,
  AlertCircle,
  CheckCircle,
  Loader2
} from 'lucide-react';

// デフォルト設定
const DEFAULT_SETTINGS: Omit<CorrectionLearningSettings, 'updatedAt' | 'updatedBy'> = {
  enabled: true,
  scheduledHour: 3, // 午前3時
  lookbackDays: 30,
  minOccurrenceCount: 3,
};

export default function LearningSettingsPage() {
  const { currentUser } = useAuth();
  const [settings, setSettings] = useState<CorrectionLearningSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 設定を取得
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const docRef = doc(db, 'app_settings', 'correction_learning');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          setSettings(docSnap.data() as CorrectionLearningSettings);
        } else {
          // デフォルト設定を使用
          setSettings({
            ...DEFAULT_SETTINGS,
            updatedAt: new Date(),
          });
        }
      } catch (error) {
        console.error('設定の取得に失敗:', error);
        setMessage({ type: 'error', text: '設定の取得に失敗しました' });
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  // 設定を保存
  const handleSave = async () => {
    if (!settings || !currentUser) return;

    setSaving(true);
    setMessage(null);

    try {
      const docRef = doc(db, 'app_settings', 'correction_learning');
      const updatedSettings: CorrectionLearningSettings = {
        ...settings,
        updatedAt: Timestamp.now(),
        updatedBy: currentUser.uid,
      };

      await setDoc(docRef, updatedSettings);
      setSettings(updatedSettings);
      setMessage({ type: 'success', text: '設定を保存しました' });

      // 3秒後にメッセージを消す
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      console.error('設定の保存に失敗:', error);
      setMessage({ type: 'error', text: '設定の保存に失敗しました' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-red-700">
        設定を読み込めませんでした
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <GraduationCap className="h-8 w-8 text-green-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">訂正学習設定</h1>
            <p className="text-sm text-gray-600">
              AIの抽出ミスを自動学習するバッチ処理の設定
            </p>
          </div>
        </div>
      </div>

      {/* メッセージ */}
      {message && (
        <div
          className={`flex items-center rounded-lg p-4 ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="mr-2 h-5 w-5" />
          ) : (
            <AlertCircle className="mr-2 h-5 w-5" />
          )}
          {message.text}
        </div>
      )}

      {/* 設定フォーム */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <div className="space-y-6">
          {/* 有効/無効 */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center space-x-3">
              <Power className={`h-6 w-6 ${settings.enabled ? 'text-green-600' : 'text-gray-400'}`} />
              <div>
                <h3 className="font-medium text-gray-900">訂正学習バッチ</h3>
                <p className="text-sm text-gray-500">
                  {settings.enabled ? '有効' : '無効'}
                </p>
              </div>
            </div>
            <button
              onClick={() => setSettings({ ...settings, enabled: !settings.enabled })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.enabled ? 'bg-green-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* 実行時刻 */}
          <div className="rounded-lg border p-4">
            <div className="flex items-center space-x-3 mb-3">
              <Clock className="h-5 w-5 text-gray-600" />
              <h3 className="font-medium text-gray-900">実行時刻（JST）</h3>
            </div>
            <select
              value={settings.scheduledHour}
              onChange={(e) => setSettings({ ...settings, scheduledHour: parseInt(e.target.value) })}
              disabled={!settings.enabled}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 disabled:bg-gray-100 disabled:text-gray-500"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>
                  {i.toString().padStart(2, '0')}:00
                </option>
              ))}
            </select>
            <p className="mt-2 text-sm text-gray-500">
              毎日この時刻に訂正学習バッチが実行されます
            </p>
          </div>

          {/* 対象日数 */}
          <div className="rounded-lg border p-4">
            <div className="flex items-center space-x-3 mb-3">
              <Calendar className="h-5 w-5 text-gray-600" />
              <h3 className="font-medium text-gray-900">対象日数</h3>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="number"
                value={settings.lookbackDays}
                onChange={(e) => setSettings({
                  ...settings,
                  lookbackDays: Math.max(1, Math.min(365, parseInt(e.target.value) || 1))
                })}
                disabled={!settings.enabled}
                min={1}
                max={365}
                className="w-24 rounded-lg border border-gray-300 px-4 py-2 text-center focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 disabled:bg-gray-100 disabled:text-gray-500"
              />
              <span className="text-gray-700">日間</span>
            </div>
            <p className="mt-2 text-sm text-gray-500">
              過去何日分の訂正データを集計対象にするか
            </p>
          </div>

          {/* 最低発生回数 */}
          <div className="rounded-lg border p-4">
            <div className="flex items-center space-x-3 mb-3">
              <Hash className="h-5 w-5 text-gray-600" />
              <h3 className="font-medium text-gray-900">最低発生回数</h3>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="number"
                value={settings.minOccurrenceCount}
                onChange={(e) => setSettings({
                  ...settings,
                  minOccurrenceCount: Math.max(1, Math.min(100, parseInt(e.target.value) || 1))
                })}
                disabled={!settings.enabled}
                min={1}
                max={100}
                className="w-24 rounded-lg border border-gray-300 px-4 py-2 text-center focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 disabled:bg-gray-100 disabled:text-gray-500"
              />
              <span className="text-gray-700">回以上</span>
            </div>
            <p className="mt-2 text-sm text-gray-500">
              同じ訂正パターンがこの回数以上発生した場合に学習
            </p>
          </div>

          {/* 説明 */}
          <div className="rounded-lg bg-blue-50 p-4">
            <h4 className="font-medium text-blue-800 mb-2">訂正学習とは</h4>
            <p className="text-sm text-blue-700">
              OCRの抽出結果を人間が訂正した履歴を分析し、同じミスが繰り返される場合に
              テンプレートに「置換ルール」として自動的に記録します。
              これにより、AIが同じ間違いを繰り返さないようになります。
            </p>
          </div>
        </div>

        {/* 保存ボタン */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center rounded-lg bg-green-600 px-6 py-2 text-white transition hover:bg-green-700 disabled:bg-gray-400"
          >
            {saving ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Save className="mr-2 h-5 w-5" />
            )}
            {saving ? '保存中...' : '設定を保存'}
          </button>
        </div>
      </div>

      {/* 最終更新情報 */}
      {settings.updatedAt && (
        <p className="text-sm text-gray-500">
          最終更新: {settings.updatedAt instanceof Date
            ? settings.updatedAt.toLocaleString('ja-JP')
            : settings.updatedAt.toDate().toLocaleString('ja-JP')}
        </p>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/config/firebase';
import { doc, getDoc, setDoc, Timestamp, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { CorrectionLearningSettings, LearningHistory } from '@/types/ocr';
import {
  GraduationCap,
  Save,
  Clock,
  Calendar,
  Hash,
  Power,
  AlertCircle,
  CheckCircle,
  Loader2,
  History,
  ChevronDown,
  ChevronUp,
  PlayCircle,
  Timer,
  FileText,
  Plus,
  RefreshCw
} from 'lucide-react';

// デフォルト設定
const DEFAULT_SETTINGS: Omit<CorrectionLearningSettings, 'updatedAt' | 'updatedBy'> = {
  enabled: true,
  scheduledHour: 3, // 午前3時
  lookbackDays: 30,
  minOccurrenceCount: 3,
};

// 履歴アイテムコンポーネント
function HistoryItem({ history, id }: { history: LearningHistory; id: string }) {
  const [expanded, setExpanded] = useState(false);

  const executedAt = history.executedAt instanceof Date
    ? history.executedAt
    : history.executedAt.toDate();

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* ヘッダー部分（クリックで展開） */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center space-x-4">
          <div className={`p-2 rounded-full ${
            history.executionType === 'scheduled' ? 'bg-blue-100' : 'bg-purple-100'
          }`}>
            {history.executionType === 'scheduled' ? (
              <Timer className="h-5 w-5 text-blue-600" />
            ) : (
              <PlayCircle className="h-5 w-5 text-purple-600" />
            )}
          </div>
          <div>
            <div className="font-medium text-gray-900">
              {executedAt.toLocaleString('ja-JP')}
            </div>
            <div className="text-sm text-gray-500 flex items-center space-x-4">
              <span className={`px-2 py-0.5 rounded text-xs ${
                history.executionType === 'scheduled'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-purple-100 text-purple-700'
              }`}>
                {history.executionType === 'scheduled' ? 'スケジュール実行' : '手動実行'}
              </span>
              <span className="flex items-center">
                <Plus className="h-3 w-3 mr-1" />
                {history.stats.rulesAdded}件追加
              </span>
              <span className="flex items-center">
                <RefreshCw className="h-3 w-3 mr-1" />
                {history.stats.rulesUpdated}件更新
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-500">
            {history.durationMs}ms
          </span>
          {expanded ? (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          )}
        </div>
      </button>

      {/* 展開時の詳細 */}
      {expanded && (
        <div className="border-t bg-gray-50 p-4">
          {/* 概要 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-white p-3 rounded-lg border">
              <div className="text-xs text-gray-500">処理した訂正数</div>
              <div className="text-lg font-semibold text-gray-900">
                {history.stats.totalCorrections}
              </div>
            </div>
            <div className="bg-white p-3 rounded-lg border">
              <div className="text-xs text-gray-500">対象テンプレート</div>
              <div className="text-lg font-semibold text-gray-900">
                {history.stats.templatesProcessed}
              </div>
            </div>
            <div className="bg-white p-3 rounded-lg border">
              <div className="text-xs text-gray-500">対象日数</div>
              <div className="text-lg font-semibold text-gray-900">
                {history.settings.lookbackDays}日
              </div>
            </div>
            <div className="bg-white p-3 rounded-lg border">
              <div className="text-xs text-gray-500">最低発生回数</div>
              <div className="text-lg font-semibold text-gray-900">
                {history.settings.minOccurrenceCount}回
              </div>
            </div>
          </div>

          {/* ルール詳細 */}
          <div className="space-y-2">
            <h4 className="font-medium text-gray-900 flex items-center">
              <FileText className="h-4 w-4 mr-2" />
              学習ルール詳細
            </h4>
            <div className="bg-white border rounded-lg overflow-hidden">
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-gray-600">テンプレート</th>
                      <th className="px-3 py-2 text-left text-gray-600">フィールド</th>
                      <th className="px-3 py-2 text-left text-gray-600">AI値</th>
                      <th className="px-3 py-2 text-left text-gray-600">正解値</th>
                      <th className="px-3 py-2 text-center text-gray-600">回数</th>
                      <th className="px-3 py-2 text-center text-gray-600">状態</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {history.rules.map((rule, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-900 truncate max-w-[150px]" title={rule.templateName}>
                          {rule.templateName || rule.templateId}
                        </td>
                        <td className="px-3 py-2 text-gray-700 font-mono text-xs">
                          {rule.fieldKey}
                        </td>
                        <td className="px-3 py-2 text-red-600 truncate max-w-[120px]" title={rule.aiValue}>
                          {rule.aiValue}
                        </td>
                        <td className="px-3 py-2 text-green-600 truncate max-w-[120px]" title={rule.correctValue}>
                          {rule.correctValue}
                        </td>
                        <td className="px-3 py-2 text-center text-gray-700">
                          {rule.count}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            rule.isNew
                              ? 'bg-green-100 text-green-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}>
                            {rule.isNew ? '新規' : '更新'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* 生データ（JSON） */}
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-900">
              生データ（JSON）を表示
            </summary>
            <pre className="mt-2 p-3 bg-gray-900 text-green-400 rounded-lg text-xs overflow-x-auto max-h-48">
              {JSON.stringify(history, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

export default function LearningSettingsPage() {
  const { currentUser } = useAuth();
  const [settings, setSettings] = useState<CorrectionLearningSettings | null>(null);
  const [histories, setHistories] = useState<Array<{ id: string; data: LearningHistory }>>([]);
  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);
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

  // 履歴を取得
  const fetchHistories = async () => {
    try {
      const q = query(
        collection(db, 'learning_history'),
        orderBy('executedAt', 'desc'),
        limit(20)
      );
      const snapshot = await getDocs(q);
      const historyData = snapshot.docs.map(doc => ({
        id: doc.id,
        data: doc.data() as LearningHistory,
      }));
      setHistories(historyData);
    } catch (error) {
      console.error('履歴の取得に失敗:', error);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchHistories();
  }, []);

  // 手動実行
  const handleManualExecution = async () => {
    if (!currentUser) return;

    setExecuting(true);
    setMessage(null);

    try {
      // Firebase Cloud Functions のURLを構築（asia-northeast1リージョン）
      const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
      const functionUrl = `https://asia-northeast1-${projectId}.cloudfunctions.net/runCorrectionLearning`;

      const token = await currentUser.getIdToken();
      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('学習バッチの実行に失敗しました');
      }

      const result = await response.json();

      if (result.success) {
        setMessage({
          type: 'success',
          text: `学習バッチを実行しました（${result.rulesAdded}件追加、${result.rulesUpdated}件更新）`,
        });
        // 履歴を再取得
        await fetchHistories();
      } else {
        setMessage({
          type: 'error',
          text: result.message || '学習バッチの実行に失敗しました',
        });
      }

      setTimeout(() => setMessage(null), 5000);
    } catch (error) {
      console.error('手動実行に失敗:', error);
      setMessage({ type: 'error', text: '学習バッチの実行に失敗しました' });
    } finally {
      setExecuting(false);
    }
  };

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
              className="w-full rounded-lg border border-gray-300 px-4 py-2 text-gray-900 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 disabled:bg-gray-100 disabled:text-gray-700"
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
                className="w-24 rounded-lg border border-gray-300 px-4 py-2 text-center text-gray-900 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 disabled:bg-gray-100 disabled:text-gray-700"
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
                className="w-24 rounded-lg border border-gray-300 px-4 py-2 text-center text-gray-900 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 disabled:bg-gray-100 disabled:text-gray-700"
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

      {/* 学習履歴セクション */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <History className="h-6 w-6 text-green-600" />
            <h2 className="text-xl font-bold text-gray-900">学習履歴</h2>
          </div>
          <button
            onClick={handleManualExecution}
            disabled={executing}
            className="flex items-center rounded-lg bg-purple-600 px-4 py-2 text-white transition hover:bg-purple-700 disabled:bg-gray-400"
          >
            {executing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="mr-2 h-4 w-4" />
            )}
            {executing ? '実行中...' : '手動実行'}
          </button>
        </div>

        {loadingHistory ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : histories.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <History className="h-12 w-12 mx-auto mb-3 text-gray-300" />
            <p>学習履歴がありません</p>
            <p className="text-sm">訂正学習バッチが実行されると、ここに履歴が表示されます</p>
          </div>
        ) : (
          <div className="space-y-3">
            {histories.map(({ id, data }) => (
              <HistoryItem key={id} id={id} history={data} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

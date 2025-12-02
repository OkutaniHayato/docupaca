"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { db, storage } from '@/config/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import {
  ExtractedData,
  ExtractedValue,
  ExtractedArrayData,
  isExtractedArrayData,
  isExtractedValue,
  BBox,
  CorrectionLog,
  DocumentCodeSuggestions,
  CodeSuggestion,
} from '@/types/ocr';
import { AlertTriangle, CheckCircle, AlertCircle, Edit3, Save, X, Sparkles, Loader2, Info, ThumbsUp, ThumbsDown } from 'lucide-react';
import { updateDoc, collection, addDoc, Timestamp } from 'firebase/firestore';

interface OcrSetting {
  name: string;
  fields: Array<{ name: string; description: string }>;
  prompt?: string;
  model?: string;
}

interface HistoryDetail {
  id: string;
  status: string;
  original_file_path: string;
  converted_image_path?: string; // PDF→画像変換後のパス（後方互換性）
  converted_image_paths?: string[]; // 複数ページ対応
  page_count?: number;
  extracted_data: ExtractedData;
  humanConfirmedData?: ExtractedData; // 人間確定データ
  isHumanConfirmed?: boolean; // 人間による確定が完了したかどうか
  imageUrl: string | null;
  convertedImageUrl: string | null; // 変換された画像のURL（後方互換性）
  convertedImageUrls: string[]; // 複数ページの画像URL
  setting?: OcrSetting; // OCR設定情報
  setting_id?: string; // OCR設定ID
  // コード提案関連
  codeSuggestions?: DocumentCodeSuggestions;
  codeSuggestedAt?: Date;
  isCodeSuggestionApproved?: boolean;
  codeSuggestionApprovedAt?: Date;
  // 組織のRAG機能設定
  ragCodeSuggestionEnabled?: boolean;
}

/**
 * 信頼度を表示用の形式に変換
 */
const formatConfidence = (confidence?: number): string => {
  if (confidence === undefined || confidence === null) return '-';
  return `${Math.round(confidence * 100)}%`;
};

/**
 * 信頼度に応じた色とアイコンを取得
 * >= 0.8: 緑（通常）
 * 0.5〜0.8: 黄（注意）
 * < 0.5: 赤（要確認）
 */
const getConfidenceStyle = (confidence?: number): {
  bgColor: string;
  textColor: string;
  borderColor: string;
  icon: React.ReactNode;
  label: string;
} => {
  if (confidence === undefined || confidence === null) {
    return {
      bgColor: 'bg-gray-100',
      textColor: 'text-gray-500',
      borderColor: 'border-gray-300',
      icon: null,
      label: '-',
    };
  }

  if (confidence >= 0.8) {
    return {
      bgColor: 'bg-green-50',
      textColor: 'text-green-700',
      borderColor: 'border-green-300',
      icon: <CheckCircle className="w-4 h-4 text-green-600" />,
      label: '高信頼度',
    };
  } else if (confidence >= 0.5) {
    return {
      bgColor: 'bg-yellow-50',
      textColor: 'text-yellow-700',
      borderColor: 'border-yellow-300',
      icon: <AlertTriangle className="w-4 h-4 text-yellow-600" />,
      label: '注意',
    };
  } else {
    return {
      bgColor: 'bg-red-50',
      textColor: 'text-red-700',
      borderColor: 'border-red-300',
      icon: <AlertCircle className="w-4 h-4 text-red-600" />,
      label: '要確認',
    };
  }
};

/**
 * 信頼度バッジコンポーネント
 */
const ConfidenceBadge: React.FC<{ confidence?: number; showIcon?: boolean }> = ({
  confidence,
  showIcon = true
}) => {
  const style = getConfidenceStyle(confidence);

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${style.bgColor} ${style.textColor} border ${style.borderColor}`}>
      {showIcon && style.icon}
      {formatConfidence(confidence)}
    </span>
  );
};

/**
 * コード提案の表示バッジ
 */
const CodeSuggestionBadge: React.FC<{ suggestion: CodeSuggestion }> = ({ suggestion }) => {
  const style = getConfidenceStyle(suggestion.confidence);

  if (!suggestion.code) {
    return (
      <span className="text-gray-400 text-sm italic">提案なし</span>
    );
  }

  return (
    <div className={`inline-flex flex-col gap-1 px-3 py-2 rounded-lg ${style.bgColor} border ${style.borderColor}`}>
      <div className="flex items-center gap-2">
        <span className="font-mono font-medium text-gray-900">{suggestion.code}</span>
        <ConfidenceBadge confidence={suggestion.confidence} />
      </div>
      {suggestion.reason && (
        <div className="text-xs text-gray-600 flex items-start gap-1">
          <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span>{suggestion.reason}</span>
        </div>
      )}
    </div>
  );
};

/**
 * コード提案パネルコンポーネント
 */
const CodeSuggestionsPanel: React.FC<{
  suggestions: DocumentCodeSuggestions;
  onApprove: () => void;
  onReject: () => void;
  isApproved?: boolean;
  isSaving?: boolean;
}> = ({ suggestions, onApprove, onReject, isApproved, isSaving }) => {
  return (
    <div className="mt-6 rounded-lg border border-purple-200 bg-purple-50 shadow-sm overflow-hidden">
      <div className="bg-purple-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-600" />
          <h3 className="text-lg font-semibold text-purple-900">AIコード提案</h3>
          {isApproved && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
              <CheckCircle className="w-3 h-3" />
              承認済み
            </span>
          )}
        </div>
        {!isApproved && (
          <div className="flex items-center gap-2">
            <button
              onClick={onReject}
              disabled={isSaving}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm font-medium disabled:opacity-50"
            >
              <ThumbsDown className="w-4 h-4" />
              却下
            </button>
            <button
              onClick={onApprove}
              disabled={isSaving}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium disabled:opacity-50"
            >
              <ThumbsUp className="w-4 h-4" />
              承認
            </button>
          </div>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* 注意事項 */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-yellow-800">
            <p className="font-medium">このコード提案はAIによる参考情報です</p>
            <p className="mt-1">必ず内容を確認し、必要に応じて修正してからご使用ください。低い信頼度の提案には特に注意が必要です。</p>
          </div>
        </div>

        {/* 顧客コード */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">顧客コード</h4>
          <CodeSuggestionBadge suggestion={suggestions.customerCode} />
        </div>

        {/* 明細行のコード */}
        {suggestions.lines && suggestions.lines.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">明細コード</h4>
            <div className="overflow-x-auto">
              <table className="min-w-full border border-gray-200 rounded-lg overflow-hidden">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">行</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">品目コード</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">勘定科目</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">税区分</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">部門コード</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.lines.map((line, index) => (
                    <tr key={index} className="border-t border-gray-200 hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm font-medium text-gray-700">{line.index + 1}</td>
                      <td className="px-3 py-2">
                        <CodeSuggestionBadge suggestion={line.itemCode} />
                      </td>
                      <td className="px-3 py-2">
                        <CodeSuggestionBadge suggestion={line.accountCode} />
                      </td>
                      <td className="px-3 py-2">
                        <CodeSuggestionBadge suggestion={line.taxCategory} />
                      </td>
                      <td className="px-3 py-2">
                        <CodeSuggestionBadge suggestion={line.departmentCode} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * OCR実行履歴 詳細ページ
 */
export default function HistoryDetailPage() {
  const [history, setHistory] = useState<HistoryDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [expandedArrays, setExpandedArrays] = useState<Set<string>>(new Set());
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [initialExpansionDone, setInitialExpansionDone] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showBboxHighlight, setShowBboxHighlight] = useState(true);
  const imageRef = useRef<HTMLImageElement>(null);
  const params = useParams();
  const { currentUser } = useAuth();

  // 編集モード関連の状態
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedData, setEditedData] = useState<ExtractedData | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // コード提案関連の状態
  const [isCodeSuggesting, setIsCodeSuggesting] = useState(false);
  const [codeSuggestionError, setCodeSuggestionError] = useState<string | null>(null);
  const [showCodeSuggestionModal, setShowCodeSuggestionModal] = useState(false);

  const historyId = params.id as string;

  const toggleArrayExpansion = (fieldName: string) => {
    setExpandedArrays(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fieldName)) {
        newSet.delete(fieldName);
      } else {
        newSet.add(fieldName);
      }
      return newSet;
    });
  };

  /**
   * 確定データを保存し、差分ログ（corrections）を生成
   */
  const handleSaveConfirmedData = async () => {
    if (!history || !editedData || !currentUser) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      const historyRef = doc(db, 'ocr_history', historyId);
      const aiData = history.extracted_data;

      // corrections を生成（AIの値と人間確定値の差分）
      const corrections: Omit<CorrectionLog, 'createdAt'>[] = [];

      /**
       * 値を比較して差分を検出するヘルパー関数
       */
      const compareAndAddCorrection = (
        fieldKey: string,
        aiValue: ExtractedValue | null | undefined,
        humanValue: ExtractedValue | null | undefined
      ) => {
        if (!aiValue || !humanValue) return;
        if (aiValue.value !== humanValue.value) {
          // undefinedフィールドを除外してcorrectionを作成
          const correction: Omit<CorrectionLog, 'createdAt'> = {
            docId: historyId,
            templateId: history.setting_id || '',
            fieldKey,
            aiValue: aiValue.value,
            humanValue: humanValue.value,
            aiConfidence: aiValue.confidence ?? 0,
          };
          // bbox と page は値がある場合のみ追加
          if (aiValue.bbox !== undefined) {
            correction.bbox = aiValue.bbox;
          }
          if (aiValue.page !== undefined) {
            correction.page = aiValue.page;
          }
          corrections.push(correction);
        }
      };

      // 単一値フィールドと配列フィールドを走査して差分を検出
      Object.entries(aiData).forEach(([key, aiFieldData]) => {
        const humanFieldData = editedData[key];

        if (isExtractedValue(aiFieldData) && isExtractedValue(humanFieldData)) {
          // 単一値フィールドの比較
          compareAndAddCorrection(key, aiFieldData, humanFieldData);
        } else if (isExtractedArrayData(aiFieldData) && isExtractedArrayData(humanFieldData)) {
          // 配列フィールド（items構造）の比較
          aiFieldData.items.forEach((aiItem, index) => {
            const humanItem = humanFieldData.items[index];
            if (!humanItem) return;

            Object.entries(aiItem).forEach(([childKey, aiChildValue]) => {
              const humanChildValue = humanItem[childKey];
              const fullKey = `${key}[${index}].${childKey}`;
              compareAndAddCorrection(fullKey, aiChildValue, humanChildValue);
            });
          });
        } else if (Array.isArray(aiFieldData) && Array.isArray(humanFieldData)) {
          // 直接配列の比較
          const aiArr = aiFieldData as Array<{[k: string]: ExtractedValue}>;
          const humanArr = humanFieldData as Array<{[k: string]: ExtractedValue}>;

          aiArr.forEach((aiItem, index) => {
            const humanItem = humanArr[index];
            if (!humanItem) return;

            Object.entries(aiItem).forEach(([childKey, aiChildValue]) => {
              const humanChildValue = humanItem[childKey];
              const fullKey = `${key}[${index}].${childKey}`;
              compareAndAddCorrection(fullKey, aiChildValue, humanChildValue);
            });
          });
        }
      });

      // ocr_history を更新
      await updateDoc(historyRef, {
        humanConfirmedData: editedData,
        isHumanConfirmed: true,
        confirmedAt: Timestamp.now(),
      });

      // corrections をFirestoreに保存（差分がある場合のみ）
      if (corrections.length > 0) {
        const correctionsRef = collection(db, 'corrections');
        for (const correction of corrections) {
          await addDoc(correctionsRef, {
            ...correction,
            createdAt: Timestamp.now(),
          });
        }
        console.log(`${corrections.length}件の訂正ログを保存しました`);
      }

      // 状態を更新
      setHistory({
        ...history,
        humanConfirmedData: editedData,
        isHumanConfirmed: true,
      });
      setIsEditMode(false);
      setEditedData(null);

    } catch (err) {
      console.error('Error saving confirmed data:', err);
      setSaveError('データの保存に失敗しました。もう一度お試しください。');
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * コード提案を実行
   */
  const handleRequestCodeSuggestion = async () => {
    if (!history || !currentUser) return;

    setIsCodeSuggesting(true);
    setCodeSuggestionError(null);
    setShowCodeSuggestionModal(false);

    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`/api/documents/${historyId}/suggestCodes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ useRag: true }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'コード提案の実行に失敗しました');
      }

      const result = await response.json();

      // 状態を更新
      setHistory({
        ...history,
        codeSuggestions: result.suggestions,
        codeSuggestedAt: new Date(),
        isCodeSuggestionApproved: false,
      });

    } catch (err) {
      console.error('Error requesting code suggestion:', err);
      setCodeSuggestionError(err instanceof Error ? err.message : 'コード提案の実行に失敗しました');
    } finally {
      setIsCodeSuggesting(false);
    }
  };

  /**
   * コード提案を承認
   */
  const handleApproveCodeSuggestion = async () => {
    if (!history || !currentUser) return;

    setIsSaving(true);

    try {
      const historyRef = doc(db, 'ocr_history', historyId);
      await updateDoc(historyRef, {
        isCodeSuggestionApproved: true,
        codeSuggestionApprovedAt: Timestamp.now(),
      });

      setHistory({
        ...history,
        isCodeSuggestionApproved: true,
        codeSuggestionApprovedAt: new Date(),
      });

    } catch (err) {
      console.error('Error approving code suggestion:', err);
      setCodeSuggestionError('承認の保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * コード提案を却下（提案をクリア）
   */
  const handleRejectCodeSuggestion = async () => {
    if (!history || !currentUser) return;

    setIsSaving(true);

    try {
      const historyRef = doc(db, 'ocr_history', historyId);
      await updateDoc(historyRef, {
        codeSuggestions: null,
        codeSuggestedAt: null,
        isCodeSuggestionApproved: false,
        codeSuggestionApprovedAt: null,
      });

      setHistory({
        ...history,
        codeSuggestions: undefined,
        codeSuggestedAt: undefined,
        isCodeSuggestionApproved: false,
        codeSuggestionApprovedAt: undefined,
      });

    } catch (err) {
      console.error('Error rejecting code suggestion:', err);
      setCodeSuggestionError('却下の保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!historyId || !currentUser) return;

    const fetchHistoryDetail = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // 1. 履歴を取得
        const historyRef = doc(db, "ocr_history", historyId);
        const historySnap = await getDoc(historyRef);

        if (!historySnap.exists()) {
          setError("履歴が見つかりません。");
          setIsLoading(false);
          return;
        }

        const data = historySnap.data();

        // 2. この履歴の setting_id が、現在のユーザーが所有する設定かチェック
        if (!data.setting_id) {
          console.warn('No setting_id found in history data');
        }

        const settingRef = doc(db, "ocr_settings", data.setting_id);
        const settingSnap = await getDoc(settingRef);

        if (!settingSnap.exists()) {
          console.error('Setting not found for ID:', data.setting_id);
          setError("関連する設定が見つかりません。");
          setIsLoading(false);
          return;
        }

        const settingData = settingSnap.data();

        // 3. 権限チェック: 設定の owner_id が現在のユーザーと一致するか確認
        if (settingData.owner_id !== currentUser.uid) {
          setError("この履歴にアクセスする権限がありません。");
          setIsLoading(false);
          return;
        }

        // 3.5. 組織のRAG設定を取得
        let ragCodeSuggestionEnabled = true; // デフォルトは有効
        if (settingData.organization_id) {
          const orgRef = doc(db, 'organizations', settingData.organization_id);
          const orgSnap = await getDoc(orgRef);
          if (orgSnap.exists()) {
            const orgData = orgSnap.data();
            ragCodeSuggestionEnabled = orgData.ragCodeSuggestionEnabled !== false;
          }
        }

        // 4. 画像URLを取得（ファイルが存在しない場合は null）
        let downloadUrl: string | null = null;
        let convertedImageUrl: string | null = null;
        const convertedImageUrls: string[] = [];

        try {
          const imageRef = ref(storage, data.original_file_path);
          downloadUrl = await getDownloadURL(imageRef);
        } catch (storageError) {
          console.warn("元ファイルが見つかりません:", storageError);
          // ファイルが存在しない場合でも処理を続行
        }

        // 複数ページの変換された画像がある場合は取得
        if (data.converted_image_paths && Array.isArray(data.converted_image_paths)) {
          for (const imagePath of data.converted_image_paths) {
            try {
              const convertedRef = ref(storage, imagePath);
              const url = await getDownloadURL(convertedRef);
              convertedImageUrls.push(url);
            } catch (storageError) {
              console.warn(`変換された画像が見つかりません: ${imagePath}`, storageError);
            }
          }
          // 後方互換性のため1ページ目のURLも設定
          if (convertedImageUrls.length > 0) {
            convertedImageUrl = convertedImageUrls[0];
          }
        } else if (data.converted_image_path) {
          // 後方互換性: 旧フォーマット（単一パス）の場合
          try {
            const convertedRef = ref(storage, data.converted_image_path);
            convertedImageUrl = await getDownloadURL(convertedRef);
            convertedImageUrls.push(convertedImageUrl);
          } catch (storageError) {
            console.warn("変換された画像が見つかりません:", storageError);
          }
        }

        // 5. データをセット（extracted_data がない場合は空オブジェクト）
        let extractedData = data.extracted_data || {};

        // 配列の場合はオブジェクトに変換
        if (Array.isArray(extractedData)) {
          const convertedData: ExtractedData = {};
          extractedData.forEach((item: unknown) => {
            // 各配列要素はオブジェクト（例: {invoiceDate: {value: "...", bbox: [...]}}）
            if (item && typeof item === 'object') {
              Object.keys(item).forEach(key => {
                convertedData[key] = (item as Record<string, ExtractedValue | ExtractedArrayData>)[key];
              });
            }
          });
          extractedData = convertedData;
        }

        const historyDetail: HistoryDetail = {
          id: historySnap.id,
          status: data.status,
          original_file_path: data.original_file_path,
          converted_image_path: data.converted_image_path,
          converted_image_paths: data.converted_image_paths,
          page_count: data.page_count || (convertedImageUrls.length > 0 ? convertedImageUrls.length : undefined),
          extracted_data: extractedData,
          humanConfirmedData: data.humanConfirmedData || undefined,
          isHumanConfirmed: data.isHumanConfirmed || false,
          imageUrl: downloadUrl,
          convertedImageUrl: convertedImageUrl,
          convertedImageUrls: convertedImageUrls,
          setting_id: data.setting_id,
          setting: {
            name: settingData.name || '設定名なし',
            fields: settingData.extraction_fields || [],
            prompt: settingData.prompt_text,
            model: settingData.model_name,
          },
          // コード提案関連
          codeSuggestions: data.codeSuggestions || undefined,
          codeSuggestedAt: data.codeSuggestedAt?.toDate?.() || undefined,
          isCodeSuggestionApproved: data.isCodeSuggestionApproved || false,
          codeSuggestionApprovedAt: data.codeSuggestionApprovedAt?.toDate?.() || undefined,
          // 組織のRAG機能設定
          ragCodeSuggestionEnabled,
        };

        setHistory(historyDetail);

      } catch (err) {
        console.error("Error fetching history detail: ", err);
        setError("履歴の読み込みに失敗しました。");
      } finally {
        setIsLoading(false);
      }
    };

    fetchHistoryDetail();
  }, [historyId, currentUser]);

  // 配列フィールドをデフォルトで展開
  useEffect(() => {
    if (history && !initialExpansionDone && history.extracted_data) {
      const arrayFields = new Set<string>();

      Object.entries(history.extracted_data).forEach(([key, value]) => {
        // 配列が直接来ている場合もチェック
        if (Array.isArray(value) || isExtractedArrayData(value)) {
          arrayFields.add(key);
        }
      });

      if (arrayFields.size > 0) {
        setExpandedArrays(arrayFields);
        setInitialExpansionDone(true);
      }
    }
  }, [history, initialExpansionDone]);

  // ページが変わったときに画像寸法をリセット
  useEffect(() => {
    setImageDimensions(null);
  }, [currentPage]);

  // すべてのbboxを収集する関数（ネスト構造対応、ページフィルタリング対応）
  const collectAllBboxes = (data: ExtractedData, pageNumber?: number): Array<{
    key: string;
    value: string;
    bbox: [number, number, number, number];
  }> => {
    const bboxes: Array<{
      key: string;
      value: string;
      bbox: [number, number, number, number];
    }> = [];

    // bboxが有効かどうかをチェックするヘルパー関数
    const isValidBbox = (bbox: [number, number, number, number]) => {
      return !(bbox[0] === 0 && bbox[1] === 0 && bbox[2] === 0 && bbox[3] === 0);
    };

    // ページフィルタリングをチェックするヘルパー関数
    const matchesPage = (fieldPage?: number) => {
      // ページフィルタリングが指定されていない場合はすべて表示
      if (pageNumber === undefined) return true;
      // ページ情報がないフィールドは1ページ目として扱う
      if (fieldPage === undefined) return pageNumber === 1;
      return fieldPage === pageNumber;
    };

    Object.entries(data).forEach(([fieldName, fieldData]) => {
      if (isExtractedValue(fieldData)) {
        // 単一値フィールド
        if (fieldData.bbox && isValidBbox(fieldData.bbox) && matchesPage(fieldData.page)) {
          bboxes.push({
            key: fieldName,
            value: fieldData.value,
            bbox: fieldData.bbox,
          });
        }
      } else if (Array.isArray(fieldData)) {
        // 配列が直接来ている場合
        const arrayData = fieldData as Array<{[childFieldName: string]: ExtractedValue}>;
        arrayData.forEach((item, index) => {
          Object.entries(item).forEach(([childKey, childValue]) => {
            if (childValue && childValue.bbox && isValidBbox(childValue.bbox) && matchesPage(childValue.page)) {
              bboxes.push({
                key: `${fieldName}[${index}].${childKey}`,
                value: childValue.value,
                bbox: childValue.bbox,
              });
            }
          });
        });
      } else if (isExtractedArrayData(fieldData)) {
        // 配列フィールド（items構造の場合）
        fieldData.items.forEach((item, index) => {
          Object.entries(item).forEach(([childKey, childValue]) => {
            if (childValue && childValue.bbox && isValidBbox(childValue.bbox) && matchesPage(childValue.page)) {
              bboxes.push({
                key: `${fieldName}[${index}].${childKey}`,
                value: childValue.value,
                bbox: childValue.bbox,
              });
            }
          });
        });
      }
    });

    return bboxes;
  };

  const handleCsvDownload = (includeHeader: boolean) => {
    if (!history?.extracted_data) return;

    const data = history.extracted_data;

    // ヘッダーと行データを生成
    const headers: string[] = [];
    const rows: string[][] = [];

    // 単一値フィールドと配列フィールドを分離
    const singleFields: Array<[string, ExtractedValue]> = [];
    const arrayFields: Array<[string, Array<{[childFieldName: string]: ExtractedValue}> | ExtractedArrayData]> = [];

    Object.entries(data).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        // 配列が直接来ている場合
        arrayFields.push([key, value as Array<{[childFieldName: string]: ExtractedValue}>]);
      } else if (isExtractedArrayData(value)) {
        arrayFields.push([key, value]);
      } else if (isExtractedValue(value)) {
        singleFields.push([key, value]);
      }
    });

    // 配列フィールドがある場合: 親情報を繰り返し、配列を展開
    if (arrayFields.length > 0) {
      // ヘッダー生成: 単一値フィールド + 配列の子フィールド
      singleFields.forEach(([key]) => headers.push(key));

      // 配列フィールドごとのキーの順序を保持
      const arrayFieldKeys: Array<[string, string[]]> = [];

      arrayFields.forEach(([arrayKey, arrayData]) => {
        // 配列が直接来ている場合とitems構造の場合の両方に対応
        const items = Array.isArray(arrayData) ? arrayData : arrayData.items;
        if (items.length > 0) {
          const firstItem = items[0];
          const childKeys = Object.keys(firstItem);
          arrayFieldKeys.push([arrayKey, childKeys]);
          childKeys.forEach(childKey => {
            headers.push(`${arrayKey}.${childKey}`);
          });
        }
      });

      // 行データ生成: 配列の最大長分の行を生成
      const maxArrayLength = Math.max(...arrayFields.map(([, data]) => {
        return Array.isArray(data) ? data.length : data.items.length;
      }), 1);

      for (let i = 0; i < maxArrayLength; i++) {
        const row: string[] = [];

        // 単一値フィールドを追加（全行で同じ値）
        singleFields.forEach(([, value]) => {
          row.push(`"${value.value}"`);
        });

        // 配列フィールドの各項目を追加（ヘッダーと同じ順序で）
        arrayFields.forEach(([arrayKey, arrayData], arrayIndex) => {
          const items = Array.isArray(arrayData) ? arrayData : arrayData.items;
          const childKeys = arrayFieldKeys[arrayIndex][1];

          if (i < items.length) {
            const item = items[i];
            // ヘッダーと同じ順序でキーを使って値を取得
            childKeys.forEach(childKey => {
              const childValue = item[childKey];
              if (childValue) {
                row.push(`"${childValue.value}"`);
              } else {
                row.push('""');
              }
            });
          } else {
            // この配列にこのインデックスの項目がない場合は空文字
            childKeys.forEach(() => {
              row.push('""');
            });
          }
        });

        rows.push(row);
      }
    } else {
      // 配列フィールドがない場合: シンプルなフラット構造
      singleFields.forEach(([key]) => headers.push(key));

      const row: string[] = [];
      singleFields.forEach(([, value]) => {
        row.push(`"${value.value}"`);
      });
      rows.push(row);
    }

    // CSVコンテンツ生成
    let csvContent = "data:text/csv;charset=utf-8,";

    if (includeHeader) {
      csvContent += headers.join(",") + "\n";
    }

    rows.forEach(row => {
      csvContent += row.join(",") + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `extraction_${historyId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (isLoading) {
    return <p className="text-center text-gray-500">履歴を読み込み中...</p>;
  }
  if (error) {
    return <p className="text-center text-red-600">{error}</p>;
  }
  if (!history) {
    return null; 
  }

  // ステータスチップを取得
  const getStatusChip = (status: string) => {
    switch (status) {
      case 'completed':
        return <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800">完了</span>;
      case 'failed':
        return <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-800">失敗</span>;
      default:
        return <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-800">処理中</span>;
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            実行履歴詳細
          </h2>
          {history && getStatusChip(history.status)}
        </div>

        {/* --- ボタン群 --- */}
        {history && Object.keys(history.extracted_data).length > 0 && (
          <div className="flex space-x-2">
            {/* AI補正ボタン（既に提案がある場合のみ表示） */}
            {history.codeSuggestions && (
              <button
                onClick={() => setShowCodeSuggestionModal(true)}
                disabled={isCodeSuggesting}
                className="inline-flex items-center gap-2 rounded-lg bg-purple-600 py-2 px-4 font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {isCodeSuggesting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {isCodeSuggesting ? '補正中...' : 'AI補正'}
              </button>
            )}
            {/* CSVダウンロードボタン */}
            <button
              onClick={() => handleCsvDownload(true)}
              className="rounded-lg bg-green-800 py-2 px-4 font-semibold text-white hover:bg-green-700"
            >
              CSV (ヘッダーあり)
            </button>
            <button
              onClick={() => handleCsvDownload(false)}
              className="rounded-lg bg-gray-600 py-2 px-4 font-semibold text-white hover:bg-gray-500"
            >
              CSV (ヘッダーなし)
            </button>
          </div>
        )}
      </div>

      {/* AI補正モーダル */}
      {showCodeSuggestionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-6 h-6 text-purple-600" />
              <h3 className="text-lg font-semibold text-gray-900">AI補正</h3>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              ナレッジを参照して、顧客コード、品目コード、勘定科目などを再度補正します。
            </p>

            {/* 注意事項 */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4 flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-yellow-800">
                現在の補正内容は上書きされます。補正内容は参考情報ですので、必ず内容を確認してください。
              </p>
            </div>

            {/* ボタン */}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCodeSuggestionModal(false)}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 font-medium"
              >
                キャンセル
              </button>
              <button
                onClick={handleRequestCodeSuggestion}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium inline-flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                補正を実行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* コード提案エラー表示 */}
      {codeSuggestionError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {codeSuggestionError}
          <button
            onClick={() => setCodeSuggestionError(null)}
            className="ml-auto text-red-500 hover:text-red-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* --- 1. 元画像/PDFとハイライト表示 --- */}
        <div className="border border-gray-300 rounded-lg overflow-hidden bg-gray-50">
          {/* 変換された画像または元画像を表示 */}
          {(history.convertedImageUrls.length > 0 || history.imageUrl) ? (
            <div>
              {/* ページナビゲーション（複数ページの場合） */}
              {history.convertedImageUrls.length > 1 && (
                <div className="bg-gray-100 border-b border-gray-200 px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 rounded bg-white border border-gray-300 text-sm font-medium text-black disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                    >
                      前へ
                    </button>
                    <span className="text-sm font-medium text-black">
                      {currentPage} / {history.convertedImageUrls.length} ページ
                    </span>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(history.convertedImageUrls.length, prev + 1))}
                      disabled={currentPage === history.convertedImageUrls.length}
                      className="px-3 py-1 rounded bg-white border border-gray-300 text-sm font-medium text-black disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                    >
                      次へ
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor="page-select" className="text-sm text-black">ページ:</label>
                    <select
                      id="page-select"
                      value={currentPage}
                      onChange={(e) => setCurrentPage(Number(e.target.value))}
                      className="px-2 py-1 rounded border border-gray-300 text-sm text-black"
                    >
                      {Array.from({ length: history.convertedImageUrls.length }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* ズーム操作説明とハイライトON/OFF */}
              <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center justify-between">
                <span className="text-sm text-blue-800">
                  マウスホイールでズーム、ドラッグで移動できます
                </span>
                <button
                  onClick={() => setShowBboxHighlight(prev => !prev)}
                  className={`px-3 py-1 rounded text-sm font-medium border ${
                    showBboxHighlight
                      ? 'bg-green-100 border-green-300 text-green-800 hover:bg-green-200'
                      : 'bg-gray-100 border-gray-300 text-gray-800 hover:bg-gray-200'
                  }`}
                >
                  {showBboxHighlight ? 'ハイライト ON' : 'ハイライト OFF'}
                </button>
              </div>

              <div className="relative">
                <TransformWrapper
                  initialScale={1}
                  minScale={0.5}
                  maxScale={4}
                  centerOnInit={true}
                >
                  {({ zoomIn, zoomOut, resetTransform }) => (
                    <>
                      {/* ズームコントロールボタン */}
                      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
                        <button
                          onClick={() => zoomIn()}
                          className="bg-white border border-gray-300 rounded-lg p-2 shadow-md hover:bg-gray-100"
                          title="拡大"
                        >
                          <svg className="w-5 h-5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        </button>
                        <button
                          onClick={() => zoomOut()}
                          className="bg-white border border-gray-300 rounded-lg p-2 shadow-md hover:bg-gray-100"
                          title="縮小"
                        >
                          <svg className="w-5 h-5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                          </svg>
                        </button>
                        <button
                          onClick={() => resetTransform()}
                          className="bg-white border border-gray-300 rounded-lg p-2 shadow-md hover:bg-gray-100"
                          title="リセット"
                        >
                          <svg className="w-5 h-5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </button>
                      </div>

                      <TransformComponent
                      wrapperStyle={{
                        width: '100%',
                        height: 'calc(100vh - 250px)',
                        cursor: 'grab'
                      }}
                      contentStyle={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <div className="relative inline-block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          ref={imageRef}
                          src={
                            history.convertedImageUrls.length > 0
                              ? history.convertedImageUrls[currentPage - 1]
                              : history.imageUrl!
                          }
                          alt={`Document Page ${currentPage}`}
                          className="max-h-[calc(100vh-250px)] w-auto h-auto"
                          onLoad={(e) => {
                            const img = e.target as HTMLImageElement;
                            setImageDimensions({
                              width: img.naturalWidth,
                              height: img.naturalHeight,
                            });
                          }}
                        />

                        {/* --- ハイライトボックス（BBox） - ネスト構造対応 --- */}
                        {imageDimensions && showBboxHighlight && (() => {
                          // 複数ページの場合はcurrentPageでフィルタリング
                          const pageFilter = history.convertedImageUrls.length > 1 ? currentPage : undefined;
                          const allBboxes = collectAllBboxes(history.extracted_data, pageFilter);

                          // BBOXがない場合は何も表示しない
                          if (allBboxes.length === 0) {
                            return null;
                          }

                          // 全てのbboxから最大座標値を取得してスケールを判定
                          const globalMaxCoord = Math.max(
                            ...allBboxes.flatMap(({ bbox }) => bbox)
                          );

                          return allBboxes.map(({ key, value, bbox }) => {
                            // bbox座標を取得
                            const [x1, y1, x2, y2] = bbox;

                            let normalizedX1, normalizedY1, normalizedX2, normalizedY2;

                            // スケール判定: 画像サイズの80%以上ならピクセル座標
                            const maxImageDimension = Math.max(imageDimensions.width, imageDimensions.height);

                            if (globalMaxCoord <= 1) {
                              // 0-1の正規化座標
                              normalizedX1 = x1;
                              normalizedY1 = y1;
                              normalizedX2 = x2;
                              normalizedY2 = y2;
                            } else if (globalMaxCoord > maxImageDimension * 0.8) {
                              // ピクセル座標: 最大値が画像サイズの80%以上の場合
                              normalizedX1 = x1 / imageDimensions.width;
                              normalizedY1 = y1 / imageDimensions.height;
                              normalizedX2 = x2 / imageDimensions.width;
                              normalizedY2 = y2 / imageDimensions.height;
                            } else {
                              // 0-1000スケール（Gemini APIのデフォルト）
                              normalizedX1 = x1 / 1000;
                              normalizedY1 = y1 / 1000;
                              normalizedX2 = x2 / 1000;
                              normalizedY2 = y2 / 1000;
                            }

                            // パーセンテージで座標を設定（ズームに追従する）
                            const left = (normalizedX1 * 100).toFixed(2);
                            const top = (normalizedY1 * 100).toFixed(2);
                            const width = ((normalizedX2 - normalizedX1) * 100).toFixed(2);
                            const height = ((normalizedY2 - normalizedY1) * 100).toFixed(2);

                            const isSelected = selectedField === key;

                            return (
                              <div
                                key={key}
                                title={`${key}: ${value}`}
                                className={`absolute border-2 transition-all ${
                                  isSelected
                                    ? 'border-blue-600 bg-blue-600 bg-opacity-30 opacity-100 z-10'
                                    : 'border-green-600 bg-green-600 bg-opacity-10 opacity-70 hover:opacity-100'
                                }`}
                                style={{
                                  left: `${left}%`,
                                  top: `${top}%`,
                                  width: `${width}%`,
                                  height: `${height}%`,
                                  pointerEvents: 'none'
                                }}
                              >
                                <span className={`absolute -top-5 left-0 text-xs px-1 rounded whitespace-nowrap ${
                                  isSelected
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-green-600 text-white'
                                }`}>
                                  {key}
                                </span>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </TransformComponent>
                  </>
                )}
              </TransformWrapper>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center bg-gray-100 p-12 min-h-[300px]">
              <div className="text-center text-gray-500">
                <svg
                  className="mx-auto h-12 w-12 mb-4 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <p className="font-medium">画像ファイルが見つかりません</p>
                <p className="text-sm mt-1">ファイル: {history.original_file_path}</p>
              </div>
            </div>
          )}
        </div>


        {/* --- 2. 抽出結果テーブル --- */}
        <div>
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-semibold text-gray-900">抽出結果</h3>
              {history.isHumanConfirmed && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                  <CheckCircle className="w-3 h-3" />
                  確定済み
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!isEditMode ? (
                <button
                  onClick={() => {
                    // 編集開始時に現在のデータ（人間確定データがあればそれ、なければAI抽出データ）をコピー
                    const baseData = history.humanConfirmedData || history.extracted_data;
                    setEditedData(JSON.parse(JSON.stringify(baseData)));
                    setIsEditMode(true);
                    setSaveError(null);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                >
                  <Edit3 className="w-4 h-4" />
                  編集
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setIsEditMode(false);
                      setEditedData(null);
                      setSaveError(null);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm font-medium"
                    disabled={isSaving}
                  >
                    <X className="w-4 h-4" />
                    キャンセル
                  </button>
                  <button
                    onClick={handleSaveConfirmedData}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isSaving}
                  >
                    <Save className="w-4 h-4" />
                    {isSaving ? '保存中...' : '確定保存'}
                  </button>
                </>
              )}
            </div>
          </div>
          {saveError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {saveError}
            </div>
          )}
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            {Object.keys(history.extracted_data).length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                {history.status === 'processing' && (
                  <p>OCR処理中です。しばらくお待ちください。</p>
                )}
                {history.status === 'failed' && (
                  <p className="text-red-600">OCR処理が失敗しました。</p>
                )}
                {history.status === 'completed' && (
                  <p>抽出データがありません。</p>
                )}
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="p-3 text-left text-sm font-semibold text-gray-600">項目名</th>
                    <th className="p-3 text-left text-sm font-semibold text-gray-600">タイプ</th>
                    <th className="p-3 text-left text-sm font-semibold text-gray-600">信頼度</th>
                    <th className="p-3 text-left text-sm font-semibold text-gray-600">
                      {isEditMode ? '編集値' : (history.isHumanConfirmed ? '確定値' : 'AI抽出値')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(history.extracted_data).map(([key, fieldData]) => {
                    // 配列が直接来ている場合の処理
                    if (Array.isArray(fieldData)) {
                      const isExpanded = expandedArrays.has(key);
                      const arrayData = fieldData as Array<{[childFieldName: string]: ExtractedValue}>;

                      return (
                        <React.Fragment key={key}>
                          {/* 親行 */}
                          <tr className="border-b bg-green-50 hover:bg-green-100 cursor-pointer">
                            <td className="p-3 text-sm font-medium text-gray-800">
                              <div className="flex items-center gap-2" onClick={() => toggleArrayExpansion(key)}>
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-gray-600" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-gray-600" />
                                )}
                                <span>{key}</span>
                              </div>
                            </td>
                            <td className="p-3 text-sm text-gray-500">
                              <span className="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium bg-green-100 text-green-800">
                                配列 ({arrayData.length}件)
                              </span>
                            </td>
                            <td className="p-3 text-sm text-gray-500">-</td>
                            <td className="p-3 text-sm text-gray-500 italic">
                              {isExpanded ? '展開中' : 'クリックで展開'}
                            </td>
                          </tr>

                          {/* 子行（展開時） */}
                          {isExpanded && arrayData.map((item, index) => (
                            <React.Fragment key={`${key}-${index}`}>
                              {/* 配列項目のヘッダー行 */}
                              <tr className="border-b bg-gray-100">
                                <td colSpan={4} className="p-2 pl-8 text-xs font-semibold text-gray-700">
                                  {key}[{index}]
                                </td>
                              </tr>

                              {/* 配列項目の子フィールド */}
                              {Object.entries(item).map(([childKey, childValue]) => {
                                if (!childValue) return null; // Skip null values
                                const fullKey = `${key}[${index}].${childKey}`;
                                const childConfidenceStyle = getConfidenceStyle(childValue.confidence);

                                // 人間確定データから子の値を取得（直接配列の場合）
                                const getHumanConfirmedChildValueDirect = () => {
                                  if (!history.humanConfirmedData) return null;
                                  const parentData = history.humanConfirmedData[key];
                                  if (!Array.isArray(parentData)) return null;
                                  const itemData = (parentData as Array<{[k: string]: ExtractedValue}>)[index];
                                  if (!itemData) return null;
                                  return itemData[childKey]?.value;
                                };
                                const displayChildValue = getHumanConfirmedChildValueDirect() || childValue.value;

                                return (
                                  <tr
                                    key={fullKey}
                                    className={`border-b hover:bg-blue-50 cursor-pointer transition-colors ${
                                      selectedField === fullKey ? 'bg-blue-100' : childConfidenceStyle.bgColor
                                    }`}
                                    onClick={() => setSelectedField(fullKey)}
                                  >
                                    <td className="p-3 pl-12 text-sm text-gray-700">
                                      <span className="flex items-center gap-2">
                                        <span className="text-gray-400">└</span>
                                        {childKey}
                                      </span>
                                    </td>
                                    <td className="p-3 text-sm text-gray-500">
                                      <span className="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800">
                                        子フィールド
                                      </span>
                                    </td>
                                    <td className="p-3">
                                      <ConfidenceBadge confidence={childValue.confidence} />
                                    </td>
                                    <td className="p-3 text-sm text-gray-600 font-mono">
                                      {isEditMode ? (
                                        <input
                                          type="text"
                                          value={(() => {
                                            if (!editedData) return displayChildValue;
                                            const parentData = editedData[key];
                                            if (!Array.isArray(parentData)) return displayChildValue;
                                            const itemData = (parentData as Array<{[k: string]: ExtractedValue}>)[index];
                                            return itemData?.[childKey]?.value || displayChildValue;
                                          })()}
                                          onChange={(e) => {
                                            if (!editedData) return;
                                            const newData = JSON.parse(JSON.stringify(editedData)) as ExtractedData;
                                            const parentData = newData[key];
                                            if (Array.isArray(parentData)) {
                                              const arr = parentData as Array<{[k: string]: ExtractedValue}>;
                                              if (arr[index]) {
                                                arr[index][childKey] = {
                                                  ...childValue,
                                                  value: e.target.value,
                                                };
                                              }
                                            }
                                            setEditedData(newData);
                                          }}
                                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                      ) : (
                                        displayChildValue
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </React.Fragment>
                          ))}
                        </React.Fragment>
                      );
                    }

                    if (isExtractedValue(fieldData)) {
                      // 単一値フィールド
                      const displayValue = history.humanConfirmedData && isExtractedValue(history.humanConfirmedData[key])
                        ? (history.humanConfirmedData[key] as ExtractedValue).value
                        : fieldData.value;
                      const confidenceStyle = getConfidenceStyle(fieldData.confidence);

                      return (
                        <tr
                          key={key}
                          className={`border-b hover:bg-blue-50 cursor-pointer transition-colors ${
                            selectedField === key ? 'bg-blue-100' : ''
                          } ${confidenceStyle.bgColor}`}
                          onClick={() => setSelectedField(key)}
                        >
                          <td className="p-3 text-sm font-medium text-gray-800">{key}</td>
                          <td className="p-3 text-sm text-gray-500">
                            <span className="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800">
                              単一値
                            </span>
                          </td>
                          <td className="p-3">
                            <ConfidenceBadge confidence={fieldData.confidence} />
                          </td>
                          <td className="p-3 text-sm text-gray-600 font-mono">
                            {isEditMode ? (
                              <input
                                type="text"
                                value={(editedData && isExtractedValue(editedData[key])) ? (editedData[key] as ExtractedValue).value : displayValue}
                                onChange={(e) => {
                                  if (!editedData) return;
                                  const newData = { ...editedData };
                                  if (isExtractedValue(newData[key])) {
                                    (newData[key] as ExtractedValue).value = e.target.value;
                                  } else {
                                    newData[key] = { ...fieldData, value: e.target.value };
                                  }
                                  setEditedData(newData);
                                }}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            ) : (
                              displayValue
                            )}
                          </td>
                        </tr>
                      );
                    } else if (isExtractedArrayData(fieldData)) {
                      // 配列フィールド
                      const isExpanded = expandedArrays.has(key);

                      return (
                        <React.Fragment key={key}>
                          {/* 親行 */}
                          <tr className="border-b bg-green-50 hover:bg-green-100 cursor-pointer">
                            <td className="p-3 text-sm font-medium text-gray-800">
                              <div className="flex items-center gap-2" onClick={() => toggleArrayExpansion(key)}>
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-gray-600" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-gray-600" />
                                )}
                                <span>{key}</span>
                              </div>
                            </td>
                            <td className="p-3 text-sm text-gray-500">
                              <span className="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium bg-green-100 text-green-800">
                                配列 ({fieldData.items.length}件)
                              </span>
                            </td>
                            <td className="p-3 text-sm text-gray-500">-</td>
                            <td className="p-3 text-sm text-gray-500 italic">
                              {isExpanded ? '展開中' : 'クリックで展開'}
                            </td>
                          </tr>

                          {/* 子行（展開時） */}
                          {isExpanded && fieldData.items.map((item, index) => (
                            <React.Fragment key={`${key}-${index}`}>
                              {/* 配列項目のヘッダー行 */}
                              <tr className="border-b bg-gray-100">
                                <td colSpan={4} className="p-2 pl-8 text-xs font-semibold text-gray-700">
                                  {key}[{index}]
                                </td>
                              </tr>

                              {/* 配列項目の子フィールド */}
                              {Object.entries(item).map(([childKey, childValue]) => {
                                if (!childValue) return null; // Skip null values
                                const fullKey = `${key}[${index}].${childKey}`;
                                const childConfidenceStyle = getConfidenceStyle(childValue.confidence);

                                // 人間確定データから子の値を取得
                                const getHumanConfirmedChildValue = () => {
                                  if (!history.humanConfirmedData) return null;
                                  const parentData = history.humanConfirmedData[key];
                                  if (!isExtractedArrayData(parentData)) return null;
                                  const itemData = parentData.items[index];
                                  if (!itemData) return null;
                                  return itemData[childKey]?.value;
                                };
                                const displayChildValue = getHumanConfirmedChildValue() || childValue.value;

                                return (
                                  <tr
                                    key={fullKey}
                                    className={`border-b hover:bg-blue-50 cursor-pointer transition-colors ${
                                      selectedField === fullKey ? 'bg-blue-100' : childConfidenceStyle.bgColor
                                    }`}
                                    onClick={() => setSelectedField(fullKey)}
                                  >
                                    <td className="p-3 pl-12 text-sm text-gray-700">
                                      <span className="flex items-center gap-2">
                                        <span className="text-gray-400">└</span>
                                        {childKey}
                                      </span>
                                    </td>
                                    <td className="p-3 text-sm text-gray-500">
                                      <span className="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800">
                                        子フィールド
                                      </span>
                                    </td>
                                    <td className="p-3">
                                      <ConfidenceBadge confidence={childValue.confidence} />
                                    </td>
                                    <td className="p-3 text-sm text-gray-600 font-mono">
                                      {isEditMode ? (
                                        <input
                                          type="text"
                                          value={(() => {
                                            if (!editedData) return displayChildValue;
                                            const parentData = editedData[key];
                                            if (!isExtractedArrayData(parentData)) return displayChildValue;
                                            return parentData.items[index]?.[childKey]?.value || displayChildValue;
                                          })()}
                                          onChange={(e) => {
                                            if (!editedData) return;
                                            const newData = JSON.parse(JSON.stringify(editedData)) as ExtractedData;
                                            const parentData = newData[key];
                                            if (isExtractedArrayData(parentData) && parentData.items[index]) {
                                              parentData.items[index][childKey] = {
                                                ...childValue,
                                                value: e.target.value,
                                              };
                                            }
                                            setEditedData(newData);
                                          }}
                                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                      ) : (
                                        displayChildValue
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </React.Fragment>
                          ))}
                        </React.Fragment>
                      );
                    }

                    return null;
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* --- OCR設定情報 --- */}
          {history.setting && (
            <div className="mt-6">
              <div className="rounded-lg border border-gray-200 bg-white shadow-sm p-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">OCR設定</h3>
                  <Link
                    href={`/dashboard/settings/edit/${history.setting_id}`}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium inline-block"
                  >
                    設定を編集
                  </Link>
                </div>

                {history.setting.model && (
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">モデル</h4>
                    <p className="text-sm text-gray-900">{history.setting.model}</p>
                  </div>
                )}

                {history.setting.prompt && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">抽出指示</h4>
                    <div className="bg-gray-50 rounded p-3 text-sm text-gray-900 whitespace-pre-wrap font-mono">
                      {history.setting.prompt}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* --- コード提案パネル --- */}
          {history.codeSuggestions && (
            <CodeSuggestionsPanel
              suggestions={history.codeSuggestions}
              onApprove={handleApproveCodeSuggestion}
              onReject={handleRejectCodeSuggestion}
              isApproved={history.isCodeSuggestionApproved}
              isSaving={isSaving}
            />
          )}
        </div>

      </div>
    </div>
  );
}
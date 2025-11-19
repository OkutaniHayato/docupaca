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
} from '@/types/ocr';

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
  converted_image_path?: string; // PDF→画像変換後のパス
  extracted_data: ExtractedData;
  imageUrl: string | null;
  convertedImageUrl: string | null; // 変換された画像のURL
  setting?: OcrSetting; // OCR設定情報
  setting_id?: string; // OCR設定ID
}

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
  const imageRef = useRef<HTMLImageElement>(null);
  const params = useParams();
  const { currentUser } = useAuth();

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
        console.log('History data:', data);
        console.log('Setting ID:', data.setting_id);

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
        console.log('Setting data:', settingData);

        // 3. 権限チェック: 設定の owner_id が現在のユーザーと一致するか確認
        if (settingData.owner_id !== currentUser.uid) {
          setError("この履歴にアクセスする権限がありません。");
          setIsLoading(false);
          return;
        }

        // 4. 画像URLを取得（ファイルが存在しない場合は null）
        let downloadUrl: string | null = null;
        let convertedImageUrl: string | null = null;

        try {
          const imageRef = ref(storage, data.original_file_path);
          downloadUrl = await getDownloadURL(imageRef);
        } catch (storageError) {
          console.warn("元ファイルが見つかりません:", storageError);
          // ファイルが存在しない場合でも処理を続行
        }

        // 変換された画像がある場合は取得
        if (data.converted_image_path) {
          try {
            const convertedRef = ref(storage, data.converted_image_path);
            convertedImageUrl = await getDownloadURL(convertedRef);
          } catch (storageError) {
            console.warn("変換された画像が見つかりません:", storageError);
          }
        }

        // 5. データをセット（extracted_data がない場合は空オブジェクト）
        let extractedData = data.extracted_data || {};

        // デバッグ用：extracted_dataの構造をコンソールに出力
        console.log('extracted_data (raw):', extractedData);
        console.log('extracted_data type:', Array.isArray(extractedData) ? 'Array' : 'Object');

        // 配列の場合はオブジェクトに変換
        if (Array.isArray(extractedData)) {
          console.log('Converting array to object...');
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
          console.log('Converted extracted_data:', extractedData);
        }

        console.log('extracted_data keys:', Object.keys(extractedData));

        const historyDetail: HistoryDetail = {
          id: historySnap.id,
          status: data.status,
          original_file_path: data.original_file_path,
          converted_image_path: data.converted_image_path,
          extracted_data: extractedData,
          imageUrl: downloadUrl,
          convertedImageUrl: convertedImageUrl,
          setting_id: data.setting_id,
          setting: {
            name: settingData.name || '設定名なし',
            fields: settingData.extraction_fields || [],
            prompt: settingData.prompt_text,
            model: settingData.model_name,
          },
        };

        console.log('Final history detail:', historyDetail);
        console.log('Setting info:', historyDetail.setting);

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
        if (isExtractedArrayData(value)) {
          arrayFields.add(key);
        }
      });

      if (arrayFields.size > 0) {
        setExpandedArrays(arrayFields);
        setInitialExpansionDone(true);
      }
    }
  }, [history, initialExpansionDone]);

  // すべてのbboxを収集する関数（ネスト構造対応）
  const collectAllBboxes = (data: ExtractedData): Array<{
    key: string;
    value: string;
    bbox: [number, number, number, number];
  }> => {
    const bboxes: Array<{
      key: string;
      value: string;
      bbox: [number, number, number, number];
    }> = [];

    Object.entries(data).forEach(([fieldName, fieldData]) => {
      if (isExtractedValue(fieldData)) {
        // 単一値フィールド
        if (fieldData.bbox && !(fieldData.bbox[0] === 0 && fieldData.bbox[1] === 0 && fieldData.bbox[2] === 0 && fieldData.bbox[3] === 0)) {
          bboxes.push({
            key: fieldName,
            value: fieldData.value,
            bbox: fieldData.bbox,
          });
        }
      } else if (isExtractedArrayData(fieldData)) {
        // 配列フィールド
        fieldData.items.forEach((item, index) => {
          Object.entries(item).forEach(([childKey, childValue]) => {
            if (childValue.bbox && !(childValue.bbox[0] === 0 && childValue.bbox[1] === 0 && childValue.bbox[2] === 0 && childValue.bbox[3] === 0)) {
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
    const arrayFields: Array<[string, ExtractedArrayData]> = [];

    Object.entries(data).forEach(([key, value]) => {
      if (isExtractedArrayData(value)) {
        arrayFields.push([key, value]);
      } else if (isExtractedValue(value)) {
        singleFields.push([key, value]);
      }
    });

    // 配列フィールドがある場合: 親情報を繰り返し、配列を展開
    if (arrayFields.length > 0) {
      // ヘッダー生成: 単一値フィールド + 配列の子フィールド
      singleFields.forEach(([key]) => headers.push(key));

      arrayFields.forEach(([arrayKey, arrayData]) => {
        if (arrayData.items.length > 0) {
          const firstItem = arrayData.items[0];
          Object.keys(firstItem).forEach(childKey => {
            headers.push(`${arrayKey}.${childKey}`);
          });
        }
      });

      // 行データ生成: 配列の最大長分の行を生成
      const maxArrayLength = Math.max(...arrayFields.map(([, data]) => data.items.length), 1);

      for (let i = 0; i < maxArrayLength; i++) {
        const row: string[] = [];

        // 単一値フィールドを追加（全行で同じ値）
        singleFields.forEach(([, value]) => {
          row.push(`"${value.value}"`);
        });

        // 配列フィールドの各項目を追加
        arrayFields.forEach(([, arrayData]) => {
          if (i < arrayData.items.length) {
            const item = arrayData.items[i];
            Object.values(item).forEach((childValue) => {
              row.push(`"${childValue.value}"`);
            });
          } else {
            // この配列にこのインデックスの項目がない場合は空文字
            const firstItem = arrayData.items[0] || {};
            const childFieldCount = Object.keys(firstItem).length;
            for (let j = 0; j < childFieldCount; j++) {
              row.push('""');
            }
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

        {/* --- CSVダウンロードボタン --- */}
        {history && Object.keys(history.extracted_data).length > 0 && (
          <div className="flex space-x-2">
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* --- 1. 元画像/PDFとハイライト表示 --- */}
        <div className="border border-gray-300 rounded-lg overflow-hidden bg-gray-50">
          {/* 変換された画像または元画像を表示 */}
          {history.convertedImageUrl || history.imageUrl ? (
            <div>
              {/* ズーム操作説明 */}
              <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 text-sm text-blue-800">
                マウスホイールでズーム、ドラッグで移動できます
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
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        </button>
                        <button
                          onClick={() => zoomOut()}
                          className="bg-white border border-gray-300 rounded-lg p-2 shadow-md hover:bg-gray-100"
                          title="縮小"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                          </svg>
                        </button>
                        <button
                          onClick={() => resetTransform()}
                          className="bg-white border border-gray-300 rounded-lg p-2 shadow-md hover:bg-gray-100"
                          title="リセット"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                          src={history.convertedImageUrl || history.imageUrl!}
                          alt="Original Document"
                          className="max-h-[calc(100vh-250px)] w-auto h-auto"
                          onLoad={(e) => {
                            const img = e.target as HTMLImageElement;
                            console.log('Image loaded:', {
                              naturalWidth: img.naturalWidth,
                              naturalHeight: img.naturalHeight,
                              displayWidth: img.width,
                              displayHeight: img.height,
                              clientWidth: img.clientWidth,
                              clientHeight: img.clientHeight
                            });
                            setImageDimensions({
                              width: img.naturalWidth,
                              height: img.naturalHeight,
                            });
                          }}
                        />

                        {/* --- ハイライトボックス（BBox） - ネスト構造対応 --- */}
                        {imageDimensions && collectAllBboxes(history.extracted_data).map(({ key, value, bbox }) => {
                          // bbox座標を取得
                          let [x1, y1, x2, y2] = bbox;

                          // bbox座標が正規化されているか確認（0-1の範囲）
                          const isNormalized = x1 <= 1 && y1 <= 1 && x2 <= 1 && y2 <= 1;

                          // ピクセル座標の場合は正規化する
                          if (!isNormalized) {
                            x1 = x1 / imageDimensions.width;
                            y1 = y1 / imageDimensions.height;
                            x2 = x2 / imageDimensions.width;
                            y2 = y2 / imageDimensions.height;
                          }

                          // パーセンテージで座標を設定（ズームに追従する）
                          const left = (x1 * 100).toFixed(2);
                          const top = (y1 * 100).toFixed(2);
                          const width = ((x2 - x1) * 100).toFixed(2);
                          const height = ((y2 - y1) * 100).toFixed(2);

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
                        })}
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
          <h3 className="text-lg font-semibold mb-4 text-gray-900">抽出結果</h3>
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
                    <th className="p-3 text-left text-sm font-semibold text-gray-600">抽出された値</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(history.extracted_data).map(([key, fieldData]) => {
                    // デバッグ: データ構造を確認
                    console.log(`Field: ${key}`, fieldData);
                    console.log(`Is ExtractedValue:`, isExtractedValue(fieldData));
                    console.log(`Is ExtractedArrayData:`, isExtractedArrayData(fieldData));

                    if (isExtractedValue(fieldData)) {
                      // 単一値フィールド
                      return (
                        <tr
                          key={key}
                          className={`border-b hover:bg-blue-50 cursor-pointer transition-colors ${
                            selectedField === key ? 'bg-blue-100' : ''
                          }`}
                          onClick={() => setSelectedField(key)}
                        >
                          <td className="p-3 text-sm font-medium text-gray-800">{key}</td>
                          <td className="p-3 text-sm text-gray-500">
                            <span className="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800">
                              単一値
                            </span>
                          </td>
                          <td className="p-3 text-sm text-gray-600 font-mono">
                            {fieldData.value}
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
                            <td className="p-3 text-sm text-gray-500 italic">
                              {isExpanded ? '展開中' : 'クリックで展開'}
                            </td>
                          </tr>

                          {/* 子行（展開時） */}
                          {isExpanded && fieldData.items.map((item, index) => (
                            <React.Fragment key={`${key}-${index}`}>
                              {/* 配列項目のヘッダー行 */}
                              <tr className="border-b bg-gray-100">
                                <td colSpan={3} className="p-2 pl-8 text-xs font-semibold text-gray-700">
                                  {key}[{index}]
                                </td>
                              </tr>

                              {/* 配列項目の子フィールド */}
                              {Object.entries(item).map(([childKey, childValue]) => {
                                const fullKey = `${key}[${index}].${childKey}`;
                                return (
                                  <tr
                                    key={fullKey}
                                    className={`border-b hover:bg-blue-50 cursor-pointer transition-colors ${
                                      selectedField === fullKey ? 'bg-blue-100' : 'bg-gray-50'
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
                                    <td className="p-3 text-sm text-gray-600 font-mono">
                                      {childValue.value}
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
          {(() => {
            console.log('Rendering OCR settings section');
            console.log('history:', history);
            console.log('history.setting:', history?.setting);
            console.log('history.setting_id:', history?.setting_id);
            return null;
          })()}
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
        </div>

      </div>
    </div>
  );
}
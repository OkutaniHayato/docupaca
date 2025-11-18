/**
 * OCR機能のための型定義
 * フロントエンドとバックエンド（Cloud Functions）で共通利用
 */

/**
 * 抽出フィールドの定義
 * - single: 単一値フィールド（例: 請求書番号、発行日）
 * - array: 繰り返し構造フィールド（例: 明細行、商品リスト）
 */
export interface ExtractionField {
  /** フィールド名（英数字、キャメルケース） */
  name: string;

  /** 抽出指示（日本語可） */
  instruction: string;

  /** フィールドタイプ */
  type: 'single' | 'array';

  /** 子フィールド（type='array'の場合のみ使用） */
  children?: ExtractionField[];
}

/**
 * バウンディングボックス座標
 * [x_min, y_min, x_max, y_max]
 * 正規化座標（0-1）またはピクセル座標
 */
export type BBox = [number, number, number, number];

/**
 * 抽出された単一値
 */
export interface ExtractedValue {
  /** 抽出された値（文字列） */
  value: string;

  /** バウンディングボックス座標 */
  bbox: BBox;
}

/**
 * 抽出された配列データ
 */
export interface ExtractedArrayData {
  /** 配列項目のリスト */
  items: Array<{
    [childFieldName: string]: ExtractedValue;
  }>;

  /** 配列全体のバウンディングボックス（オプション） */
  bbox?: BBox;
}

/**
 * 抽出データ全体
 * フィールド名をキーとし、単一値または配列データを保持
 */
export type ExtractedData = {
  [fieldName: string]: ExtractedValue | ExtractedArrayData;
};

/**
 * OCR設定（Firestoreドキュメント）
 */
export interface OcrSetting {
  /** 設定名 */
  name: string;

  /** 所有者UID */
  owner_id: string;

  /** プロンプトテキスト */
  prompt_text: string;

  /** 抽出フィールド定義 */
  extraction_fields: ExtractionField[];

  /** 使用するAIモデル名 */
  model_name: string;

  /** 作成日時 */
  created_at: any; // Firestore Timestamp

  /** サンプルファイルパス（Cloud Storage） */
  sample_file_path?: string;
}

/**
 * OCR実行履歴（Firestoreドキュメント）
 */
export interface OcrHistory {
  /** OCR設定ID（参照） */
  setting_id: string;

  /** 処理ステータス */
  status: 'processing' | 'completed' | 'failed';

  /** 元ファイルパス（Cloud Storage） */
  original_file_path: string;

  /** 変換後画像パス（PDFの場合） */
  converted_image_path?: string;

  /** 抽出データ */
  extracted_data?: ExtractedData;

  /** エラーメッセージ */
  error_message?: string;

  /** 実行日時 */
  executed_at: any; // Firestore Timestamp
}

/**
 * 型ガード: ExtractedArrayDataかどうかを判定
 */
export function isExtractedArrayData(data: ExtractedValue | ExtractedArrayData): data is ExtractedArrayData {
  return 'items' in data && Array.isArray(data.items);
}

/**
 * 型ガード: ExtractedValueかどうかを判定
 */
export function isExtractedValue(data: ExtractedValue | ExtractedArrayData): data is ExtractedValue {
  return 'value' in data && typeof data.value === 'string';
}

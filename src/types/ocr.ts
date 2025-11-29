/**
 * OCR機能のための型定義
 * フロントエンドとバックエンド（Cloud Functions）で共通利用
 */

/**
 * 組織（取引先・会社）
 * OCR設定をグルーピングするためのマスタ
 */
export interface Organization {
  /** 組織名（会社名） */
  name: string;

  /** 説明（オプション） */
  description?: string;

  /** 所有者UID */
  owner_id: string;

  /** Gemini File Search ストアID（例: org_<orgId>_rules） */
  fileSearchStoreId?: string;

  /** 作成日時 */
  created_at: FirebaseFirestore.Timestamp | Date;

  /** 更新日時 */
  updated_at?: FirebaseFirestore.Timestamp | Date;
}

/**
 * 組織学習ドキュメントのタイプ
 */
export type OrgLearningDocType =
  // マスタ系
  | 'customer_master'   // 顧客マスタ
  | 'item_master'       // 品目マスタ
  | 'account_master'    // 勘定科目マスタ
  | 'tax_master'        // 税区分マスタ
  | 'department_master' // 部門マスタ
  | 'vendor_master'     // 仕入先マスタ
  | 'employee_master'   // 従業員マスタ
  // ルール系
  | 'rule'              // 業務ルール（勘定科目割当ルールなど）
  | 'exception'         // 例外ルール
  // 帳票系
  | 'invoice'           // 請求書
  | 'quotation'         // 見積書
  | 'purchase_order'    // 発注書
  | 'delivery_note'     // 納品書
  | 'receipt'           // 領収書
  | 'contract'          // 契約書
  // フォーマット系（データ取込用）
  | 'csv_format'        // CSVフォーマット定義
  | 'excel_format'      // Excelフォーマット定義
  | 'pdf_template'      // PDFテンプレート
  // その他
  | 'other';            // その他

/**
 * 組織学習ドキュメント（orgLearningDocs コレクション）
 * Gemini File Searchに同期するナレッジデータ
 */
export interface OrgLearningDoc {
  /** 組織ID（organizationsのドキュメントID） */
  orgId: string;

  /** ドキュメントタイプ */
  type: OrgLearningDocType;

  /** タイトル */
  title: string;

  /** コンテンツ（マークダウン形式推奨） */
  content: string;

  /** 作成日時 */
  createdAt: FirebaseFirestore.Timestamp | Date;

  /** 更新日時 */
  updatedAt: FirebaseFirestore.Timestamp | Date;

  /** 作成者UID */
  createdBy: string;

  /** 更新者UID */
  updatedBy?: string;

  // === File Search 同期関連 ===

  /** Gemini File Search でのファイルID（同期後に設定） */
  fileId?: string;

  /** 最終同期日時 */
  syncedAt?: FirebaseFirestore.Timestamp | Date;

  /** 同期ステータス */
  syncStatus?: 'pending' | 'syncing' | 'synced' | 'failed';

  /** 同期エラーメッセージ */
  syncError?: string;

  /** 同期リトライ回数 */
  syncRetryCount?: number;
}

/**
 * 同期履歴（org_learning_sync_history コレクション）
 * File Search同期の実行履歴を記録
 */
export interface OrgLearningSyncHistory {
  /** 組織ID */
  orgId: string;

  /** 実行日時 */
  executedAt: FirebaseFirestore.Timestamp | Date;

  /** 実行タイプ */
  executionType: 'manual' | 'scheduled' | 'on_update';

  /** 処理統計 */
  stats: {
    totalDocs: number;
    syncedDocs: number;
    failedDocs: number;
    skippedDocs: number;
  };

  /** 処理時間（ミリ秒） */
  durationMs: number;

  /** 同期されたドキュメントの詳細 */
  syncedDocIds: string[];

  /** 失敗したドキュメントとエラー */
  failedDocs: Array<{
    docId: string;
    error: string;
  }>;

  /** エラーメッセージ（全体的なエラーの場合） */
  error?: string;
}

/**
 * コード提案の結果
 */
export interface CodeSuggestion {
  code: string;
  confidence: number;
  reason: string;
}

/**
 * 行ごとのコード提案
 */
export interface LineCodeSuggestion {
  index: number;
  itemCode: CodeSuggestion;
  accountCode: CodeSuggestion;
  taxCategory: CodeSuggestion;
  departmentCode: CodeSuggestion;
}

/**
 * ドキュメントに対するコード提案全体
 */
export interface DocumentCodeSuggestions {
  customerCode: CodeSuggestion;
  lines: LineCodeSuggestion[];
}

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
  /** 抽出された値（文字列）- 補正適用後の値 */
  value: string;

  /** バウンディングボックス座標 */
  bbox: BBox;

  /** ページ番号（1から開始、複数ページPDF用） */
  page?: number;

  /** AI抽出の信頼度（0〜1.0、1.0が最も自信あり） */
  confidence?: number;

  // === 学習補正関連（機能④） ===

  /** AIの元出力値（補正前）- 補正が適用された場合のみ存在 */
  originalValue?: string;

  /** 学習補正が適用されたかどうか */
  wasLearningCorrected?: boolean;
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

  /** 組織ID（紐づく組織のドキュメントID） */
  organization_id?: string;

  /** プロンプトテキスト */
  prompt_text: string;

  /** 抽出フィールド定義 */
  extraction_fields: ExtractionField[];

  /** 使用するAIモデル名 */
  model_name: string;

  /** 作成日時 */
  created_at: FirebaseFirestore.Timestamp | Date;

  /** サンプルファイルパス（Cloud Storage） */
  sample_file_path?: string;

  // === AI自動判定用メタ情報（後方互換性のためオプショナル） ===

  /** UI表示名（設定名とは別にUIで表示する名前） */
  displayName?: string;

  /** テンプレートタイプ（請求書 / 見積書 / 注文書 など） */
  templateType?: string;

  /** テンプレート判定用キーワード（タイトル、固定ラベルなど） */
  exampleKeywords?: string[];

  // === 訂正学習データ（機能③） ===

  /** 学習データ（訂正ログから自動生成） */
  learning?: LearningData;
}

/**
 * テンプレート候補（AI判定結果）
 */
export interface TemplateCandidate {
  /** テンプレートID（OcrSettingのドキュメントID） */
  id: string;

  /** 信頼度（0-1） */
  confidence: number;
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

  /** 変換後画像パス（PDFの場合）- 後方互換性のため残す */
  converted_image_path?: string;

  /** 変換後画像パス（複数ページ対応） */
  converted_image_paths?: string[];

  /** PDFのページ数 */
  page_count?: number;

  /** 抽出データ */
  extracted_data?: ExtractedData;

  /** エラーメッセージ */
  error_message?: string;

  /** 実行日時 */
  executed_at: FirebaseFirestore.Timestamp | Date;

  // === AI自動判定関連（後方互換性のためオプショナル） ===

  /** AI推定テンプレートID（nullは判定不能） */
  predictedTemplateId?: string | null;

  /** AI推定の信頼度（0-1） */
  predictedConfidence?: number;

  /** テンプレート候補一覧 */
  templateCandidates?: TemplateCandidate[];

  /** ユーザーが選択したテンプレートID（初期値はpredictedTemplateId） */
  chosenTemplateId?: string;

  // === 人間確定関連（機能②） ===

  /** 人間が確定したデータ（AI抽出結果を上書き） */
  humanConfirmedData?: ExtractedData;

  /** 人間による確定が完了したかどうか */
  isHumanConfirmed?: boolean;

  /** 人間確定日時 */
  confirmedAt?: FirebaseFirestore.Timestamp | Date;
}

/**
 * 置換ルール（訂正学習から生成）
 * AIの抽出ミスを自動補正するためのルール
 */
export interface ReplacementRule {
  /** フィールドキー（例: "invoiceDate"） */
  fieldKey: string;

  /** AIが抽出した値（補正前） */
  aiValue: string;

  /** 正しい値（補正後） */
  correctValue: string;

  /** この訂正が発生した回数 */
  count: number;

  /** 最終更新日時 */
  updatedAt: FirebaseFirestore.Timestamp | Date;
}

/**
 * 位置ヒント（訂正学習から生成）
 * 特定フィールドの推奨抽出領域
 */
export interface PreferredRegion {
  /** フィールドキー */
  fieldKey: string;

  /** 推奨領域（正規化座標） */
  region: {
    x: number;
    y: number;
    w: number;
    h: number;
  };

  /** サンプル数（この領域を計算するのに使用した訂正数） */
  sampleCount: number;

  /** 最終更新日時 */
  updatedAt: FirebaseFirestore.Timestamp | Date;
}

/**
 * 学習データ（テンプレートに蓄積）
 * 訂正ログから自動生成される補正ルール
 */
export interface LearningData {
  /** 置換ルール配列 */
  replacements: ReplacementRule[];

  /** 位置ヒント配列（オプション） */
  preferredRegions?: PreferredRegion[];

  /** 最終学習実行日時 */
  lastLearnedAt?: FirebaseFirestore.Timestamp | Date;
}

/**
 * 訂正ログ（corrections コレクション用）
 * AIの抽出結果と人間の確定値の差分を記録
 */
export interface CorrectionLog {
  /** ドキュメントID（ocr_historyのID） */
  docId: string;

  /** テンプレートID（ocr_settingsのID） */
  templateId: string;

  /** フィールドキー（例: "invoiceDate" または "lineItems[0].itemName"） */
  fieldKey: string;

  /** AIが抽出した値 */
  aiValue: string;

  /** 人間が確定した値 */
  humanValue: string;

  /** AIの信頼度（0〜1.0） */
  aiConfidence: number;

  /** バウンディングボックス（あれば） */
  bbox?: BBox;

  /** ページ番号（複数ページ対応） */
  page?: number;

  /** 作成日時 */
  createdAt: FirebaseFirestore.Timestamp | Date;
}

/**
 * 型ガード: ExtractedArrayDataかどうかを判定
 */
export function isExtractedArrayData(data: ExtractedValue | ExtractedArrayData | null | undefined): data is ExtractedArrayData {
  return !!data && typeof data === 'object' && 'items' in data && Array.isArray(data.items);
}

/**
 * 型ガード: ExtractedValueかどうかを判定
 */
export function isExtractedValue(data: ExtractedValue | ExtractedArrayData | null | undefined): data is ExtractedValue {
  return !!data && typeof data === 'object' && 'value' in data && typeof data.value === 'string';
}

/**
 * 訂正学習バッチの設定（app_settings/correction_learning）
 */
export interface CorrectionLearningSettings {
  /** バッチ処理の有効/無効 */
  enabled: boolean;

  /** 実行時刻（0-23の整数、JST） */
  scheduledHour: number;

  /** 対象日数（過去何日分の訂正を集計するか） */
  lookbackDays: number;

  /** 最低発生回数（何回以上の訂正で学習するか） */
  minOccurrenceCount: number;

  /** 最終更新日時 */
  updatedAt: FirebaseFirestore.Timestamp | Date;

  /** 更新者UID */
  updatedBy?: string;
}

/**
 * 学習履歴の学習ルール詳細
 */
export interface LearningHistoryRule {
  templateId: string;
  templateName?: string;
  fieldKey: string;
  aiValue: string;
  correctValue: string;
  count: number;
  isNew: boolean; // 新規追加かどうか
}

/**
 * 学習履歴（learning_history コレクション）
 * バッチ実行ごとに1レコード作成
 */
export interface LearningHistory {
  /** 実行日時 */
  executedAt: FirebaseFirestore.Timestamp | Date;

  /** 実行タイプ（scheduled: スケジュール実行, manual: 手動実行） */
  executionType: 'scheduled' | 'manual';

  /** 処理統計 */
  stats: {
    totalCorrections: number;
    templatesProcessed: number;
    rulesAdded: number;
    rulesUpdated: number;
    errors: number;
  };

  /** 処理時間（ミリ秒） */
  durationMs: number;

  /** 学習ルール詳細 */
  rules: LearningHistoryRule[];

  /** 設定パラメータ */
  settings: {
    lookbackDays: number;
    minOccurrenceCount: number;
  };
}

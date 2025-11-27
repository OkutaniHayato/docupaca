import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { defineSecret } from 'firebase-functions/params';
import * as crypto from 'crypto';
import { spawn, execSync } from 'child_process';
import sharp from 'sharp';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Firebase Admin初期化
admin.initializeApp();

// Gemini APIキーをSecret Managerから取得
const geminiApiKey = defineSecret('GEMINI_API_KEY');

// Firestore, Storageインスタンス
const db = admin.firestore();
const storage = admin.storage();

/**
 * 指数バックオフ付きのリトライ処理
 * @param fn 実行する非同期関数
 * @param maxRetries 最大リトライ回数（デフォルト: 4回）
 * @param initialDelayMs 初回リトライの待機時間（デフォルト: 2000ms）
 * @returns 関数の実行結果
 */
async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 4,
  initialDelayMs = 2000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // リトライ対象のエラーかチェック
      const isRetryableError =
        (error as { status?: number }).status === 503 || // Service Unavailable
        (error as { status?: number }).status === 429 || // Too Many Requests
        (error as { status?: number }).status === 500 || // Internal Server Error
        (error as Error).message?.includes('overloaded') ||
        (error as Error).message?.includes('ECONNRESET') ||
        (error as Error).message?.includes('ETIMEDOUT');

      // 最後の試行、またはリトライ対象外のエラーの場合は例外を投げる
      if (attempt >= maxRetries || !isRetryableError) {
        throw error;
      }

      // 指数バックオフで待機
      const delayMs = initialDelayMs * Math.pow(2, attempt);
      functions.logger.warn(
        `Gemini API request failed (attempt ${attempt + 1}/${maxRetries + 1}). ` +
        `Retrying in ${delayMs}ms... Error: ${(error as Error).message}`
      );

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // ここには到達しないはずだが、型安全のために
  throw lastError || new Error('Retry failed');
}

/**
 * PDFのページ数を取得する関数
 */
function getPdfPageCount(pdfBuffer: Buffer): number {
  const tmpDir = os.tmpdir();
  const pdfPath = path.join(tmpDir, `pdf_${Date.now()}.pdf`);

  try {
    fs.writeFileSync(pdfPath, pdfBuffer);

    // Ghostscriptでページ数を取得
    const result = execSync(`gs -q -dNODISPLAY -c "(${pdfPath}) (r) file runpdfbegin pdfpagecount = quit"`, {
      encoding: 'utf-8',
      timeout: 30000,
    });

    const pageCount = parseInt(result.trim(), 10);
    return isNaN(pageCount) ? 1 : pageCount;
  } catch (error) {
    functions.logger.error('Failed to get PDF page count:', error);
    return 1;
  } finally {
    try {
      fs.unlinkSync(pdfPath);
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * PDFを画像に変換する関数（複数ページ対応・Ghostscript版）
 * - Cloud Functions ランタイムに入っている Ghostscript の `gs` を利用
 * - 全ページを PNG に変換
 * - 失敗したら null を返し、OCR処理自体は続行
 */
async function convertPdfToImages(pdfBuffer: Buffer): Promise<{ buffers: Buffer[]; pageCount: number } | null> {
  const tmpDir = os.tmpdir();
  const sessionId = Date.now();
  const pdfPath = path.join(tmpDir, `pdf_${sessionId}.pdf`);
  const outputPattern = path.join(tmpDir, `page_${sessionId}_%d.png`);

  try {
    // PDFを一時ファイルに保存
    fs.writeFileSync(pdfPath, pdfBuffer);

    // ページ数を取得
    const pageCount = getPdfPageCount(pdfBuffer);
    functions.logger.info(`PDF has ${pageCount} pages`);

    // Ghostscriptで全ページを変換
    return new Promise<{ buffers: Buffer[]; pageCount: number } | null>((resolve) => {
      const gs = spawn('gs', [
        '-dSAFER',
        '-dBATCH',
        '-dNOPAUSE',
        '-sDEVICE=png16m',
        '-r150',
        `-sOutputFile=${outputPattern}`,
        '-q',
        pdfPath,
      ]);

      const errors: Buffer[] = [];
      gs.stderr.on('data', (data) => errors.push(data));

      gs.on('error', (err) => {
        functions.logger.error('Ghostscript spawn error:', err);
        cleanup();
        resolve(null);
      });

      gs.on('close', async (code) => {
        if (code !== 0) {
          functions.logger.error('Ghostscript convert failed', {
            code,
            stderr: Buffer.concat(errors).toString(),
          });
          cleanup();
          resolve(null);
          return;
        }

        try {
          const buffers: Buffer[] = [];

          // 各ページの画像を読み込み最適化
          for (let i = 1; i <= pageCount; i++) {
            const pagePath = path.join(tmpDir, `page_${sessionId}_${i}.png`);

            if (fs.existsSync(pagePath)) {
              const pngBuffer = fs.readFileSync(pagePath);

              // sharp で最適化
              try {
                const optimized = await sharp(pngBuffer)
                  .png({ quality: 80, compressionLevel: 9 })
                  .toBuffer();
                buffers.push(optimized);
              } catch (e) {
                functions.logger.error(`sharp optimization failed for page ${i}:`, e);
                buffers.push(pngBuffer);
              }
            } else {
              functions.logger.warn(`Page ${i} not found at ${pagePath}`);
            }
          }

          cleanup();

          if (buffers.length === 0) {
            functions.logger.error('No pages were converted');
            resolve(null);
          } else {
            resolve({ buffers, pageCount: buffers.length });
          }
        } catch (error) {
          functions.logger.error('Error reading converted pages:', error);
          cleanup();
          resolve(null);
        }
      });
    });

    function cleanup() {
      try {
        fs.unlinkSync(pdfPath);
      } catch {
        // ignore
      }
      for (let i = 1; i <= 1000; i++) {
        const pagePath = path.join(tmpDir, `page_${sessionId}_${i}.png`);
        if (fs.existsSync(pagePath)) {
          try {
            fs.unlinkSync(pagePath);
          } catch {
            // ignore
          }
        } else {
          break;
        }
      }
    }
  } catch (error) {
    functions.logger.error('PDF to image conversion failed:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return null;
  }
}

// APIキーのハッシュを検証する関数
async function verifyApiKey(apiKey: string): Promise<string | null> {
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  try {
    const keysSnapshot = await db.collection('api_keys')
      .where('key_hash', '==', keyHash)
      .limit(1)
      .get();

    if (keysSnapshot.empty) {
      return null;
    }

    const keyDoc = keysSnapshot.docs[0];
    return keyDoc.data().user_id;
  } catch (error) {
    functions.logger.error('API key verification error:', error);
    return null;
  }
}

// 拡張されたOCR型定義（ネスト構造対応）

/**
 * 抽出フィールドの定義
 * - single: 単一値フィールド（例: 請求書番号、発行日）
 * - array: 繰り返し構造フィールド（例: 明細行、商品リスト）
 */
interface ExtractionField {
  name: string;
  instruction: string;
  type: 'single' | 'array';
  children?: ExtractionField[]; // type='array'の場合のみ使用
}

/**
 * バウンディングボックス座標
 * [x_min, y_min, x_max, y_max]
 */
type BBox = [number, number, number, number];

/**
 * 抽出された単一値
 */
interface ExtractedValue {
  value: string;
  bbox: BBox;
  page?: number;
  confidence?: number; // AI抽出の信頼度（0〜1.0）
}

/**
 * 抽出された配列データ
 */
interface ExtractedArrayData {
  items: Array<{
    [childFieldName: string]: ExtractedValue;
  }>;
  bbox?: BBox; // 配列全体のbbox（オプション）
}

/**
 * 抽出データ全体（ネスト構造対応）
 */
type ExtractedData = {
  [fieldName: string]: ExtractedValue | ExtractedArrayData;
};

// OCR設定のデータ型
interface OcrSetting {
  name: string;
  owner_id: string;
  prompt_text: string;
  extraction_fields: ExtractionField[];
  model_name: string;
  created_at: admin.firestore.Timestamp;
}

// OCR履歴のデータ型
interface OcrHistory {
  setting_id: string;
  status: 'processing' | 'completed' | 'failed';
  original_file_path: string;
  converted_image_path?: string; // 後方互換性のため残す
  converted_image_paths?: string[]; // 複数ページ対応
  page_count?: number;
  extracted_data?: ExtractedData;
  error_message?: string;
  executed_at: admin.firestore.Timestamp;
}

// リクエストデータ型
interface ExecuteOcrRequest {
  setting_id: string;
  file_path: string;
  user_id: string;
}

/**
 * ExtractionFieldsからJSONスキーマを動的生成
 * Gemini APIに渡すプロンプト用のスキーマ例を作成
 */
function generateJsonSchemaFromFields(fields: ExtractionField[]): string {
  const schema: Record<string, unknown> = {};

  for (const field of fields) {
    if (field.type === 'single') {
      // 単一値フィールド
      schema[field.name] = {
        value: '抽出された値',
        bbox: [0, 0, 0, 0],
        confidence: 0.95,
      };
    } else if (field.type === 'array' && field.children) {
      // 配列フィールド
      const childSchema: Record<string, unknown> = {};
      for (const child of field.children) {
        childSchema[child.name] = {
          value: '抽出された値',
          bbox: [0, 0, 0, 0],
          confidence: 0.95,
        };
      }

      schema[field.name] = {
        items: [childSchema],
        bbox: [0, 0, 0, 0], // オプション
      };
    }
  }

  return JSON.stringify(schema, null, 2);
}

/**
 * ExtractionFieldsからプロンプト用のフィールド説明を生成
 */
function generateFieldDescriptions(fields: ExtractionField[], indent = 0): string {
  const lines: string[] = [];
  const prefix = '  '.repeat(indent);

  for (const field of fields) {
    if (field.type === 'single') {
      lines.push(`${prefix}- ${field.name}: ${field.instruction}`);
    } else if (field.type === 'array' && field.children) {
      lines.push(`${prefix}- ${field.name} (配列): ${field.instruction}`);
      lines.push(`${prefix}  子フィールド:`);
      lines.push(generateFieldDescriptions(field.children, indent + 2));
    }
  }

  return lines.join('\n');
}

/**
 * OCR実行用Cloud Function (v2 Callable)
 *
 * リクエスト:
 * - setting_id: OCR設定ID
 * - file_path: Cloud Storage上のファイルパス
 * - user_id: 実行ユーザーID
 */
export const executeOcr = functions.https.onCall(
  {
    region: 'asia-northeast1',
    secrets: [geminiApiKey],
    timeoutSeconds: 540, // 9分（Gemini API処理に時間がかかる可能性）
    memory: '1GiB',
  },
  async (request) => {
    const data = request.data as ExecuteOcrRequest;
    const { setting_id, file_path, user_id } = data;

    // 入力検証
    if (!setting_id || !file_path || !user_id) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        '必須パラメータが不足しています: setting_id, file_path, user_id'
      );
    }

    // 認証チェック（オプション: 必要に応じて有効化）
    if (request.auth?.uid !== user_id) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        '認証エラー: ユーザーIDが一致しません'
      );
    }

    let historyRef: admin.firestore.DocumentReference | null = null;

    try {
      // 1. ocr_historyに初期レコードを作成
      historyRef = await db.collection('ocr_history').add({
        setting_id,
        status: 'processing',
        original_file_path: file_path,
        executed_at: admin.firestore.Timestamp.now(),
      } as Partial<OcrHistory>);

      functions.logger.info(`OCR処理開始: history_id=${historyRef.id}, setting_id=${setting_id}`);

      // 2. OCR設定を取得
      const settingDoc = await db.collection('ocr_settings').doc(setting_id).get();

      if (!settingDoc.exists) {
        throw new Error(`OCR設定が見つかりません: setting_id=${setting_id}`);
      }

      const setting = settingDoc.data() as OcrSetting;

      // 権限チェック: 設定のownerと実行ユーザーが一致するか確認
      if (setting.owner_id !== user_id) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'この設定を使用する権限がありません'
        );
      }

      functions.logger.info(`OCR設定取得成功: name=${setting.name}, model=${setting.model_name}`);

      // 3. Cloud Storageからファイルを取得
      const bucket = storage.bucket();
      const file = bucket.file(file_path);

      const [exists] = await file.exists();
      if (!exists) {
        throw new Error(`ファイルが見つかりません: ${file_path}`);
      }

      functions.logger.info(`ファイル取得中: ${file_path}`);

      // ファイルをダウンロード
      const [fileBuffer] = await file.download();
      const [metadata] = await file.getMetadata();
      const mimeType = metadata.contentType || 'application/octet-stream';

      functions.logger.info(`ファイル取得成功: size=${fileBuffer.length} bytes, mimeType=${mimeType}`);

      // PDFの場合は画像に変換してCloud Storageに保存
      let convertedImagePaths: string[] | undefined;
      let pageCount: number | undefined;
      if (mimeType === 'application/pdf' || file_path.toLowerCase().endsWith('.pdf')) {
        functions.logger.info('Processing PDF for preview...');

        const result = await convertPdfToImages(fileBuffer);

        if (result) {
          convertedImagePaths = [];
          pageCount = result.pageCount;

          // 各ページをCloud Storageに保存
          for (let i = 0; i < result.buffers.length; i++) {
            const pagePath = file_path.replace(/\.pdf$/i, `_page_${i + 1}.png`);
            await bucket.file(pagePath).save(result.buffers[i], { metadata: { contentType: 'image/png' } });
            convertedImagePaths.push(pagePath);
            functions.logger.info(`Preview image saved: ${pagePath}`);
          }
        } else {
          functions.logger.warn('Preview generation skipped due to conversion error.');
        }
      }

      // 4. Gemini APIで処理
      const apiKey = geminiApiKey.value();
      if (!apiKey) {
        throw new Error('GEMINI_API_KEYが設定されていません');
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: setting.model_name });

      // プロンプト作成（ネスト構造対応）
      const extractionFieldsDescription = generateFieldDescriptions(setting.extraction_fields);
      const jsonSchemaExample = generateJsonSchemaFromFields(setting.extraction_fields);

      const prompt = `${setting.prompt_text}

【抽出項目】
${extractionFieldsDescription}

【出力形式】
以下のJSON形式で出力してください。JSONのみを出力し、他の説明文は含めないでください。

${jsonSchemaExample}

重要な注意事項:
1. 単一値フィールドは {"value": "抽出された値", "bbox": [x1, y1, x2, y2], "confidence": 0.95} の形式
2. 配列フィールドは {"items": [...], "bbox": [x1, y1, x2, y2]} の形式
3. 配列の各要素は子フィールドのオブジェクト（各子フィールドにもconfidenceを含める）
4. bboxは該当箇所の座標を[左上x, 左上y, 右下x, 右下y]の形式で記載（正規化座標0-1推奨）
5. 座標が不明な場合は[0, 0, 0, 0]としてください
6. 【信頼度の出力が必須】各フィールドに必ずconfidenceを0〜1.0の数値で出力してください:
   - 1.0: 非常に自信がある（文字がはっきり読める、フォーマットが明確）
   - 0.8〜0.9: ある程度自信がある
   - 0.5〜0.7: やや不確か（文字がかすれている、推測が入る）
   - 0.5未満: 自信がない（読み取りにくい、推測要素が大きい）`;

      functions.logger.info('Gemini API呼び出し開始');

      // 5. 複数ページPDFの場合は各ページを個別に処理、それ以外は従来どおり
      let extractedData: OcrHistory['extracted_data'];

      if (convertedImagePaths && convertedImagePaths.length > 1) {
        // 複数ページPDF: 各ページを個別にGemini APIで処理
        functions.logger.info(`複数ページPDF処理開始: ${convertedImagePaths.length}ページ`);

        const allExtractedData: Record<string, unknown> = {};

        for (let pageIndex = 0; pageIndex < convertedImagePaths.length; pageIndex++) {
          const pagePath = convertedImagePaths[pageIndex];
          const pageNumber = pageIndex + 1;

          functions.logger.info(`ページ ${pageNumber}/${convertedImagePaths.length} を処理中...`);

          // ページ画像をダウンロード
          const pageFile = bucket.file(pagePath);
          const [pageBuffer] = await pageFile.download();

          const pageImagePart = {
            inlineData: {
              data: pageBuffer.toString('base64'),
              mimeType: 'image/png',
            },
          };

          // ページ用のプロンプト（ページ番号を含める指示を追加）
          const pagePrompt = `${prompt}
7. 重要: このドキュメントの${pageNumber}ページ目を処理しています。すべてのbboxにはpageプロパティを追加し、値は${pageNumber}としてください。
   例: {"value": "抽出された値", "bbox": [x1, y1, x2, y2], "confidence": 0.95, "page": ${pageNumber}}`;

          // リトライ処理付きでGemini APIを呼び出し
          const pageText = await retryWithExponentialBackoff(async () => {
            const result = await model.generateContent([pageImagePart, pagePrompt]);
            const response = await result.response;
            return response.text();
          });

          // ページのレスポンスをパース
          let pageExtractedData: Record<string, unknown>;
          try {
            const cleanedText = pageText.replace(/```json\n?|\n?```/g, '').trim();
            pageExtractedData = JSON.parse(cleanedText);
          } catch (error) {
            functions.logger.error(`ページ ${pageNumber} のJSON解析エラー:`, error);
            throw new Error(`ページ ${pageNumber} のGemini API応答のJSON解析に失敗しました: ${pageText.substring(0, 200)}`);
          }

          // ページ番号をすべてのextracted_dataに付加（APIが付加していない場合のフォールバック）
          const addPageNumber = (data: unknown): unknown => {
            if (Array.isArray(data)) {
              return data.map(item => addPageNumber(item));
            } else if (data && typeof data === 'object') {
              const obj = data as Record<string, unknown>;
              // ExtractedValue形式の場合（value と bbox を持つ）
              if ('value' in obj && 'bbox' in obj) {
                return { ...obj, page: obj.page || pageNumber };
              }
              // ExtractedArrayData形式の場合（items を持つ）
              if ('items' in obj && Array.isArray(obj.items)) {
                return {
                  ...obj,
                  items: obj.items.map(item => addPageNumber(item)),
                };
              }
              // その他のオブジェクト
              const result: Record<string, unknown> = {};
              for (const key in obj) {
                result[key] = addPageNumber(obj[key]);
              }
              return result;
            }
            return data;
          };

          const pageDataWithPageNumber = addPageNumber(pageExtractedData) as Record<string, unknown>;

          // ページごとのデータを統合
          for (const [fieldName, fieldValue] of Object.entries(pageDataWithPageNumber)) {
            if (allExtractedData[fieldName]) {
              // 既存のフィールドがある場合、配列フィールドならマージ
              const existing = allExtractedData[fieldName] as Record<string, unknown>;
              const newValue = fieldValue as Record<string, unknown>;

              if (Array.isArray(existing.items) && Array.isArray(newValue.items)) {
                // 配列フィールドの場合、itemsをマージ
                existing.items = [...existing.items, ...newValue.items];
              } else if ('value' in existing && 'value' in newValue) {
                // 単一値フィールドの場合、ページごとに配列に変換
                allExtractedData[fieldName] = {
                  items: [existing, newValue],
                };
              }
            } else {
              allExtractedData[fieldName] = fieldValue;
            }
          }

          functions.logger.info(`ページ ${pageNumber} の処理完了`);
        }

        extractedData = allExtractedData as OcrHistory['extracted_data'];
        functions.logger.info('全ページの処理完了');

      } else {
        // 単一ページまたは画像ファイル: 従来どおり処理
        const imagePart = {
          inlineData: {
            data: fileBuffer.toString('base64'),
            mimeType: mimeType,
          },
        };

        // リトライ処理付きでGemini APIを呼び出し
        const text = await retryWithExponentialBackoff(async () => {
          const result = await model.generateContent([imagePart, prompt]);
          const response = await result.response;
          return response.text();
        });

        functions.logger.info('Gemini API応答受信');

        // レスポンスをパース
        try {
          // マークダウンのコードブロックを除去
          const cleanedText = text.replace(/```json\n?|\n?```/g, '').trim();
          extractedData = JSON.parse(cleanedText);
        } catch (error) {
          functions.logger.error('JSON解析エラー:', error);
          throw new Error(`Gemini API応答のJSON解析に失敗しました: ${text.substring(0, 200)}`);
        }
      }

      // 6. ocr_historyを更新（成功）
      const updateData: Record<string, unknown> = {
        status: 'completed',
        extracted_data: extractedData,
      };

      // 変換された画像のパスがあれば追加（配列形式で保存）
      if (convertedImagePaths && convertedImagePaths.length > 0) {
        updateData.converted_image_paths = convertedImagePaths;
        updateData.page_count = pageCount;
      }

      await historyRef.update(updateData);

      functions.logger.info(`OCR処理完了: history_id=${historyRef.id}`);

      return {
        success: true,
        history_id: historyRef.id,
        extracted_data: extractedData,
      };

    } catch (error) {
      functions.logger.error('OCR処理エラー:', error);

      // エラー時にocr_historyを更新
      if (historyRef) {
        await historyRef.update({
          status: 'failed',
          error_message: error instanceof Error ? error.message : String(error),
        });
      }

      // エラーを再スロー
      if (error instanceof functions.https.HttpsError) {
        throw error;
      }

      // ユーザーフレンドリーなエラーメッセージを生成
      let userMessage = 'OCR処理中にエラーが発生しました。';
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('overloaded') || errorMessage.includes('503')) {
        userMessage = 'AI APIが混雑しています。自動リトライを行いましたが、処理を完了できませんでした。しばらく時間をおいて再度お試しください。';
      } else if (errorMessage.includes('429') || errorMessage.includes('quota')) {
        userMessage = 'APIの利用上限に達しました。しばらく時間をおいて再度お試しください。';
      } else if (errorMessage.includes('500')) {
        userMessage = 'AI APIでエラーが発生しました。自動リトライを行いましたが、処理を完了できませんでした。しばらく時間をおいて再度お試しください。';
      }

      throw new functions.https.HttpsError(
        'internal',
        `${userMessage} (詳細: ${errorMessage})`
      );
    }
  }
);

/**
 * 外部API連携用のHTTP OCRエンドポイント
 *
 * APIキーで認証し、指定されたOCR設定を使用してドキュメントを処理します。
 *
 * リクエスト:
 * - Headers: Authorization: Bearer <API_KEY>
 * - Body (JSON):
 *   - setting_id: OCR設定ID
 *   - file: Base64エンコードされたファイルデータ
 *   - filename: ファイル名（オプション）
 *
 * レスポンス:
 * - 成功: { success: true, history_id: string, extracted_data: object }
 * - エラー: { success: false, error: string }
 */
export const ocrApi = functions.https.onRequest(
  {
    region: 'asia-northeast1',
    secrets: [geminiApiKey],
    timeoutSeconds: 540,
    memory: '1GiB',
    cors: true, // CORSを有効化
  },
  async (req, res) => {
    // CORSヘッダーを設定
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    // OPTIONSリクエスト（プリフライト）への対応
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    // POSTメソッドのみ許可
    if (req.method !== 'POST') {
      res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
      return;
    }

    try {
      // 1. APIキー認証
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ success: false, error: 'Authorization header missing or invalid' });
        return;
      }

      const apiKey = authHeader.substring(7); // "Bearer " を除去
      const userId = await verifyApiKey(apiKey);

      if (!userId) {
        res.status(401).json({ success: false, error: 'Invalid API key' });
        return;
      }

      functions.logger.info(`API request authenticated for user: ${userId}`);

      // 2. リクエストボディの検証
      const { setting_id, file, filename } = req.body;

      if (!setting_id || !file) {
        res.status(400).json({
          success: false,
          error: 'Missing required parameters: setting_id and file (base64 encoded)'
        });
        return;
      }

      // 3. OCR設定を取得
      const settingDoc = await db.collection('ocr_settings').doc(setting_id).get();

      if (!settingDoc.exists) {
        res.status(404).json({ success: false, error: 'OCR setting not found' });
        return;
      }

      const setting = settingDoc.data() as OcrSetting;

      // 権限チェック
      if (setting.owner_id !== userId) {
        res.status(403).json({
          success: false,
          error: 'Permission denied: You do not own this OCR setting'
        });
        return;
      }

      functions.logger.info(`OCR setting found: ${setting.name}`);

      // 4. ocr_historyに初期レコードを作成
      const historyRef = await db.collection('ocr_history').add({
        setting_id,
        status: 'processing',
        original_file_path: filename || 'api_upload',
        executed_at: admin.firestore.Timestamp.now(),
      } as Partial<OcrHistory>);

      functions.logger.info(`OCR processing started: history_id=${historyRef.id}`);

      // 5. Base64ファイルをデコード
      let fileBuffer: Buffer;
      try {
        fileBuffer = Buffer.from(file, 'base64');
      } catch {
        await historyRef.update({
          status: 'failed',
          error_message: 'Invalid base64 file data',
        });
        res.status(400).json({ success: false, error: 'Invalid base64 file data' });
        return;
      }

      // MIMEタイプを推測（シンプルな実装）
      let mimeType = 'application/octet-stream';
      if (filename) {
        if (filename.endsWith('.pdf')) {
          mimeType = 'application/pdf';
        } else if (filename.endsWith('.png')) {
          mimeType = 'image/png';
        } else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
          mimeType = 'image/jpeg';
        }
      }

      functions.logger.info(`File decoded: size=${fileBuffer.length} bytes, mimeType=${mimeType}`);

      // Cloud Storageにファイルを保存
      const bucket = storage.bucket();
      const storagePath = `api_uploads/${userId}/${Date.now()}_${filename || 'upload'}`;
      const storageFile = bucket.file(storagePath);

      await storageFile.save(fileBuffer, {
        metadata: {
          contentType: mimeType,
        },
      });

      functions.logger.info(`File saved to storage: ${storagePath}`);

      // PDFの場合は画像に変換してCloud Storageに保存
      let convertedImagePaths: string[] | undefined;
      let pageCount: number | undefined;
      if (mimeType === 'application/pdf') {
        const result = await convertPdfToImages(fileBuffer);
        if (result) {
          convertedImagePaths = [];
          pageCount = result.pageCount;

          // 各ページをCloud Storageに保存
          for (let i = 0; i < result.buffers.length; i++) {
            const pagePath = storagePath.replace(/\.pdf$/i, `_page_${i + 1}.png`);
            await bucket.file(pagePath).save(result.buffers[i], { metadata: { contentType: 'image/png' } });
            convertedImagePaths.push(pagePath);
            functions.logger.info(`PDF converted to image: ${pagePath}`);
          }
        } else {
          functions.logger.warn('PDF to image conversion failed, continuing with OCR.');
        }
      }

      // historyのoriginal_file_pathを更新
      await historyRef.update({
        original_file_path: storagePath,
      });

      // 6. Gemini APIで処理
      const apiKeyValue = geminiApiKey.value();
      if (!apiKeyValue) {
        throw new Error('GEMINI_API_KEY not configured');
      }

      const genAI = new GoogleGenerativeAI(apiKeyValue);
      const model = genAI.getGenerativeModel({ model: setting.model_name });

      // プロンプト作成（ネスト構造対応）
      const extractionFieldsDescription = generateFieldDescriptions(setting.extraction_fields);
      const jsonSchemaExample = generateJsonSchemaFromFields(setting.extraction_fields);

      const prompt = `${setting.prompt_text}

【抽出項目】
${extractionFieldsDescription}

【出力形式】
以下のJSON形式で出力してください。JSONのみを出力し、他の説明文は含めないでください。

${jsonSchemaExample}

重要な注意事項:
1. 単一値フィールドは {"value": "抽出された値", "bbox": [x1, y1, x2, y2], "confidence": 0.95} の形式
2. 配列フィールドは {"items": [...], "bbox": [x1, y1, x2, y2]} の形式
3. 配列の各要素は子フィールドのオブジェクト（各子フィールドにもconfidenceを含める）
4. bboxは該当箇所の座標を[左上x, 左上y, 右下x, 右下y]の形式で記載（正規化座標0-1推奨）
5. 座標が不明な場合は[0, 0, 0, 0]としてください
6. 【信頼度の出力が必須】各フィールドに必ずconfidenceを0〜1.0の数値で出力してください:
   - 1.0: 非常に自信がある（文字がはっきり読める、フォーマットが明確）
   - 0.8〜0.9: ある程度自信がある
   - 0.5〜0.7: やや不確か（文字がかすれている、推測が入る）
   - 0.5未満: 自信がない（読み取りにくい、推測要素が大きい）`;

      functions.logger.info('Calling Gemini API...');

      // Gemini APIリクエスト
      const imagePart = {
        inlineData: {
          data: fileBuffer.toString('base64'),
          mimeType: mimeType,
        },
      };

      // リトライ処理付きでGemini APIを呼び出し
      const text = await retryWithExponentialBackoff(async () => {
        const result = await model.generateContent([imagePart, prompt]);
        const response = await result.response;
        return response.text();
      });

      functions.logger.info('Gemini API response received');

      // 7. レスポンスをパース
      let extractedData: OcrHistory['extracted_data'];
      try {
        const cleanedText = text.replace(/```json\n?|\n?```/g, '').trim();
        extractedData = JSON.parse(cleanedText);
      } catch (error) {
        functions.logger.error('JSON parsing error:', error);
        await historyRef.update({
          status: 'failed',
          error_message: `Failed to parse Gemini response: ${text.substring(0, 200)}`,
        });
        res.status(500).json({
          success: false,
          error: 'Failed to parse OCR response'
        });
        return;
      }

      // 8. ocr_historyを更新（成功）
      const updateData: Record<string, unknown> = {
        status: 'completed',
        extracted_data: extractedData,
      };

      // 変換された画像のパスがあれば追加（配列形式で保存）
      if (convertedImagePaths && convertedImagePaths.length > 0) {
        updateData.converted_image_paths = convertedImagePaths;
        updateData.page_count = pageCount;
      }

      await historyRef.update(updateData);

      functions.logger.info(`OCR processing completed: history_id=${historyRef.id}`);

      // 9. 成功レスポンスを返す
      res.status(200).json({
        success: true,
        history_id: historyRef.id,
        extracted_data: extractedData,
      });

    } catch (error) {
      functions.logger.error('OCR API error:', error);

      // ユーザーフレンドリーなエラーメッセージを生成
      let userMessage = 'OCR processing failed';
      const errorMessage = error instanceof Error ? error.message : 'Internal server error';

      if (errorMessage.includes('overloaded') || errorMessage.includes('503')) {
        userMessage = 'AI API is overloaded. Automatic retry was performed but could not complete the process. Please try again later.';
      } else if (errorMessage.includes('429') || errorMessage.includes('quota')) {
        userMessage = 'API rate limit exceeded. Please try again later.';
      } else if (errorMessage.includes('500')) {
        userMessage = 'AI API error occurred. Automatic retry was performed but could not complete the process. Please try again later.';
      }

      res.status(500).json({
        success: false,
        error: userMessage,
        details: errorMessage,
      });
    }
  }
);

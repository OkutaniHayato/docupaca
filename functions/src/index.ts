import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { defineSecret } from 'firebase-functions/params';
import * as crypto from 'crypto';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore - canvas types not available in dev environment
import { createCanvas } from 'canvas';
import sharp from 'sharp';

// Firebase Admin初期化
admin.initializeApp();

// Gemini APIキーをSecret Managerから取得
const geminiApiKey = defineSecret('GEMINI_API_KEY');

// Firestore, Storageインスタンス
const db = admin.firestore();
const storage = admin.storage();

/**
 * PDFファイルを画像（PNG）に変換する関数
 * @param pdfBuffer PDFファイルのBuffer
 * @returns PNG画像のBuffer
 */
async function convertPdfToImage(pdfBuffer: Buffer): Promise<Buffer> {
  try {
    // PDFドキュメントをロード
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
    });

    const pdfDocument = await loadingTask.promise;

    // 最初のページを取得
    const page = await pdfDocument.getPage(1);

    // ビューポートを設定（スケール2で高解像度）
    const viewport = page.getViewport({ scale: 2.0 });

    // Canvasを作成
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');

    // ページをCanvasにレンダリング
    const renderContext = {
      canvasContext: context as any,
      viewport: viewport,
    };

    await page.render(renderContext).promise;

    // CanvasをPNGバッファに変換
    const pngBuffer = canvas.toBuffer('image/png');

    // sharpで最適化（ファイルサイズを削減）
    const optimizedBuffer = await sharp(pngBuffer)
      .png({ quality: 90, compressionLevel: 9 })
      .toBuffer();

    return optimizedBuffer;
  } catch (error) {
    functions.logger.error('PDF to image conversion error:', error);
    throw new Error(`PDFの画像変換に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
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

// OCR設定のデータ型
interface OcrSetting {
  name: string;
  owner_id: string;
  prompt_text: string;
  extraction_fields: Array<{
    name: string;
    instruction: string;
  }>;
  model_name: string;
  created_at: admin.firestore.Timestamp;
}

// OCR履歴のデータ型
interface OcrHistory {
  setting_id: string;
  status: 'processing' | 'completed' | 'failed';
  original_file_path: string;
  extracted_data?: {
    [key: string]: {
      value: string;
      bbox: [number, number, number, number];
    };
  };
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
      let convertedImagePath: string | undefined;
      if (mimeType === 'application/pdf' || file_path.toLowerCase().endsWith('.pdf')) {
        functions.logger.info('PDFを画像に変換中...');

        try {
          // PDFを画像に変換
          const imageBuffer = await convertPdfToImage(fileBuffer);

          // 変換した画像をCloud Storageに保存
          const imagePath = file_path.replace(/\.pdf$/i, '_converted.png');
          const imageFile = bucket.file(imagePath);

          await imageFile.save(imageBuffer, {
            metadata: {
              contentType: 'image/png',
            },
          });

          convertedImagePath = imagePath;
          functions.logger.info(`画像変換成功: ${imagePath}`);
        } catch (conversionError) {
          functions.logger.warn('PDF to image conversion failed:', conversionError);
          // 変換に失敗してもOCR処理は続行
        }
      }

      // 4. Gemini APIで処理
      const apiKey = geminiApiKey.value();
      if (!apiKey) {
        throw new Error('GEMINI_API_KEYが設定されていません');
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: setting.model_name });

      // プロンプト作成
      const extractionFieldsDescription = setting.extraction_fields
        .map(field => `- ${field.name}: ${field.instruction}`)
        .join('\n');

      const prompt = `${setting.prompt_text}

【抽出項目】
${extractionFieldsDescription}

【出力形式】
以下のJSON形式で出力してください。JSONのみを出力し、他の説明文は含めないでください。

{
  "${setting.extraction_fields[0]?.name || 'fieldName'}": {
    "value": "抽出された値",
    "bbox": [x1, y1, x2, y2]
  }
}

各フィールドについて、valueには抽出された値を、bboxには該当箇所の座標を[左上x, 左上y, 右下x, 右下y]の形式で記載してください。
座標が不明な場合は[0, 0, 0, 0]としてください。`;

      functions.logger.info('Gemini API呼び出し開始');

      // Gemini APIリクエスト
      const imagePart = {
        inlineData: {
          data: fileBuffer.toString('base64'),
          mimeType: mimeType,
        },
      };

      const result = await model.generateContent([imagePart, prompt]);
      const response = await result.response;
      const text = response.text();

      functions.logger.info('Gemini API応答受信');

      // 5. レスポンスをパース
      let extractedData: OcrHistory['extracted_data'];
      try {
        // マークダウンのコードブロックを除去
        const cleanedText = text.replace(/```json\n?|\n?```/g, '').trim();
        extractedData = JSON.parse(cleanedText);
      } catch (error) {
        functions.logger.error('JSON解析エラー:', error);
        throw new Error(`Gemini API応答のJSON解析に失敗しました: ${text.substring(0, 200)}`);
      }

      // 6. ocr_historyを更新（成功）
      const updateData: any = {
        status: 'completed',
        extracted_data: extractedData,
      };

      // 変換された画像のパスがあれば追加
      if (convertedImagePath) {
        updateData.converted_image_path = convertedImagePath;
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

      throw new functions.https.HttpsError(
        'internal',
        `OCR処理中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`
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
      let convertedImagePath: string | undefined;
      if (mimeType === 'application/pdf' || storagePath.toLowerCase().endsWith('.pdf')) {
        functions.logger.info('Converting PDF to image...');

        try {
          // PDFを画像に変換
          const imageBuffer = await convertPdfToImage(fileBuffer);

          // 変換した画像をCloud Storageに保存
          const imagePath = storagePath.replace(/\.pdf$/i, '_converted.png');
          const imageFile = bucket.file(imagePath);

          await imageFile.save(imageBuffer, {
            metadata: {
              contentType: 'image/png',
            },
          });

          convertedImagePath = imagePath;
          functions.logger.info(`PDF converted to image: ${imagePath}`);
        } catch (conversionError) {
          functions.logger.warn('PDF to image conversion failed:', conversionError);
          // 変換に失敗してもOCR処理は続行
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

      // プロンプト作成
      const extractionFieldsDescription = setting.extraction_fields
        .map(field => `- ${field.name}: ${field.instruction}`)
        .join('\n');

      const prompt = `${setting.prompt_text}

【抽出項目】
${extractionFieldsDescription}

【出力形式】
以下のJSON形式で出力してください。JSONのみを出力し、他の説明文は含めないでください。

{
  "${setting.extraction_fields[0]?.name || 'fieldName'}": {
    "value": "抽出された値",
    "bbox": [x1, y1, x2, y2]
  }
}

各フィールドについて、valueには抽出された値を、bboxには該当箇所の座標を[左上x, 左上y, 右下x, 右下y]の形式で記載してください。
座標が不明な場合は[0, 0, 0, 0]としてください。`;

      functions.logger.info('Calling Gemini API...');

      // Gemini APIリクエスト
      const imagePart = {
        inlineData: {
          data: fileBuffer.toString('base64'),
          mimeType: mimeType,
        },
      };

      const result = await model.generateContent([imagePart, prompt]);
      const response = await result.response;
      const text = response.text();

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
      const updateData: any = {
        status: 'completed',
        extracted_data: extractedData,
      };

      // 変換された画像のパスがあれば追加
      if (convertedImagePath) {
        updateData.converted_image_path = convertedImagePath;
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
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      });
    }
  }
);

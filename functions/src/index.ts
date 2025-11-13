import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { defineSecret } from 'firebase-functions/params';

// Firebase Admin初期化
admin.initializeApp();

// Gemini APIキーをSecret Managerから取得
const geminiApiKey = defineSecret('GEMINI_API_KEY');

// Firestore, Storageインスタンス
const db = admin.firestore();
const storage = admin.storage();

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
      await historyRef.update({
        status: 'completed',
        extracted_data: extractedData,
      });

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

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PDFDocument } from 'pdf-lib';

// Gemini APIの初期化
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * PDFの最初のページまたは画像を解析して、OCR設定を自動生成するAPI
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'ファイルがアップロードされていません' },
        { status: 400 }
      );
    }

    // ファイルをバッファに変換
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    let imageBase64: string;
    let mimeType: string;

    // PDFの場合は最初のページを画像に変換
    if (file.type === 'application/pdf') {
      try {
        // PDF-libでPDFを読み込み
        const pdfDoc = await PDFDocument.load(buffer);
        const pages = pdfDoc.getPages();

        if (pages.length === 0) {
          return NextResponse.json(
            { error: 'PDFにページが含まれていません' },
            { status: 400 }
          );
        }

        // PDFの場合は、バイナリデータをそのままbase64エンコード
        // Gemini APIはPDFを直接サポート
        imageBase64 = buffer.toString('base64');
        mimeType = 'application/pdf';
      } catch (error) {
        console.error('PDF処理エラー:', error);
        return NextResponse.json(
          { error: 'PDFの処理中にエラーが発生しました' },
          { status: 500 }
        );
      }
    } else if (file.type.startsWith('image/')) {
      // 画像の場合はそのままbase64エンコード
      imageBase64 = buffer.toString('base64');
      mimeType = file.type;
    } else {
      return NextResponse.json(
        { error: 'サポートされていないファイル形式です。画像またはPDFをアップロードしてください。' },
        { status: 400 }
      );
    }

    // Gemini Vision APIで画像を解析
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    const prompt = `以下の帳票画像を解析して、OCR抽出設定を生成してください。

【出力形式】
以下のJSON形式で出力してください。JSONのみを出力し、他の説明文は含めないでください。

{
  "documentName": "帳票の種類名（例：請求書、納品書、領収書など）",
  "extractionInstruction": "この帳票から抽出する際の全体的な指示（例：発行日、会社名、金額などの主要項目を抽出してください）",
  "extractionFields": [
    {
      "name": "フィールド名（英数字、キャメルケース）",
      "instruction": "このフィールドの抽出指示（例：請求書の発行日）"
    }
  ]
}

【ルール】
1. documentNameは日本語で帳票の種類を簡潔に表現
2. extractionInstructionは全体的な抽出方針を日本語で記述
3. extractionFieldsには最低5個、最大15個程度の重要なフィールドを含める
4. フィールド名(name)は英語のキャメルケース（例：issueDate, companyName, totalAmount）
5. 各フィールドのinstructionは日本語で具体的に記述
6. 帳票の種類に応じて適切なフィールドを抽出（日付、金額、会社名、住所など）
7. JSONのみを出力し、マークダウンのコードブロック（\`\`\`json）は使用しない

それでは、この帳票を解析して上記形式のJSONを生成してください。`;

    const result = await model.generateContent([
      {
        inlineData: {
          data: imageBase64,
          mimeType: mimeType,
        },
      },
      prompt,
    ]);

    const response = await result.response;
    const text = response.text();

    // JSONをパース
    let analysisResult;
    try {
      // マークダウンのコードブロックを除去
      const cleanedText = text.replace(/```json\n?|\n?```/g, '').trim();
      analysisResult = JSON.parse(cleanedText);
    } catch (error) {
      console.error('JSON解析エラー:', error);
      console.error('Gemini APIレスポンス:', text);
      return NextResponse.json(
        { error: 'AI応答の解析に失敗しました', rawResponse: text },
        { status: 500 }
      );
    }

    // 結果を検証
    if (
      !analysisResult.documentName ||
      !analysisResult.extractionInstruction ||
      !Array.isArray(analysisResult.extractionFields)
    ) {
      return NextResponse.json(
        { error: '不正なAI応答形式です', rawResponse: text },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        documentName: analysisResult.documentName,
        extractionInstruction: analysisResult.extractionInstruction,
        extractionFields: analysisResult.extractionFields,
      },
    });
  } catch (error) {
    console.error('API処理エラー:', error);
    return NextResponse.json(
      {
        error: '処理中にエラーが発生しました',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

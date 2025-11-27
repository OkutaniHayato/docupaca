import { NextRequest, NextResponse } from 'next/server';

/**
 * テンプレート候補情報（入力用）
 */
interface TemplateInfo {
  id: string;
  name: string;
  displayName?: string;
  templateType?: string;
  exampleKeywords?: string[];
}

/**
 * AI判定結果
 */
interface DetectionResult {
  predictedTemplateId: string | null;
  predictedConfidence: number;
  candidates: Array<{
    id: string;
    confidence: number;
  }>;
}

/**
 * アップロードされた帳票ファイルを解析して、最適なテンプレートを判定するAPI
 *
 * 入力:
 * - file: 帳票ファイル（画像またはPDF）
 * - templates: テンプレート情報の配列（JSON文字列）
 *
 * 出力:
 * - predictedTemplateId: 推定されたテンプレートID（判定不能時はnull）
 * - predictedConfidence: 推定の信頼度（0-1）
 * - candidates: 候補一覧（id + confidence）
 */
export async function POST(request: NextRequest) {
  try {
    // 動的インポート
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const { PDFDocument } = await import('pdf-lib');

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const templatesJson = formData.get('templates') as string;

    // バリデーション
    if (!file) {
      return NextResponse.json(
        { error: 'ファイルがアップロードされていません' },
        { status: 400 }
      );
    }

    if (!templatesJson) {
      return NextResponse.json(
        { error: 'テンプレート情報が指定されていません' },
        { status: 400 }
      );
    }

    let templates: TemplateInfo[];
    try {
      templates = JSON.parse(templatesJson);
    } catch {
      return NextResponse.json(
        { error: 'テンプレート情報の解析に失敗しました' },
        { status: 400 }
      );
    }

    if (!Array.isArray(templates) || templates.length === 0) {
      return NextResponse.json(
        { error: 'テンプレートが登録されていません' },
        { status: 400 }
      );
    }

    // ファイルをバッファに変換
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    let imageBase64: string;
    let mimeType: string;

    // PDFの場合は最初のページのみ使用
    if (file.type === 'application/pdf') {
      try {
        const pdfDoc = await PDFDocument.load(buffer);
        const pages = pdfDoc.getPages();

        if (pages.length === 0) {
          return NextResponse.json(
            { error: 'PDFにページが含まれていません' },
            { status: 400 }
          );
        }

        // PDFをそのまま使用（Gemini APIはPDFをサポート）
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
      imageBase64 = buffer.toString('base64');
      mimeType = file.type;
    } else {
      return NextResponse.json(
        { error: 'サポートされていないファイル形式です。画像またはPDFをアップロードしてください。' },
        { status: 400 }
      );
    }

    // Gemini APIキーを取得
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEYが設定されていません' },
        { status: 500 }
      );
    }

    // テンプレート情報を整形
    const templateDescriptions = templates.map((t, index) => {
      const parts = [
        `テンプレート${index + 1}:`,
        `  ID: ${t.id}`,
        `  名前: ${t.displayName || t.name}`,
      ];
      if (t.templateType) {
        parts.push(`  種類: ${t.templateType}`);
      }
      if (t.exampleKeywords && t.exampleKeywords.length > 0) {
        parts.push(`  キーワード: ${t.exampleKeywords.join(', ')}`);
      }
      return parts.join('\n');
    }).join('\n\n');

    const templateIdList = templates.map(t => t.id).join(', ');

    // Gemini APIで判定
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    const prompt = `以下の帳票画像を解析して、登録済みテンプレートの中から最も適切なものを判定してください。

【登録済みテンプレート一覧】
${templateDescriptions}

【出力形式】
以下のJSON形式で出力してください。JSONのみを出力し、他の説明文は含めないでください。

{
  "predictedTemplateId": "最も適切なテンプレートのID、または判定不能の場合はnull",
  "predictedConfidence": 信頼度（0-1の小数、1が最も確信がある）,
  "candidates": [
    { "id": "テンプレートID", "confidence": 信頼度 },
    ...（信頼度の高い順に最大5つ）
  ],
  "reasoning": "判定理由（日本語、100文字以内）"
}

【判定ルール】
1. 帳票の種類（請求書、見積書、注文書など）を特定する
2. テンプレートの「種類」や「キーワード」と帳票内のテキストを照合する
3. 帳票内に含まれるキーワード（タイトル、固定ラベル）を重視する
4. 信頼度は以下の基準で設定:
   - 0.9以上: キーワードが複数一致、または明確な種類一致
   - 0.7-0.9: 種類は一致するが細部が不明
   - 0.5-0.7: 類似しているが確信が持てない
   - 0.5未満: 該当するテンプレートがない可能性が高い
5. 適切なテンプレートが見つからない場合、predictedTemplateIdをnullとし、candidatesは空配列
6. candidatesには利用可能なテンプレートIDのみを含める（利用可能: ${templateIdList}）

それでは、この帳票を解析してテンプレートを判定してください。`;

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
    let detectionResult: DetectionResult & { reasoning?: string };
    try {
      const cleanedText = text.replace(/```json\n?|\n?```/g, '').trim();
      detectionResult = JSON.parse(cleanedText);
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
      !('predictedTemplateId' in detectionResult) ||
      typeof detectionResult.predictedConfidence !== 'number' ||
      !Array.isArray(detectionResult.candidates)
    ) {
      return NextResponse.json(
        { error: '不正なAI応答形式です', rawResponse: text },
        { status: 500 }
      );
    }

    // predictedTemplateIdが有効なテンプレートIDか確認
    const validIds = new Set(templates.map(t => t.id));
    if (detectionResult.predictedTemplateId && !validIds.has(detectionResult.predictedTemplateId)) {
      // 無効なIDの場合、candidatesから最も信頼度の高い有効なIDを使用
      const validCandidate = detectionResult.candidates.find(c => validIds.has(c.id));
      if (validCandidate) {
        detectionResult.predictedTemplateId = validCandidate.id;
        detectionResult.predictedConfidence = validCandidate.confidence;
      } else {
        detectionResult.predictedTemplateId = null;
        detectionResult.predictedConfidence = 0;
      }
    }

    // candidatesから無効なIDを除外
    detectionResult.candidates = detectionResult.candidates.filter(c => validIds.has(c.id));

    return NextResponse.json({
      success: true,
      data: {
        predictedTemplateId: detectionResult.predictedTemplateId,
        predictedConfidence: detectionResult.predictedConfidence,
        candidates: detectionResult.candidates,
        reasoning: detectionResult.reasoning,
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

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/config/firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * PDFファイルからテキストを抽出
 */
async function parsePdf(buffer: Buffer): Promise<string> {
  try {
    // 動的インポートでpdf-parseを読み込み
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(buffer);
    return data.text.trim();
  } catch (error) {
    console.error('PDF解析エラー:', error);
    throw new Error('PDFファイルの解析に失敗しました');
  }
}

/**
 * Excelファイルからテキストを抽出
 */
async function parseExcel(buffer: Buffer): Promise<string> {
  try {
    // 動的インポートでxlsxを読み込み
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const results: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });

      if (data.trim()) {
        results.push(`## シート: ${sheetName}\n\n${data}`);
      }
    }

    return results.join('\n\n');
  } catch (error) {
    console.error('Excel解析エラー:', error);
    throw new Error('Excelファイルの解析に失敗しました');
  }
}

/**
 * CSVファイルからテキストを抽出（マークダウンテーブル形式に変換）
 */
async function parseCsv(buffer: Buffer): Promise<string> {
  try {
    const content = buffer.toString('utf-8');

    // 動的インポートでcsv-parseを読み込み
    const { parse: csvParse } = await import('csv-parse/sync');

    // CSVをパース
    const records = csvParse(content, {
      skip_empty_lines: true,
      relax_column_count: true,
    }) as string[][];

    if (records.length === 0) {
      return '';
    }

    // マークダウンテーブル形式に変換
    const header = records[0];
    const rows = records.slice(1);

    let markdown = '| ' + header.join(' | ') + ' |\n';
    markdown += '| ' + header.map(() => '---').join(' | ') + ' |\n';

    for (const row of rows) {
      // 列数を揃える
      while (row.length < header.length) {
        row.push('');
      }
      markdown += '| ' + row.slice(0, header.length).join(' | ') + ' |\n';
    }

    return markdown;
  } catch (error) {
    console.error('CSV解析エラー:', error);
    // フォールバック：生のテキストとして返す
    return buffer.toString('utf-8');
  }
}

/**
 * 画像ファイルからテキストを抽出（Gemini OCR使用）
 */
async function parseImage(buffer: Buffer, mimeType: string): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEYが設定されていません');
  }

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const base64Data = buffer.toString('base64');

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: mimeType,
          data: base64Data,
        },
      },
      {
        text: `この画像に含まれるテキストを全て抽出してください。

以下のルールに従ってください：
1. 表形式のデータがある場合は、マークダウンのテーブル形式で出力
2. 箇条書きがある場合は、マークダウンのリスト形式で出力
3. 見出しがある場合は、マークダウンの見出し形式で出力
4. 元の構造をできるだけ維持する
5. 読み取れない部分は [読み取り不可] と記載

テキストのみを出力し、説明や補足は不要です。`,
      },
    ]);

    const response = result.response;
    return response.text().trim();
  } catch (error) {
    console.error('画像OCRエラー:', error);
    throw new Error('画像からのテキスト抽出に失敗しました');
  }
}

/**
 * Firebase StorageからファイルをダウンロードしてBufferとして取得
 */
async function downloadFileFromStorage(fileUrl: string): Promise<Buffer> {
  try {
    // Firebase Storage の公開URLは直接HTTPでダウンロード可能
    // (アクセストークンがURL内に含まれているため)
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`ファイルのダウンロードに失敗しました: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error('ファイルダウンロードエラー:', error);
    throw new Error('ファイルのダウンロードに失敗しました');
  }
}

/**
 * MIMEタイプに基づいてファイルを解析
 */
async function parseFileByMimeType(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<string> {
  // ファイルサイズチェック
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error('ファイルサイズが上限（10MB）を超えています');
  }

  switch (mimeType) {
    case 'application/pdf':
      return await parsePdf(buffer);

    case 'application/vnd.ms-excel':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return await parseExcel(buffer);

    case 'text/csv':
      return await parseCsv(buffer);

    case 'image/png':
    case 'image/jpeg':
    case 'image/webp':
      return await parseImage(buffer, mimeType);

    default:
      // 拡張子で判定
      const ext = fileName.toLowerCase().split('.').pop();
      switch (ext) {
        case 'pdf':
          return await parsePdf(buffer);
        case 'xlsx':
        case 'xls':
          return await parseExcel(buffer);
        case 'csv':
          return await parseCsv(buffer);
        case 'png':
        case 'jpg':
        case 'jpeg':
        case 'webp':
          return await parseImage(buffer, `image/${ext === 'jpg' ? 'jpeg' : ext}`);
        default:
          throw new Error(`サポートされていないファイル形式です: ${mimeType}`);
      }
  }
}

/**
 * ナレッジファイル解析APIエンドポイント
 */
export async function POST(request: NextRequest) {
  try {
    // 認証チェック
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: '認証が必要です' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    try {
      await adminAuth().verifyIdToken(token);
    } catch {
      return NextResponse.json(
        { success: false, error: '無効な認証トークンです' },
        { status: 401 }
      );
    }

    // リクエストボディの検証
    const body = await request.json();
    const { fileUrl, fileName, mimeType, orgId } = body;

    if (!fileUrl || !fileName || !mimeType || !orgId) {
      return NextResponse.json(
        { success: false, error: 'fileUrl, fileName, mimeType, orgId は必須です' },
        { status: 400 }
      );
    }

    console.log(`ファイル解析開始: ${fileName} (${mimeType})`);

    // ファイルをダウンロード
    const buffer = await downloadFileFromStorage(fileUrl);
    console.log(`ファイルダウンロード完了: ${buffer.length} bytes`);

    // ファイルを解析
    const content = await parseFileByMimeType(buffer, mimeType, fileName);
    console.log(`ファイル解析完了: ${content.length} 文字`);

    if (!content.trim()) {
      return NextResponse.json(
        { success: false, error: 'ファイルからテキストを抽出できませんでした' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      content: content,
      stats: {
        fileName,
        mimeType,
        fileSize: buffer.length,
        extractedLength: content.length,
      },
    });
  } catch (error) {
    console.error('ファイル解析エラー:', error);
    const errorMessage = error instanceof Error ? error.message : 'ファイル解析に失敗しました';
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

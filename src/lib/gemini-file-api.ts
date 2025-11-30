/**
 * Gemini File API ユーティリティ
 *
 * ナレッジデータをGemini File APIにアップロード・管理するための関数群
 * https://ai.google.dev/gemini-api/docs/files
 */

import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

/**
 * FileManagerインスタンスを取得
 */
function getFileManager(): GoogleAIFileManager {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY が設定されていません');
  }
  return new GoogleAIFileManager(GEMINI_API_KEY);
}

/**
 * Gemini File APIのファイル情報
 */
export interface GeminiFileInfo {
  name: string;           // files/xxx 形式
  displayName: string;    // 表示名
  mimeType: string;
  sizeBytes: string;
  createTime: string;
  updateTime: string;
  expirationTime: string; // 48時間後に自動削除
  sha256Hash: string;
  uri: string;
  state: FileState;
}

/**
 * テキストコンテンツをGemini File APIにアップロード
 *
 * @param content テキストコンテンツ
 * @param displayName 表示名（ナレッジのタイトル）
 * @param docId ドキュメントID（ファイル名に使用）
 * @returns アップロードされたファイル情報
 */
export async function uploadTextContent(
  content: string,
  displayName: string,
  docId: string
): Promise<GeminiFileInfo> {
  const fileManager = getFileManager();

  // 一時ファイルに書き出し
  const tempFilePath = join(tmpdir(), `knowledge_${docId}_${Date.now()}.txt`);

  try {
    writeFileSync(tempFilePath, content, 'utf-8');

    const uploadResult = await fileManager.uploadFile(tempFilePath, {
      mimeType: 'text/plain',
      displayName: `${displayName} (${docId})`,
    });

    return uploadResult.file as GeminiFileInfo;
  } finally {
    // 一時ファイルを削除
    try {
      unlinkSync(tempFilePath);
    } catch {
      // 削除エラーは無視
    }
  }
}

/**
 * ファイルをGemini File APIにアップロード（バイナリ）
 *
 * @param buffer ファイルのBuffer
 * @param mimeType MIMEタイプ
 * @param displayName 表示名
 * @returns アップロードされたファイル情報
 */
export async function uploadFileBuffer(
  buffer: Buffer,
  mimeType: string,
  displayName: string
): Promise<GeminiFileInfo> {
  const fileManager = getFileManager();

  // MIMEタイプから拡張子を決定
  const extMap: Record<string, string> = {
    'text/plain': '.txt',
    'application/pdf': '.pdf',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'text/csv': '.csv',
  };
  const ext = extMap[mimeType] || '.bin';

  // 一時ファイルに書き出し
  const tempFilePath = join(tmpdir(), `upload_${Date.now()}${ext}`);

  try {
    writeFileSync(tempFilePath, buffer);

    const uploadResult = await fileManager.uploadFile(tempFilePath, {
      mimeType,
      displayName,
    });

    return uploadResult.file as GeminiFileInfo;
  } finally {
    // 一時ファイルを削除
    try {
      unlinkSync(tempFilePath);
    } catch {
      // 削除エラーは無視
    }
  }
}

/**
 * Gemini File APIのファイル一覧を取得
 *
 * @param pageSize 1ページあたりの件数（デフォルト: 100）
 * @param pageToken ページトークン（次ページ取得用）
 * @returns ファイル一覧とページトークン
 */
export async function listFiles(
  pageSize: number = 100,
  pageToken?: string
): Promise<{ files: GeminiFileInfo[]; nextPageToken?: string }> {
  const fileManager = getFileManager();

  const result = await fileManager.listFiles({
    pageSize,
    pageToken,
  });

  return {
    files: (result.files || []) as GeminiFileInfo[],
    nextPageToken: result.nextPageToken,
  };
}

/**
 * 特定のファイル情報を取得
 *
 * @param fileName ファイル名（files/xxx 形式）
 * @returns ファイル情報
 */
export async function getFile(fileName: string): Promise<GeminiFileInfo> {
  const fileManager = getFileManager();

  const result = await fileManager.getFile(fileName);
  return result as GeminiFileInfo;
}

/**
 * ファイルを削除
 *
 * @param fileName ファイル名（files/xxx 形式）
 */
export async function deleteFile(fileName: string): Promise<void> {
  const fileManager = getFileManager();
  await fileManager.deleteFile(fileName);
}

/**
 * 複数ファイルを一括削除
 *
 * @param fileNames ファイル名の配列
 * @returns 削除結果（成功/失敗）
 */
export async function deleteFiles(
  fileNames: string[]
): Promise<{ success: string[]; failed: Array<{ name: string; error: string }> }> {
  const fileManager = getFileManager();
  const success: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  for (const fileName of fileNames) {
    try {
      await fileManager.deleteFile(fileName);
      success.push(fileName);
    } catch (error) {
      failed.push({
        name: fileName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return { success, failed };
}

/**
 * ファイルの処理状態を待機
 *
 * @param fileName ファイル名
 * @param maxWaitMs 最大待機時間（ミリ秒）
 * @returns 処理完了したファイル情報
 */
export async function waitForFileProcessing(
  fileName: string,
  maxWaitMs: number = 30000
): Promise<GeminiFileInfo> {
  const fileManager = getFileManager();
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const file = await fileManager.getFile(fileName);

    if (file.state === FileState.ACTIVE) {
      return file as GeminiFileInfo;
    }

    if (file.state === FileState.FAILED) {
      throw new Error(`ファイル処理に失敗しました: ${fileName}`);
    }

    // 1秒待機
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error(`ファイル処理がタイムアウトしました: ${fileName}`);
}

/**
 * 組織のナレッジに関連するファイルを検索
 * displayNameにorgIdが含まれるファイルを返す
 *
 * @param orgId 組織ID
 * @returns 関連ファイル一覧
 */
export async function findFilesByOrgId(orgId: string): Promise<GeminiFileInfo[]> {
  const allFiles: GeminiFileInfo[] = [];
  let pageToken: string | undefined;

  do {
    const result = await listFiles(100, pageToken);

    // displayNameにorgIdを含むファイルをフィルタ
    const orgFiles = result.files.filter(file =>
      file.displayName?.includes(`org:${orgId}`) ||
      file.displayName?.includes(`(${orgId})`)
    );

    allFiles.push(...orgFiles);
    pageToken = result.nextPageToken;
  } while (pageToken);

  return allFiles;
}

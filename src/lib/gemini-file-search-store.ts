/**
 * Gemini File Search Stores API ユーティリティ
 *
 * RAG機能を提供するFile Search Stores APIのクライアント
 * https://ai.google.dev/gemini-api/docs/file-search
 *
 * 構造:
 * - FileSearchStore: ドキュメントのコレクション（組織ごとに1つ）
 * - Document: チャンクのコレクション（ナレッジ1件に対応）
 */

import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * FileSearchStore の情報
 */
export interface FileSearchStore {
  name: string; // fileSearchStores/xxx
  displayName?: string;
  createTime?: string;
  updateTime?: string;
  activeDocumentsCount?: string;
  pendingDocumentsCount?: string;
  failedDocumentsCount?: string;
  sizeBytes?: string;
}

/**
 * Document の状態
 */
export type DocumentState =
  | 'STATE_UNSPECIFIED'
  | 'STATE_PENDING'
  | 'STATE_ACTIVE'
  | 'STATE_FAILED';

/**
 * Document の情報
 */
export interface FileSearchDocument {
  name: string; // fileSearchStores/xxx/documents/yyy
  displayName?: string;
  customMetadata?: Array<{
    key: string;
    stringValue?: string;
    numericValue?: number;
  }>;
  createTime?: string;
  updateTime?: string;
  state?: DocumentState;
  sizeBytes?: string;
  mimeType?: string;
}

/**
 * API リクエストのヘルパー
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY が設定されていません');
  }

  const url = `${BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error (${response.status}): ${errorText}`);
  }

  // DELETE の場合は空レスポンス
  if (response.status === 204 || options.method === 'DELETE') {
    return {} as T;
  }

  return response.json();
}

// ============================================
// FileSearchStore 操作
// ============================================

/**
 * FileSearchStore を作成
 *
 * @param displayName 表示名
 * @returns 作成された FileSearchStore
 */
export async function createFileSearchStore(
  displayName: string
): Promise<FileSearchStore> {
  return apiRequest<FileSearchStore>('/fileSearchStores', {
    method: 'POST',
    body: JSON.stringify({ displayName }),
  });
}

/**
 * FileSearchStore を取得
 *
 * @param storeName Store名（fileSearchStores/xxx）
 * @returns FileSearchStore 情報
 */
export async function getFileSearchStore(
  storeName: string
): Promise<FileSearchStore> {
  return apiRequest<FileSearchStore>(`/${storeName}`);
}

/**
 * FileSearchStore 一覧を取得
 *
 * @param pageSize ページサイズ
 * @param pageToken ページトークン
 * @returns Store一覧
 */
export async function listFileSearchStores(
  pageSize: number = 20,
  pageToken?: string
): Promise<{ fileSearchStores: FileSearchStore[]; nextPageToken?: string }> {
  const params = new URLSearchParams({ pageSize: String(pageSize) });
  if (pageToken) params.append('pageToken', pageToken);

  return apiRequest<{
    fileSearchStores: FileSearchStore[];
    nextPageToken?: string;
  }>(`/fileSearchStores?${params.toString()}`);
}

/**
 * FileSearchStore を削除
 *
 * @param storeName Store名
 * @param force ドキュメントも一緒に削除するか
 */
export async function deleteFileSearchStore(
  storeName: string,
  force: boolean = false
): Promise<void> {
  await apiRequest(`/${storeName}?force=${force}`, {
    method: 'DELETE',
  });
}

/**
 * 組織用の FileSearchStore を取得または作成
 *
 * @param orgId 組織ID
 * @param orgName 組織名（新規作成時に使用）
 * @returns FileSearchStore
 */
export async function getOrCreateStoreForOrg(
  orgId: string,
  orgName?: string
): Promise<FileSearchStore> {
  // 既存のStoreを検索
  const { fileSearchStores } = await listFileSearchStores(100);

  const existingStore = fileSearchStores?.find(
    (store) =>
      store.displayName?.includes(`[org:${orgId}]`) ||
      store.name?.includes(orgId)
  );

  if (existingStore) {
    return existingStore;
  }

  // 新規作成
  const displayName = `[org:${orgId}] ${orgName || 'Knowledge Store'}`;
  return createFileSearchStore(displayName);
}

// ============================================
// Document 操作
// ============================================

/**
 * Document 一覧を取得
 *
 * @param storeName Store名
 * @param pageSize ページサイズ
 * @param pageToken ページトークン
 * @returns Document一覧
 */
export async function listDocuments(
  storeName: string,
  pageSize: number = 20,
  pageToken?: string
): Promise<{ documents: FileSearchDocument[]; nextPageToken?: string }> {
  const params = new URLSearchParams({ pageSize: String(pageSize) });
  if (pageToken) params.append('pageToken', pageToken);

  const result = await apiRequest<{
    documents?: FileSearchDocument[];
    nextPageToken?: string;
  }>(`/${storeName}/documents?${params.toString()}`);

  return {
    documents: result.documents || [],
    nextPageToken: result.nextPageToken,
  };
}

/**
 * Document を取得
 *
 * @param documentName Document名
 * @returns Document情報
 */
export async function getDocument(
  documentName: string
): Promise<FileSearchDocument> {
  return apiRequest<FileSearchDocument>(`/${documentName}`);
}

/**
 * Document を削除
 *
 * @param documentName Document名
 * @param force チャンクも削除するか
 */
export async function deleteDocument(
  documentName: string,
  force: boolean = true
): Promise<void> {
  await apiRequest(`/${documentName}?force=${force}`, {
    method: 'DELETE',
  });
}

// ============================================
// アップロード操作
// ============================================

/**
 * テキストコンテンツを FileSearchStore にアップロード
 *
 * @param storeName Store名
 * @param content テキストコンテンツ
 * @param displayName 表示名
 * @param metadata カスタムメタデータ
 * @returns Operation レスポンス
 */
export async function uploadTextToStore(
  storeName: string,
  content: string,
  displayName: string,
  metadata?: Record<string, string>
): Promise<UploadOperationResponse> {
  // 一時ファイルに書き出し
  const tempFilePath = join(tmpdir(), `knowledge_${Date.now()}.txt`);

  try {
    writeFileSync(tempFilePath, content, 'utf-8');

    // multipart/form-data でアップロード
    const formData = new FormData();

    // メタデータ部分
    const metadataObj: {
      displayName: string;
      customMetadata?: Array<{ key: string; stringValue: string }>;
    } = {
      displayName,
    };

    if (metadata) {
      metadataObj.customMetadata = Object.entries(metadata).map(
        ([key, value]) => ({
          key,
          stringValue: value,
        })
      );
    }

    formData.append(
      'metadata',
      new Blob([JSON.stringify(metadataObj)], { type: 'application/json' })
    );

    // ファイル部分
    const fileBlob = new Blob([content], { type: 'text/plain' });
    formData.append('file', fileBlob, 'content.txt');

    const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/${storeName}:uploadToFileSearchStore?key=${GEMINI_API_KEY}`;

    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload Error (${response.status}): ${errorText}`);
    }

    return response.json();
  } finally {
    try {
      unlinkSync(tempFilePath);
    } catch {
      // 削除エラーは無視
    }
  }
}

/**
 * ファイルを FileSearchStore にアップロード
 *
 * @param storeName Store名
 * @param buffer ファイルのBuffer
 * @param mimeType MIMEタイプ
 * @param displayName 表示名
 * @param metadata カスタムメタデータ
 * @returns Operation レスポンス
 */
export async function uploadFileToStore(
  storeName: string,
  buffer: Buffer,
  mimeType: string,
  displayName: string,
  metadata?: Record<string, string>
): Promise<UploadOperationResponse> {
  const formData = new FormData();

  // メタデータ部分
  const metadataObj: {
    displayName: string;
    mimeType: string;
    customMetadata?: Array<{ key: string; stringValue: string }>;
  } = {
    displayName,
    mimeType,
  };

  if (metadata) {
    metadataObj.customMetadata = Object.entries(metadata).map(
      ([key, value]) => ({
        key,
        stringValue: value,
      })
    );
  }

  formData.append(
    'metadata',
    new Blob([JSON.stringify(metadataObj)], { type: 'application/json' })
  );

  // ファイル部分
  const uint8Array = new Uint8Array(buffer);
  const fileBlob = new Blob([uint8Array], { type: mimeType });

  // 拡張子を決定
  const extMap: Record<string, string> = {
    'text/plain': '.txt',
    'application/pdf': '.pdf',
    'image/png': '.png',
    'image/jpeg': '.jpg',
  };
  const ext = extMap[mimeType] || '.bin';

  formData.append('file', fileBlob, `content${ext}`);

  const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/${storeName}:uploadToFileSearchStore?key=${GEMINI_API_KEY}`;

  const response = await fetch(uploadUrl, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upload Error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * アップロード Operation のレスポンス
 */
export interface UploadOperationResponse {
  name: string; // operations/xxx
  metadata?: Record<string, unknown>;
  done: boolean;
  error?: {
    code: number;
    message: string;
  };
  response?: {
    '@type': string;
    name: string; // fileSearchStores/xxx/documents/yyy
    displayName?: string;
  };
}

/**
 * Operation の状態を取得
 *
 * @param operationName Operation名（フルパス）
 * @returns Operation レスポンス
 */
export async function getOperation(
  operationName: string
): Promise<UploadOperationResponse> {
  // operationName は fileSearchStores/xxx/upload/operations/yyy の形式
  return apiRequest<UploadOperationResponse>(`/${operationName}`);
}

/**
 * アップロード完了を待機
 *
 * @param operationName Operation名
 * @param maxWaitMs 最大待機時間
 * @returns 完了した Operation
 */
export async function waitForUpload(
  operationName: string,
  maxWaitMs: number = 60000
): Promise<UploadOperationResponse> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const operation = await getOperation(operationName);

    if (operation.done) {
      if (operation.error) {
        throw new Error(
          `Upload failed: ${operation.error.message} (code: ${operation.error.code})`
        );
      }
      return operation;
    }

    // 2秒待機
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`Upload timed out: ${operationName}`);
}

// ============================================
// ヘルパー関数
// ============================================

/**
 * Store名からStore IDを抽出
 */
export function extractStoreId(storeName: string): string {
  return storeName.replace('fileSearchStores/', '');
}

/**
 * Document名からDocument IDを抽出
 */
export function extractDocumentId(documentName: string): string {
  const parts = documentName.split('/');
  return parts[parts.length - 1];
}

/**
 * カスタムメタデータからdocIdを取得
 */
export function getDocIdFromMetadata(
  doc: FileSearchDocument
): string | undefined {
  const meta = doc.customMetadata?.find((m) => m.key === 'docId');
  return meta?.stringValue;
}

/**
 * カスタムメタデータからorgIdを取得
 */
export function getOrgIdFromMetadata(
  doc: FileSearchDocument
): string | undefined {
  const meta = doc.customMetadata?.find((m) => m.key === 'orgId');
  return meta?.stringValue;
}

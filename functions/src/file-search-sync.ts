/**
 * Gemini File Search 同期機能
 *
 * 組織のナレッジドキュメントをGemini File Searchに同期するための機能群
 *
 * NOTE: 現在のGemini API SDK (@google/generative-ai) では File Search (vector store) の
 * 直接操作はサポートされていないため、本実装では同期状態の管理とコンテンツのフォーマットを行い、
 * 実際のFile Search APIコールは将来のSDK更新時に有効化する想定です。
 * 現時点ではファイル内容をFirestoreに保存し、プロンプトに直接埋め込む方式を使用します。
 */

import * as functions from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { defineSecret } from 'firebase-functions/params';

// Gemini APIキーをSecret Managerから取得
const geminiApiKey = defineSecret('GEMINI_API_KEY');

// Firestore インスタンス
const db = admin.firestore();

// =====================================================
// 型定義
// =====================================================

/**
 * 組織学習ドキュメントのタイプ
 */
type OrgLearningDocType =
  | 'rule'
  | 'customer_master'
  | 'item_master'
  | 'account_master'
  | 'tax_master'
  | 'department_master'
  | 'exception'
  | 'other';

/**
 * 組織学習ドキュメント
 */
interface OrgLearningDoc {
  orgId: string;
  type: OrgLearningDocType;
  title: string;
  content: string;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
  createdBy: string;
  updatedBy?: string;
  fileId?: string;
  syncedAt?: admin.firestore.Timestamp;
  syncStatus?: 'pending' | 'syncing' | 'synced' | 'failed';
  syncError?: string;
  syncRetryCount?: number;
}

/**
 * 組織データ
 */
interface Organization {
  name: string;
  description?: string;
  owner_id: string;
  fileSearchStoreId?: string;
  created_at: admin.firestore.Timestamp;
  updated_at?: admin.firestore.Timestamp;
}

/**
 * 同期履歴
 */
interface OrgLearningSyncHistory {
  orgId: string;
  executedAt: admin.firestore.Timestamp;
  executionType: 'manual' | 'scheduled' | 'on_update';
  stats: {
    totalDocs: number;
    syncedDocs: number;
    failedDocs: number;
    skippedDocs: number;
  };
  durationMs: number;
  syncedDocIds: string[];
  failedDocs: Array<{
    docId: string;
    error: string;
  }>;
  error?: string;
}

// =====================================================
// 制限値・設定
// =====================================================

/**
 * File Search の制限値
 */
const FILE_SEARCH_LIMITS = {
  /** 1ファイルの最大サイズ（バイト）: 100MB */
  MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024,
  /** 1ストアあたりの最大ファイル数 */
  MAX_FILES_PER_STORE: 10000,
  /** ファイル名の最大長 */
  MAX_DISPLAY_NAME_LENGTH: 128,
  /** 同期のリトライ最大回数 */
  MAX_RETRY_COUNT: 3,
  /** プロンプトに埋め込むナレッジの最大文字数 */
  MAX_KNOWLEDGE_CHARS: 50000,
};

// =====================================================
// ヘルパー関数
// =====================================================

/**
 * 組織ごとのFile Search ストアIDを保証する
 * ストアが未割り当ての場合は新規作成して割り当て
 *
 * @param orgId 組織ID
 * @returns ストアID（例: org_<orgId>_rules）
 */
export async function ensureOrgStore(orgId: string): Promise<string> {
  const orgRef = db.collection('organizations').doc(orgId);
  const orgSnap = await orgRef.get();

  if (!orgSnap.exists) {
    throw new Error(`Organization not found: ${orgId}`);
  }

  const org = orgSnap.data() as Organization;

  // 既存のストアIDがあればそれを返す
  if (org.fileSearchStoreId) {
    functions.logger.info(`Using existing store: ${org.fileSearchStoreId}`, { orgId });
    return org.fileSearchStoreId;
  }

  // 新規ストアIDを生成して保存
  // 命名規則: org_<orgId>_rules
  const storeId = `org_${orgId}_rules`;

  await orgRef.update({
    fileSearchStoreId: storeId,
    updated_at: admin.firestore.Timestamp.now(),
  });

  functions.logger.info(`Created new store ID: ${storeId}`, { orgId });
  return storeId;
}

/**
 * ドキュメントタイプの日本語ラベルを取得
 */
function getTypeLabel(type: OrgLearningDocType): string {
  const labels: Record<OrgLearningDocType, string> = {
    rule: '業務ルール',
    customer_master: '顧客マスタ',
    item_master: '品目マスタ',
    account_master: '勘定科目マスタ',
    tax_master: '税区分マスタ',
    department_master: '部門マスタ',
    exception: '例外ルール',
    other: 'その他',
  };
  return labels[type] || type;
}

/**
 * 学習ドキュメントをFile Search用のコンテンツに変換
 */
function formatDocumentContent(doc: OrgLearningDoc): string {
  const typeLabel = getTypeLabel(doc.type);
  return `# ${doc.title}

[TYPE: ${typeLabel}]

${doc.content}`;
}

/**
 * バイト数でコンテンツサイズをチェック
 */
function getContentSizeBytes(content: string): number {
  return Buffer.byteLength(content, 'utf-8');
}

/**
 * 組織のナレッジドキュメントを取得してプロンプト用に整形する
 */
export async function getOrgKnowledgeForPrompt(orgId: string): Promise<string> {
  const docsSnap = await db.collection('orgLearningDocs')
    .where('orgId', '==', orgId)
    .get();

  if (docsSnap.empty) {
    return '';
  }

  const sections: string[] = [];
  let totalChars = 0;

  for (const docSnap of docsSnap.docs) {
    const doc = docSnap.data() as OrgLearningDoc;
    const content = formatDocumentContent(doc);

    if (totalChars + content.length > FILE_SEARCH_LIMITS.MAX_KNOWLEDGE_CHARS) {
      functions.logger.warn('Knowledge content truncated due to size limit', {
        orgId,
        totalChars,
        limit: FILE_SEARCH_LIMITS.MAX_KNOWLEDGE_CHARS,
      });
      break;
    }

    sections.push(content);
    totalChars += content.length;
  }

  return sections.join('\n\n---\n\n');
}

// =====================================================
// 同期関数
// =====================================================

/**
 * 組織の学習ドキュメントを同期（マーク）する
 * 現在のSDKではFile Search APIが未対応のため、同期状態の管理のみ行う
 *
 * @param orgId 組織ID
 * @param options オプション
 */
export async function syncOrgLearningDocs(
  orgId: string,
  options: {
    forceResync?: boolean;
    executionType?: 'manual' | 'scheduled' | 'on_update';
  } = {}
): Promise<OrgLearningSyncHistory> {
  const startTime = Date.now();
  const { forceResync = false, executionType = 'manual' } = options;

  functions.logger.info('Starting org learning docs sync', { orgId, forceResync, executionType });

  const stats = {
    totalDocs: 0,
    syncedDocs: 0,
    failedDocs: 0,
    skippedDocs: 0,
  };
  const syncedDocIds: string[] = [];
  const failedDocs: Array<{ docId: string; error: string }> = [];

  try {
    // 1. ストアIDを取得/作成
    const storeId = await ensureOrgStore(orgId);
    functions.logger.info(`Using store: ${storeId}`, { orgId });

    // 2. 同期対象のドキュメントを取得
    const docsSnap = await db.collection('orgLearningDocs')
      .where('orgId', '==', orgId)
      .get();

    stats.totalDocs = docsSnap.size;

    functions.logger.info(`Found ${stats.totalDocs} documents to process`, { orgId });

    if (docsSnap.empty) {
      functions.logger.info('No documents to sync', { orgId });
      const history = await saveSyncHistory(orgId, executionType, stats, syncedDocIds, failedDocs, startTime);
      return history;
    }

    // 3. 各ドキュメントを同期（現在はステータス更新のみ）
    for (const docSnap of docsSnap.docs) {
      const docId = docSnap.id;
      const doc = docSnap.data() as OrgLearningDoc;

      // スキップ判定（強制再同期でない場合）
      if (!forceResync && doc.syncStatus === 'synced' && doc.syncedAt) {
        // updatedAt > syncedAt の場合のみ再同期
        if (doc.updatedAt.toMillis() <= doc.syncedAt.toMillis()) {
          stats.skippedDocs++;
          functions.logger.debug(`Skipping already synced doc: ${docId}`);
          continue;
        }
      }

      try {
        // コンテンツを準備
        const content = formatDocumentContent(doc);
        const contentSize = getContentSizeBytes(content);

        // サイズチェック
        if (contentSize > FILE_SEARCH_LIMITS.MAX_FILE_SIZE_BYTES) {
          throw new Error(`Document exceeds maximum size: ${contentSize} bytes > ${FILE_SEARCH_LIMITS.MAX_FILE_SIZE_BYTES} bytes`);
        }

        // 表示名を生成（将来のFile Search用）
        const displayName = `${orgId}_${docId}`.substring(0, FILE_SEARCH_LIMITS.MAX_DISPLAY_NAME_LENGTH);

        // 同期成功としてマーク（将来のSDK対応時に実際のアップロードを実装）
        await docSnap.ref.update({
          fileId: `pending_${displayName}`, // 仮のID（将来実装時に更新）
          syncedAt: admin.firestore.Timestamp.now(),
          syncStatus: 'synced',
          syncError: admin.firestore.FieldValue.delete(),
          syncRetryCount: 0,
        });

        stats.syncedDocs++;
        syncedDocIds.push(docId);

        functions.logger.info(`Marked document as synced: ${docId}`, {
          displayName,
          contentSize,
        });

      } catch (docError) {
        const errorMessage = docError instanceof Error ? docError.message : String(docError);
        const currentRetryCount = (doc.syncRetryCount || 0) + 1;

        // エラー情報を記録
        await docSnap.ref.update({
          syncStatus: 'failed',
          syncError: errorMessage,
          syncRetryCount: currentRetryCount,
        });

        stats.failedDocs++;
        failedDocs.push({
          docId,
          error: errorMessage,
        });

        functions.logger.error(`Failed to sync document: ${docId}`, {
          error: errorMessage,
          retryCount: currentRetryCount,
        });
      }
    }

    // 4. 同期履歴を保存
    const history = await saveSyncHistory(orgId, executionType, stats, syncedDocIds, failedDocs, startTime);

    functions.logger.info('Sync completed', {
      orgId,
      stats,
      durationMs: history.durationMs,
    });

    return history;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    functions.logger.error('Sync failed with error', {
      orgId,
      error: errorMessage,
    });

    // エラー履歴を保存
    const history: OrgLearningSyncHistory = {
      orgId,
      executedAt: admin.firestore.Timestamp.now(),
      executionType,
      stats,
      durationMs: Date.now() - startTime,
      syncedDocIds,
      failedDocs,
      error: errorMessage,
    };

    await db.collection('org_learning_sync_history').add(history);

    throw error;
  }
}

/**
 * 同期履歴を保存する
 */
async function saveSyncHistory(
  orgId: string,
  executionType: 'manual' | 'scheduled' | 'on_update',
  stats: OrgLearningSyncHistory['stats'],
  syncedDocIds: string[],
  failedDocs: Array<{ docId: string; error: string }>,
  startTime: number
): Promise<OrgLearningSyncHistory> {
  const history: OrgLearningSyncHistory = {
    orgId,
    executedAt: admin.firestore.Timestamp.now(),
    executionType,
    stats,
    durationMs: Date.now() - startTime,
    syncedDocIds,
    failedDocs,
  };

  await db.collection('org_learning_sync_history').add(history);

  return history;
}

/**
 * 失敗したドキュメントを再同期する
 */
export async function retrySyncFailedDocs(orgId: string): Promise<OrgLearningSyncHistory> {
  functions.logger.info('Retrying failed docs sync', { orgId });

  // 失敗したドキュメントのうち、リトライ上限に達していないものを対象
  const failedDocsSnap = await db.collection('orgLearningDocs')
    .where('orgId', '==', orgId)
    .where('syncStatus', '==', 'failed')
    .where('syncRetryCount', '<', FILE_SEARCH_LIMITS.MAX_RETRY_COUNT)
    .get();

  if (failedDocsSnap.empty) {
    functions.logger.info('No failed docs to retry', { orgId });
    return {
      orgId,
      executedAt: admin.firestore.Timestamp.now(),
      executionType: 'manual',
      stats: {
        totalDocs: 0,
        syncedDocs: 0,
        failedDocs: 0,
        skippedDocs: 0,
      },
      durationMs: 0,
      syncedDocIds: [],
      failedDocs: [],
    };
  }

  // 失敗ドキュメントのステータスをpendingに戻す
  const batch = db.batch();
  failedDocsSnap.docs.forEach((docSnap: admin.firestore.QueryDocumentSnapshot) => {
    batch.update(docSnap.ref, { syncStatus: 'pending' });
  });
  await batch.commit();

  // 同期を実行
  return syncOrgLearningDocs(orgId, { executionType: 'manual' });
}

// =====================================================
// コード提案 API
// =====================================================

/**
 * コード提案の結果
 */
interface CodeSuggestion {
  code: string;
  confidence: number;
  reason: string;
}

interface LineCodeSuggestion {
  index: number;
  itemCode: CodeSuggestion;
  accountCode: CodeSuggestion;
  taxCategory: CodeSuggestion;
  departmentCode: CodeSuggestion;
}

interface DocumentCodeSuggestions {
  customerCode: CodeSuggestion;
  lines: LineCodeSuggestion[];
}

/**
 * ドキュメントに対してコード（顧客コード、品目コード等）を提案する
 * 組織のナレッジをプロンプトに埋め込んでAIが提案
 *
 * @param docId OCR履歴のドキュメントID
 */
export async function suggestCodesForDocument(docId: string): Promise<DocumentCodeSuggestions> {
  functions.logger.info('Suggesting codes for document', { docId });

  // 1. ドキュメントを取得
  const docRef = db.collection('ocr_history').doc(docId);
  const docSnap = await docRef.get();

  if (!docSnap.exists) {
    throw new Error(`Document not found: ${docId}`);
  }

  const docData = docSnap.data() as {
    setting_id?: string;
    extracted_data?: Record<string, unknown>;
    humanConfirmedData?: Record<string, unknown>;
  };

  // 2. OCR設定から組織IDを取得
  if (!docData.setting_id) {
    throw new Error('Document has no setting_id');
  }

  const settingDoc = await db.collection('ocr_settings').doc(docData.setting_id).get();
  if (!settingDoc.exists) {
    throw new Error(`OCR setting not found: ${docData.setting_id}`);
  }

  const settingData = settingDoc.data() as {
    organization_id?: string;
    templateType?: string;
  };

  const orgId = settingData.organization_id;
  if (!orgId) {
    throw new Error('OCR setting has no organization_id');
  }

  // 3. 組織のナレッジを取得
  const knowledge = await getOrgKnowledgeForPrompt(orgId);

  // 4. Gemini API クライアントを初期化
  const apiKey = geminiApiKey.value();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

  // 5. ペイロードを準備
  const extractedData = docData.humanConfirmedData || docData.extracted_data || {};

  const payload = {
    orgId,
    documentId: docId,
    invoiceType: settingData.templateType || 'invoice',
    fields: extractedData,
  };

  // 6. プロンプトを構築
  const prompt = `あなたは帳票→会計コード付与アシスタントです。
以下は抽出済みの請求書内容と、この会社のナレッジベース（顧客マスタ、品目マスタ、勘定科目ルールなど）です。

## ナレッジベース
${knowledge || '（ナレッジが登録されていません）'}

## 請求書データ(JSON)
${JSON.stringify(payload, null, 2)}

この請求書に対して、以下を提案してください:
- customerCode（顧客コード）
- 各明細行ごとの itemCode（品目コード）, accountCode（勘定科目コード）, taxCategory（税区分）, departmentCode（部門コード）

出力は JSON で、次の schema に従ってください:

{
  "customerCode": { "code": "string", "confidence": number, "reason": "string" },
  "lines": [
    {
      "index": integer,
      "itemCode": { "code": "string", "confidence": number, "reason": "string" },
      "accountCode": { "code": "string", "confidence": number, "reason": "string" },
      "taxCategory": { "code": "string", "confidence": number, "reason": "string" },
      "departmentCode": { "code": "string", "confidence": number, "reason": "string" }
    }
  ]
}

重要な注意事項:
1. confidence は 0〜1.0 の数値で、提案の確信度を示します
2. reason は提案の根拠（マスタのどの情報に基づいているかなど）を簡潔に記載
3. ナレッジベースに該当する情報がない場合は、confidence を低く設定し、reason に「該当なし」と記載
4. JSONのみを出力し、他の説明文は含めないでください`;

  // 7. AIでコンテンツを生成
  functions.logger.info('Calling Gemini API for code suggestions', { orgId, docId });

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  // 8. レスポンスをパース
  let suggestions: DocumentCodeSuggestions;
  try {
    const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
    suggestions = JSON.parse(cleanedText);
  } catch (parseError) {
    functions.logger.error('Failed to parse suggestions response', {
      response: responseText.substring(0, 500),
      error: parseError instanceof Error ? parseError.message : String(parseError),
    });
    throw new Error(`Failed to parse AI response: ${responseText.substring(0, 200)}`);
  }

  // 9. 結果をドキュメントに保存
  await docRef.update({
    codeSuggestions: suggestions,
    codeSuggestedAt: admin.firestore.Timestamp.now(),
  });

  functions.logger.info('Code suggestions completed', {
    docId,
    customerCode: suggestions.customerCode?.code,
    linesCount: suggestions.lines?.length,
  });

  return suggestions;
}

// =====================================================
// Cloud Functions エンドポイント
// =====================================================

/**
 * 手動で同期を実行するHTTPエンドポイント
 */
export const syncOrgLearningDocsHttp = functions.https.onRequest(
  {
    region: 'asia-northeast1',
    secrets: [geminiApiKey],
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async (req, res) => {
    // CORSヘッダーを設定
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
      return;
    }

    // 認証チェック
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Authorization header missing or invalid' });
      return;
    }

    const token = authHeader.substring(7);

    try {
      // Firebase ID Tokenを検証
      await admin.auth().verifyIdToken(token);
    } catch {
      res.status(401).json({ success: false, error: 'Invalid authentication token' });
      return;
    }

    // パラメータ取得
    const { orgId, forceResync } = req.body;

    if (!orgId) {
      res.status(400).json({ success: false, error: 'Missing required parameter: orgId' });
      return;
    }

    try {
      const result = await syncOrgLearningDocs(orgId, {
        forceResync: forceResync === true,
        executionType: 'manual',
      });

      res.status(200).json({
        success: true,
        result,
      });
    } catch (error) {
      functions.logger.error('Sync endpoint error', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      });
    }
  }
);

/**
 * コード提案を実行するHTTPエンドポイント
 */
export const suggestCodesHttp = functions.https.onRequest(
  {
    region: 'asia-northeast1',
    secrets: [geminiApiKey],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async (req, res) => {
    // CORSヘッダーを設定
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
      return;
    }

    // 認証チェック
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Authorization header missing or invalid' });
      return;
    }

    const token = authHeader.substring(7);

    let userId: string;
    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      userId = decodedToken.uid;
    } catch {
      res.status(401).json({ success: false, error: 'Invalid authentication token' });
      return;
    }

    // パラメータ取得
    const { docId, useRag = true } = req.body;

    if (!docId) {
      res.status(400).json({ success: false, error: 'Missing required parameter: docId' });
      return;
    }

    try {
      // ドキュメントとOCR設定を取得して権限チェック
      const docRef = db.collection('ocr_history').doc(docId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        res.status(404).json({ success: false, error: 'Document not found' });
        return;
      }

      const docData = docSnap.data() as { setting_id?: string };

      if (!docData.setting_id) {
        res.status(400).json({ success: false, error: 'Document has no setting_id' });
        return;
      }

      const settingDoc = await db.collection('ocr_settings').doc(docData.setting_id).get();
      if (!settingDoc.exists) {
        res.status(404).json({ success: false, error: 'OCR setting not found' });
        return;
      }

      const settingData = settingDoc.data() as { owner_id: string; organization_id?: string };

      // 権限チェック
      if (settingData.owner_id !== userId) {
        res.status(403).json({ success: false, error: 'Permission denied' });
        return;
      }

      // 組織のRAG設定をチェック
      if (settingData.organization_id) {
        const orgDoc = await db.collection('organizations').doc(settingData.organization_id).get();
        if (orgDoc.exists) {
          const orgData = orgDoc.data() as { ragCodeSuggestionEnabled?: boolean };
          if (orgData.ragCodeSuggestionEnabled === false) {
            res.status(403).json({
              success: false,
              error: 'RAG code suggestion is disabled for this organization',
            });
            return;
          }
        }
      }

      // useRag=falseの場合は空の提案を返す
      if (!useRag) {
        const emptyCodeSuggestion = { code: '', confidence: 0, reason: 'RAGを使用しないため提案なし' };
        const suggestions: DocumentCodeSuggestions = {
          customerCode: emptyCodeSuggestion,
          lines: [],
        };

        await docRef.update({
          codeSuggestions: suggestions,
          codeSuggestedAt: admin.firestore.Timestamp.now(),
        });

        res.status(200).json({
          success: true,
          suggestions,
          useRag: false,
        });
        return;
      }

      // RAGを使ってコード提案を実行
      const suggestions = await suggestCodesForDocument(docId);

      res.status(200).json({
        success: true,
        suggestions,
        useRag: true,
      });
    } catch (error) {
      functions.logger.error('Suggest codes endpoint error', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      });
    }
  }
);

/**
 * ドキュメント更新時に自動同期をトリガーするFirestoreトリガー
 */
export const onOrgLearningDocWrite = functions.firestore.onDocumentWritten(
  {
    document: 'orgLearningDocs/{docId}',
    region: 'asia-northeast1',
    secrets: [geminiApiKey],
  },
  async (event: functions.firestore.FirestoreEvent<functions.firestore.Change<functions.firestore.DocumentSnapshot> | undefined, { docId: string }>) => {
    const docId = event.params.docId;
    const beforeData = event.data?.before?.data() as OrgLearningDoc | undefined;
    const afterData = event.data?.after?.data() as OrgLearningDoc | undefined;

    // 削除の場合は何もしない（将来のFile Search対応時にファイル削除を実装）
    if (!afterData) {
      functions.logger.info(`Document deleted: ${docId}`);
      return;
    }

    // 同期状態の変更は無視（無限ループ防止）
    if (beforeData &&
        beforeData.syncStatus !== afterData.syncStatus &&
        beforeData.content === afterData.content &&
        beforeData.title === afterData.title) {
      return;
    }

    // コンテンツが変更された場合のみ同期
    const contentChanged = !beforeData ||
      beforeData.content !== afterData.content ||
      beforeData.title !== afterData.title ||
      beforeData.type !== afterData.type;

    if (!contentChanged) {
      return;
    }

    functions.logger.info(`Document content changed, triggering sync: ${docId}`, {
      orgId: afterData.orgId,
    });

    // ドキュメントのsyncStatusをpendingに設定
    if (event.data?.after?.ref) {
      await event.data.after.ref.update({
        syncStatus: 'pending',
      });
    }

    // 非同期で同期を実行（エラーは履歴に記録）
    try {
      await syncOrgLearningDocs(afterData.orgId, {
        executionType: 'on_update',
      });
    } catch (error) {
      functions.logger.error(`Auto-sync failed for document: ${docId}`, error);
    }
  }
);

/**
 * 定期的な同期バッチ（毎日深夜3時に実行）
 */
export const scheduledSyncOrgLearningDocs = functions.scheduler.onSchedule(
  {
    schedule: '0 3 * * *', // 毎日午前3時
    timeZone: 'Asia/Tokyo',
    region: 'asia-northeast1',
    secrets: [geminiApiKey],
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    functions.logger.info('Starting scheduled sync for all organizations');

    // 全ての組織を取得
    const orgsSnap = await db.collection('organizations').get();

    if (orgsSnap.empty) {
      functions.logger.info('No organizations found');
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (const orgDoc of orgsSnap.docs) {
      const orgId = orgDoc.id;

      try {
        // 失敗したドキュメントを再同期
        await retrySyncFailedDocs(orgId);

        // 未同期のドキュメントを同期
        await syncOrgLearningDocs(orgId, {
          executionType: 'scheduled',
        });

        successCount++;
      } catch (error) {
        functions.logger.error(`Scheduled sync failed for org: ${orgId}`, error);
        errorCount++;
      }
    }

    functions.logger.info('Scheduled sync completed', {
      totalOrgs: orgsSnap.size,
      successCount,
      errorCount,
    });
  }
);

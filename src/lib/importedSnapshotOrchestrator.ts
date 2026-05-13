import { randomUUID } from 'node:crypto';
import type { DocumentReference } from '@google-cloud/firestore';
import { ZodError } from 'zod';
import type { CuratorOutputResult } from '../agents/curator/schema';
import {
  DOCUMENTS_COLLECTION,
  MAX_UPLOAD_BYTES,
  buildRawObjectPath,
  sanitizeOriginalFileName,
} from './documents';
import { FieldValue, getFirestoreClient } from './firestore';
import {
  hashContentSha256,
  type FirestoreDocument,
  type FirestoreExternalSource,
} from './firestoreSchema';
import {
  fetchDocsSnapshot,
  googleDocsWorkspaceImportAdapter,
  parseGoogleDocsInput,
} from './googleDocsSnapshotImporter';
import {
  fetchSheetsSnapshot,
  googleSheetsWorkspaceImportAdapter,
  parseGoogleSheetsInput,
} from './googleSheetsSnapshotImporter';
import { uploadRawObject } from './storage';
import {
  buildImportedSnapshotInitialDocumentBody,
  runCuratorAndMaskerLifecycle,
  safeDeleteFirestoreDoc,
  safeDeleteRawObject,
  transitionDocumentToCurating,
  type MaskerSummary,
  type OrchestrateResult,
} from './uploadOrchestrator';
import { replaceChunksForDoc } from './chunkRegenerator';
import { parseFirestoreDocumentData } from './parseFirestoreDocumentData';
import type {
  WorkspaceImportAdapter,
  WorkspaceSnapshot,
} from './workspaceImport/types';

export type OrchestrateImportedSnapshotInput = {
  urlOrFileId: string;
  displayName?: string;
};

/** `OrchestrateResult` に加え、HTTP 成功レスポンス用の snapshot metadata を付与する。 */
export type ImportedSnapshotOrchestrateResult = OrchestrateResult & {
  fileName: string;
  snapshotByteSize: number;
  /** Maps to success JSON `kind` (de-dup: new vs overwrite). */
  ingestKind: 'created' | 'overwritten';
  /** When true, same as JSON `skipped` — contentSha256 unchanged short-circuit. */
  skipped?: true;
};

export type WorkspaceImportOrchestratorDependencies = {
  parseInput: (urlOrFileId: string) => { fileId: string };
  fetchSnapshot: (fileId: string) => Promise<WorkspaceSnapshot>;
  adapter: WorkspaceImportAdapter;
  normalizeFileBaseName: (name: string) => string;
  buildSafeFileName: (name: string) => string;
};

type ImportedSnapshotMode = 'create' | 'overwrite';

type ExistingWorkspaceDocument = {
  docRef: DocumentReference;
  firestoreDocument: FirestoreDocument;
};

/** Thrown when raw snapshot upload to GCS fails (maps to HTTP 502). */
export class GcsUploadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'GcsUploadError';
  }
}

/** Thrown when Drive-exported snapshot exceeds accepted upload/import size (maps to HTTP 413). */
export class ImportTooLargeError extends Error {
  readonly byteSize: number;
  readonly maxBytes: number;

  constructor(byteSize: number, maxBytes = MAX_UPLOAD_BYTES) {
    super(`Imported snapshot exceeds limit: ${byteSize} > ${maxBytes} bytes.`);
    this.name = 'ImportTooLargeError';
    this.byteSize = byteSize;
    this.maxBytes = maxBytes;
  }
}

const sheetsWorkspaceImportDeps: WorkspaceImportOrchestratorDependencies = {
  parseInput: parseGoogleSheetsInput,
  fetchSnapshot: async (fileId: string): Promise<WorkspaceSnapshot> => {
    const { metadata, xlsxBuffer, exportedAt } = await fetchSheetsSnapshot(fileId);
    return { metadata, exportBuffer: xlsxBuffer, exportedAt };
  },
  adapter: googleSheetsWorkspaceImportAdapter,
  normalizeFileBaseName: normalizeImportedSpreadsheetBaseName,
  buildSafeFileName: buildSafeXlsxName,
};

const docsWorkspaceImportDeps: WorkspaceImportOrchestratorDependencies = {
  parseInput: parseGoogleDocsInput,
  fetchSnapshot: async (fileId: string): Promise<WorkspaceSnapshot> => {
    const { metadata, markdownBuffer, exportedAt } = await fetchDocsSnapshot(fileId);
    return { metadata, exportBuffer: markdownBuffer, exportedAt };
  },
  adapter: googleDocsWorkspaceImportAdapter,
  normalizeFileBaseName: normalizeImportedMarkdownBaseName,
  buildSafeFileName: buildSafeMarkdownName,
};

export async function findExistingDocByFileId(
  fileId: string
): Promise<ExistingWorkspaceDocument | null> {
  const db = getFirestoreClient();
  const snapshot = await db
    .collection(DOCUMENTS_COLLECTION)
    .where('externalSource.fileId', '==', fileId)
    .where('sourceKind', '==', 'google_workspace')
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const docSnapshot = snapshot.docs[0];
  const raw = docSnapshot.data();
  if (raw == null) {
    throw new Error(`Document ${docSnapshot.id} has no payload.`);
  }

  let firestoreDocument: FirestoreDocument;
  try {
    firestoreDocument = parseFirestoreDocumentData(raw);
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      throw new Error(
        `Existing workspace document ${docSnapshot.id} does not match the expected schema.`,
        { cause: err }
      );
    }
    throw err;
  }

  return {
    docRef: db.collection(DOCUMENTS_COLLECTION).doc(docSnapshot.id),
    firestoreDocument,
  };
}

/**
 * Workspace import（Sheets / Docs）の共通 orchestrator。
 * `deps` を差し替えることで source 固有差分（parse, export, normalize）を吸収する。
 */
export async function orchestrateImportedSnapshotProcessing(
  input: OrchestrateImportedSnapshotInput,
  deps: WorkspaceImportOrchestratorDependencies = sheetsWorkspaceImportDeps
): Promise<ImportedSnapshotOrchestrateResult> {
  const importedAt = new Date().toISOString();

  // [A] parseInput — URL または bare fileId から fileId を解決
  const { fileId } = deps.parseInput(input.urlOrFileId);

  // [A'] fetchSnapshot — Drive metadata 取得 + files.export
  const { metadata, exportBuffer, exportedAt } = await deps.fetchSnapshot(fileId);
  const existing = await findExistingDocByFileId(fileId);
  const mode: ImportedSnapshotMode = existing ? 'overwrite' : 'create';

  if (exportBuffer.length > MAX_UPLOAD_BYTES) {
    throw new ImportTooLargeError(exportBuffer.length);
  }

  // [B-pre] toNormalizedContent — Curator / Masker 入力向け正規化
  const content = await deps.adapter.toNormalizedContent(exportBuffer);

  const docId = existing?.docRef.id ?? randomUUID();
  const baseFileName = deps.normalizeFileBaseName(metadata.name);
  const fileName = `${baseFileName}${deps.adapter.fileExtension}`;
  const safeName = deps.buildSafeFileName(metadata.name);
  const storagePath = buildRawObjectPath(docId, safeName);
  const aiSafeStoragePath = `masked/${docId}/${safeName}`;
  const contentSha256 = hashContentSha256(exportBuffer);
  const contentType = deps.adapter.contentType;
  const previousStoragePath = existing?.firestoreDocument.storagePath;

  const db = getFirestoreClient();
  const docRef = existing?.docRef ?? db.collection(DOCUMENTS_COLLECTION).doc(docId);

  if (
    mode === 'overwrite' &&
    existing?.firestoreDocument.contentSha256 === contentSha256
  ) {
    const existingLifecycle = lifecycleResultFromExistingDocument(
      docId,
      existing.firestoreDocument
    );
    if (existingLifecycle) {
      await updateMetadataOnlyForSkippedOverwrite(docRef, metadata, exportedAt);
      return {
        ...existingLifecycle,
        fileName: existing.firestoreDocument.fileName,
        snapshotByteSize: exportBuffer.length,
        ingestKind: 'overwritten',
        skipped: true,
      };
    }
  }

  const externalSource: FirestoreExternalSource = {
    provider: 'google_drive',
    workspaceMimeType: deps.adapter.workspaceMimeType,
    fileId: metadata.fileId,
    name: metadata.name,
    ...(metadata.webViewLink ? { webViewLink: metadata.webViewLink } : {}),
    ...(metadata.modifiedTime ? { modifiedTime: metadata.modifiedTime } : {}),
    importedAt,
    exportedAt,
    exportMimeType: deps.adapter.exportMimeType,
  };

  // [B] uploadRawObject — export bytes を GCS raw 領域へ
  try {
    await uploadRawObject(storagePath, exportBuffer, contentType);
  } catch (e) {
    throw new GcsUploadError(e);
  }

  // [C] Firestore initial/overwrite set — uploaded 相当の初回フィールド + externalSource
  try {
    await docRef.set(
      buildImportedSnapshotInitialDocumentBody({
        docId,
        fileName,
        contentType,
        byteSize: exportBuffer.length,
        contentSha256,
        storagePath,
        externalSource,
      }),
      { merge: false }
    );
  } catch (e) {
    await safeDeleteRawObject(storagePath);
    throw e;
  }

  // [D] Firestore update(curating) — エージェント段の直前に status を curating へ
  try {
    await transitionDocumentToCurating(docRef, contentSha256, externalSource);
  } catch (e) {
    if (mode === 'create') {
      await safeDeleteRawObject(storagePath);
      await safeDeleteFirestoreDoc(docRef);
    } else {
      await updateFailedStatusAfterOverwriteError(
        docRef,
        'curatorError',
        `curating transition failed: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
    throw e;
  }

  // [E][F][G][H] runCuratorAndMaskerLifecycle — Curator 分類〜終端更新、必要時は Masker
  const lifecycle = await runCuratorAndMaskerLifecycle({
    docRef,
    docId,
    displayName: input.displayName?.trim() || fileName,
    content,
    contentSha256,
    sourceKind: 'google_workspace',
    externalSource,
    storagePath,
    aiSafeStoragePath,
  });
  if (
    lifecycle.kind === 'ai_safe' ||
    lifecycle.kind === 'curated' ||
    lifecycle.kind === 'blocked'
  ) {
    try {
      await replaceChunksForDoc(docId);
    } catch (error) {
      await updateFailedStatusAfterChunkReplaceError(docRef, error);
      throw error;
    }
  }

  if (
    mode === 'overwrite' &&
    previousStoragePath &&
    previousStoragePath !== storagePath
  ) {
    await safeDeleteRawObject(previousStoragePath);
  }

  return {
    ...lifecycle,
    fileName,
    snapshotByteSize: exportBuffer.length,
    ingestKind: mode === 'create' ? 'created' : 'overwritten',
  };
}

/**
 * Google Docs 向けの薄い wrapper。
 * 実体は `orchestrateImportedSnapshotProcessing` 共通ロジックに委譲する。
 */
export async function orchestrateImportedDocsSnapshotProcessing(
  input: OrchestrateImportedSnapshotInput
): Promise<ImportedSnapshotOrchestrateResult> {
  return orchestrateImportedSnapshotProcessing(input, docsWorkspaceImportDeps);
}

function escapeRegexLiteral(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeImportedWorkspaceBaseName(
  name: string,
  fileExtension: string,
  fallbackBaseName: string
): string {
  const trimmedInput = name.replace(/\0/g, '').trim();
  if (!trimmedInput) return fallbackBaseName;
  const extensionPattern = new RegExp(`${escapeRegexLiteral(fileExtension)}$`, 'i');
  let base = trimmedInput.replace(extensionPattern, '').trim();
  base = base.replace(/\.+$/, '');
  return base.length === 0 ? fallbackBaseName : base;
}

function buildSafeWorkspaceFileName(
  name: string,
  fileExtension: string,
  fallbackBaseName: string
): string {
  const trimmedInput = name.replace(/\0/g, '').trim();
  if (!trimmedInput) {
    return `${fallbackBaseName}${fileExtension}`;
  }
  const extensionPattern = new RegExp(`${escapeRegexLiteral(fileExtension)}$`, 'i');
  let safeBase = sanitizeOriginalFileName(name).replace(extensionPattern, '').trim();
  safeBase = safeBase.replace(/\.+$/, '');
  if (safeBase.length === 0) {
    safeBase = fallbackBaseName;
  }
  let truncated = safeBase.slice(0, 195);
  truncated = truncated.replace(/\.+$/, '');
  if (truncated.length === 0) {
    truncated = fallbackBaseName;
  }
  return `${truncated}${fileExtension}`;
}

/**
 * Drive の表示名から Firestore `fileName` 用のベース（拡張子なし）を得る。
 * 空や `.xlsx` のみなどは `sheet` に落とし、末尾の `.` は除去する（`.xlsx` 二重付与はしない）。
 */
function normalizeImportedSpreadsheetBaseName(name: string): string {
  return normalizeImportedWorkspaceBaseName(name, '.xlsx', 'sheet');
}

/**
 * Drive の表示名から Firestore `fileName` 用の markdown ベース（拡張子なし）を得る。
 */
function normalizeImportedMarkdownBaseName(name: string): string {
  return normalizeImportedWorkspaceBaseName(name, '.md', 'document');
}

/**
 * GCS キー用のファイル名。`sanitizeOriginalFileName` に加え、xlsx 除去後の空名・末尾 `.` を正規化する。
 */
export function buildSafeXlsxName(name: string): string {
  return buildSafeWorkspaceFileName(name, '.xlsx', 'sheet');
}

/**
 * GCS キー用の markdown ファイル名。空名・末尾 `.` を正規化する。
 */
export function buildSafeMarkdownName(name: string): string {
  return buildSafeWorkspaceFileName(name, '.md', 'document');
}

function lifecycleResultFromExistingDocument(
  docId: string,
  document: FirestoreDocument
): OrchestrateResult | null {
  if (document.curator == null) {
    return null;
  }

  const curatorResult: CuratorOutputResult = {
    documentType: document.curator.documentType,
    businessDomain: document.curator.businessDomain,
    sensitivity: document.curator.sensitivity,
    freshness: document.curator.freshness,
    isAuthoritativeCandidate: document.curator.isAuthoritativeCandidate,
    aiUsePolicy: document.curator.aiUsePolicy,
    rationale: document.curator.rationale,
  };
  const curatorCompletedAt = timestampToDate(document.curator.completedAt);

  if (document.status === 'curated' || document.status === 'blocked') {
    return {
      kind: document.status,
      docId,
      storagePath: document.storagePath,
      curator: curatorResult,
      curatorCompletedAt,
    };
  }

  if (document.status === 'ai_safe') {
    if (document.masker == null || document.aiSafeStoragePath == null) {
      return null;
    }
    return {
      kind: 'ai_safe',
      docId,
      storagePath: document.storagePath,
      aiSafeStoragePath: document.aiSafeStoragePath,
      curator: curatorResult,
      curatorCompletedAt,
      masker: maskerSummaryFromDocument(document.masker),
    };
  }

  if (document.status === 'restricted') {
    if (
      document.masker == null ||
      document.sensitivityReason == null ||
      document.originalCuratorSensitivity == null
    ) {
      return null;
    }
    return {
      kind: 'restricted',
      docId,
      storagePath: document.storagePath,
      curator: curatorResult,
      curatorCompletedAt,
      masker: maskerSummaryFromDocument(document.masker),
      sensitivityReason: document.sensitivityReason,
      originalCuratorSensitivity: document.originalCuratorSensitivity,
    };
  }

  return null;
}

function maskerSummaryFromDocument(masker: FirestoreDocument['masker']): MaskerSummary {
  if (masker == null) {
    throw new Error('masker summary requires non-null masker block');
  }
  return {
    decision: masker.decision,
    provider: masker.provider,
    maskedSpansCount: masker.maskedSpansCount,
    ruleHits: masker.ruleHits,
    residualRisk: masker.residualRisk,
    rationale: masker.rationale,
    recommendedSensitivity: masker.recommendedSensitivity,
    completedAt: timestampToDate(masker.completedAt),
    modelId: masker.modelId,
  };
}

function timestampToDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string') {
    return new Date(value);
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof value.toDate === 'function'
  ) {
    return value.toDate();
  }
  throw new Error('Unexpected timestamp payload');
}

async function updateMetadataOnlyForSkippedOverwrite(
  docRef: DocumentReference,
  metadata: WorkspaceSnapshot['metadata'],
  exportedAt: string
): Promise<void> {
  await docRef.update({
    'externalSource.exportedAt': exportedAt,
    'externalSource.modifiedTime': metadata.modifiedTime ?? FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function updateFailedStatusAfterChunkReplaceError(
  docRef: DocumentReference,
  cause: unknown
): Promise<void> {
  const message = cause instanceof Error ? cause.message : String(cause);
  const truncated =
    message.length > 8000 ? `${message.slice(0, 8000)}…` : message;
  try {
    await docRef.update({
      status: 'failed',
      updatedAt: FieldValue.serverTimestamp(),
      maskerError: {
        message: `chunks replacement failed: ${truncated}`,
        occurredAt: FieldValue.serverTimestamp(),
      },
    });
  } catch (updateError) {
    console.error(
      '[importedSnapshotOrchestrator] failed to update status after chunk replacement error',
      updateError
    );
  }
}

async function updateFailedStatusAfterOverwriteError(
  docRef: DocumentReference,
  errorField: 'curatorError' | 'maskerError',
  message: string
): Promise<void> {
  const truncated =
    message.length > 8000 ? `${message.slice(0, 8000)}…` : message;
  try {
    await docRef.update({
      status: 'failed',
      updatedAt: FieldValue.serverTimestamp(),
      [errorField]: {
        message: truncated,
        occurredAt: FieldValue.serverTimestamp(),
      },
    });
  } catch (updateError) {
    console.error(
      '[importedSnapshotOrchestrator] failed to update failed status after overwrite error',
      updateError
    );
  }
}

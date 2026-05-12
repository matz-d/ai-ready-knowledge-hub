import { randomUUID } from 'node:crypto';
import type { DocumentReference } from '@google-cloud/firestore';
import {
  DOCUMENTS_COLLECTION,
  MAX_UPLOAD_BYTES,
  buildRawObjectPath,
  sanitizeOriginalFileName,
} from './documents';
import { FieldValue, getFirestoreClient } from './firestore';
import {
  assertFirestoreInvariants,
  hashContentSha256,
  type FirestoreExternalSource,
} from './firestoreSchema';
import {
  GOOGLE_SHEETS_MIME_TYPE,
  XLSX_EXPORT_MIME_TYPE,
  fetchSheetsSnapshot,
  parseGoogleSheetsInput,
  xlsxBufferToNormalizedContent,
} from './googleSheetsSnapshotImporter';
import { uploadRawObject } from './storage';
import {
  buildImportedSnapshotInitialDocumentBody,
  runCuratorAndMaskerLifecycle,
  safeDeleteFirestoreDoc,
  safeDeleteRawObject,
  type OrchestrateResult,
} from './uploadOrchestrator';

export type OrchestrateImportedSnapshotInput = {
  urlOrFileId: string;
  displayName?: string;
};

/** `OrchestrateResult` に加え、HTTP 成功レスポンス用の snapshot metadata を付与する。 */
export type ImportedSnapshotOrchestrateResult = OrchestrateResult & {
  fileName: string;
  snapshotByteSize: number;
};

/** Thrown when raw snapshot upload to GCS fails (maps to HTTP 502). */
export class GcsUploadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'GcsUploadError';
  }
}

/** Thrown when Drive-exported XLSX exceeds accepted upload/import size (maps to HTTP 413). */
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

/**
 * Google Sheets の Drive エクスポートから、upload と同じ [B]〜[H] の副作用鎖へ合流させる。
 *
 * 段: [A] parseGoogleSheetsInput → [A'] fetchSheetsSnapshot（直後に byte 上限チェック）
 *      → [B-pre] xlsxBufferToNormalizedContent → [B] uploadRawObject → [C] Firestore initial set
 *      → [D] Firestore update(curating) → [E][F][G][H] runCuratorAndMaskerLifecycle
 *      （[E][F][G][H] の内訳は uploadOrchestrator の runCuratorPhase / runMaskerPhase と同じ）
 */
export async function orchestrateImportedSnapshotProcessing(
  input: OrchestrateImportedSnapshotInput
): Promise<ImportedSnapshotOrchestrateResult> {
  const importedAt = new Date().toISOString();

  // [A] parseGoogleSheetsInput — URL または bare fileId から fileId を解決
  const { fileId } = parseGoogleSheetsInput(input.urlOrFileId);

  // [A'] fetchSheetsSnapshot — Drive metadata 取得 + .xlsx export
  const { metadata, xlsxBuffer, exportedAt } = await fetchSheetsSnapshot(fileId);

  if (xlsxBuffer.length > MAX_UPLOAD_BYTES) {
    throw new ImportTooLargeError(xlsxBuffer.length);
  }

  // [B-pre] xlsxBufferToNormalizedContent — ワークブックを markdown 化（Curator / Masker の content 入力）
  const content = xlsxBufferToNormalizedContent(xlsxBuffer);

  const docId = randomUUID();
  const baseFileName = normalizeImportedSpreadsheetBaseName(metadata.name);
  const fileName = `${baseFileName}.xlsx`;
  const safeName = buildSafeXlsxName(metadata.name);
  const storagePath = buildRawObjectPath(docId, safeName);
  const aiSafeStoragePath = `masked/${docId}/${safeName}`;
  const contentSha256 = hashContentSha256(xlsxBuffer);
  const contentType = XLSX_EXPORT_MIME_TYPE;

  // [B] uploadRawObject — 生 XLSX を GCS raw 領域へ
  try {
    await uploadRawObject(storagePath, xlsxBuffer, contentType);
  } catch (e) {
    throw new GcsUploadError(e);
  }

  const db = getFirestoreClient();
  const docRef = db.collection(DOCUMENTS_COLLECTION).doc(docId);
  const externalSource: FirestoreExternalSource = {
    provider: 'google_drive',
    workspaceMimeType: GOOGLE_SHEETS_MIME_TYPE,
    fileId: metadata.fileId,
    name: metadata.name,
    ...(metadata.webViewLink ? { webViewLink: metadata.webViewLink } : {}),
    ...(metadata.modifiedTime ? { modifiedTime: metadata.modifiedTime } : {}),
    importedAt,
    exportedAt,
    exportMimeType: XLSX_EXPORT_MIME_TYPE,
  };

  // [C] Firestore initial set — uploaded 相当の初回フィールド + externalSource
  try {
    await docRef.set(
      buildImportedSnapshotInitialDocumentBody({
        docId,
        fileName,
        byteSize: xlsxBuffer.length,
        contentSha256,
        storagePath,
        externalSource,
      })
    );
  } catch (e) {
    await safeDeleteRawObject(storagePath);
    throw e;
  }

  // TODO(Phase 3-B): `updateCuratingStatus` mirrors upload `orchestrateUploadProcessing` [D]
  // (invariant payload + `status: 'curating'` update). Merge into the same helper as upload and
  // preserve rollback: `safeDeleteRawObject` + `safeDeleteFirestoreDoc` on failure.
  // [D] Firestore update(curating) — エージェント段の直前に status を curating へ
  try {
    await updateCuratingStatus(docRef, contentSha256, externalSource);
  } catch (e) {
    await safeDeleteRawObject(storagePath);
    await safeDeleteFirestoreDoc(docRef);
    throw e;
  }

  // TODO(Phase 3-B): Same handoff as upload after curating update; only bootstrap ([B][C])
  // should stay source-specific—call shared `runCuratorAndMaskerLifecycle` from one funnel.
  // [E][F][G][H] runCuratorAndMaskerLifecycle — Curator 分類〜終端更新、必要時は Masker パイプライン
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
  return { ...lifecycle, fileName, snapshotByteSize: xlsxBuffer.length };
}

/**
 * Drive の表示名から Firestore `fileName` 用のベース（拡張子なし）を得る。
 * 空や `.xlsx` のみなどは `sheet` に落とし、末尾の `.` は除去する（`.xlsx` 二重付与はしない）。
 */
function normalizeImportedSpreadsheetBaseName(name: string): string {
  const trimmedInput = name.replace(/\0/g, '').trim();
  if (!trimmedInput) return 'sheet';
  let base = trimmedInput.replace(/\.xlsx$/i, '').trim();
  base = base.replace(/\.+$/, '');
  return base.length === 0 ? 'sheet' : base;
}

/**
 * GCS キー用のファイル名。`sanitizeOriginalFileName` に加え、xlsx 除去後の空名・末尾 `.` を正規化する。
 */
export function buildSafeXlsxName(name: string): string {
  const trimmedInput = name.replace(/\0/g, '').trim();
  if (!trimmedInput) {
    return 'sheet.xlsx';
  }
  let safeBase = sanitizeOriginalFileName(name).replace(/\.xlsx$/i, '').trim();
  safeBase = safeBase.replace(/\.+$/, '');
  if (safeBase.length === 0) {
    safeBase = 'sheet';
  }
  let truncated = safeBase.slice(0, 195);
  truncated = truncated.replace(/\.+$/, '');
  if (truncated.length === 0) {
    truncated = 'sheet';
  }
  return `${truncated}.xlsx`;
}

async function updateCuratingStatus(
  docRef: DocumentReference,
  contentSha256: string,
  externalSource: FirestoreExternalSource
): Promise<void> {
  // TODO(Phase 3-B): Inline body should move next to upload `orchestrateUploadProcessing` [D]
  // into e.g. `transitionDocumentToCurating` in `uploadOrchestrator` (or small shared module).
  assertFirestoreInvariants({
    sourceKind: 'google_workspace',
    externalSource,
    status: 'curating',
    contentSha256,
    aiSafeStoragePath: null,
    sensitivity: null,
    aiUsePolicy: null,
    sensitivitySource: null,
    originalCuratorSensitivity: null,
    sensitivityReason: null,
    curator: null,
    masker: null,
  });
  await docRef.update({
    status: 'curating',
    updatedAt: FieldValue.serverTimestamp(),
  });
}

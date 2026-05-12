import { randomUUID } from 'node:crypto';
import type { DocumentReference } from '@google-cloud/firestore';
import {
  DOCUMENTS_COLLECTION,
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

/** `OrchestrateResult` に加え、HTTP 成功レスポンス用の snapshot バイトサイズを付与する。 */
export type ImportedSnapshotOrchestrateResult = OrchestrateResult & {
  snapshotByteSize: number;
};

/** Thrown when raw snapshot upload to GCS fails (maps to HTTP 502). */
export class GcsUploadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'GcsUploadError';
  }
}

export async function orchestrateImportedSnapshotProcessing(
  input: OrchestrateImportedSnapshotInput
): Promise<ImportedSnapshotOrchestrateResult> {
  const importedAt = new Date().toISOString();

  // [A] parse Google Sheets URL / fileId
  const { fileId } = parseGoogleSheetsInput(input.urlOrFileId);

  // [A'] Drive metadata + export
  const { metadata, xlsxBuffer, exportedAt } = await fetchSheetsSnapshot(fileId);

  // [A''] Curator / Masker input
  const content = xlsxBufferToNormalizedContent(xlsxBuffer);

  const docId = randomUUID();
  const fileName = `${metadata.name}.xlsx`;
  const safeName = buildSafeXlsxName(metadata.name);
  const storagePath = buildRawObjectPath(docId, safeName);
  const aiSafeStoragePath = `masked/${docId}/${safeName}`;
  const contentSha256 = hashContentSha256(xlsxBuffer);
  const contentType = XLSX_EXPORT_MIME_TYPE;

  // [B] GCS uploadRawObject
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

  // [C] Firestore initial set
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

  // [D] Firestore update(curating)
  try {
    await updateCuratingStatus(docRef, contentSha256);
  } catch (e) {
    await safeDeleteRawObject(storagePath);
    await safeDeleteFirestoreDoc(docRef);
    throw e;
  }

  // [E][F][G][H] Curator + Masker lifecycle
  const lifecycle = await runCuratorAndMaskerLifecycle({
    docRef,
    docId,
    displayName: input.displayName?.trim() || fileName,
    content,
    contentSha256,
    storagePath,
    aiSafeStoragePath,
  });
  return { ...lifecycle, snapshotByteSize: xlsxBuffer.length };
}

function buildSafeXlsxName(name: string): string {
  const safeBaseName = sanitizeOriginalFileName(name).replace(/\.xlsx$/i, '');
  return `${safeBaseName.slice(0, 195)}.xlsx`;
}

async function updateCuratingStatus(
  docRef: DocumentReference,
  contentSha256: string
): Promise<void> {
  assertFirestoreInvariants({
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

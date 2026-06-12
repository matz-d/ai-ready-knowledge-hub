import { randomUUID } from 'node:crypto';
import type { DocumentReference } from '@google-cloud/firestore';
import {
  DOCUMENTS_COLLECTION,
  buildRawObjectPath,
  sanitizeOriginalFileName,
} from '../documents';
import { getFirestoreClient } from '../firestore';
import {
  assertFirestoreInvariants,
  hashContentSha256,
  type FirestoreExternalSource,
} from '../firestoreSchema';
import { FieldValue } from '../firestore';
import { uploadRawObject } from '../storage';
import {
  buildUploadInitialDocumentBody,
  type FirestoreInitialDocumentDraft,
} from './firestoreDrafts';
import { safeDeleteFirestoreDoc, safeDeleteRawObject } from './cleanup';
import { orchestratePdfPath } from './pdfPath';
import { runCuratorAndMaskerLifecycle } from './phases';
import type { OrchestrateInput, OrchestrateResult, PdfConversionAudit } from './types';

const DEFAULT_PDF_CONVERSION_AUDIT: PdfConversionAudit = {
  converterId: 'pdf-parse',
};

export async function transitionDocumentToCurating(
  docRef: DocumentReference,
  contentSha256: string,
  externalSource?: FirestoreExternalSource | null
): Promise<void> {
  const resolvedExternalSource = externalSource ?? null;
  const sourceKind: FirestoreInitialDocumentDraft['sourceKind'] =
    resolvedExternalSource === null ? 'upload' : 'google_workspace';
  assertFirestoreInvariants({
    sourceKind,
    externalSource: resolvedExternalSource,
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

/**
 * Walking Skeleton の副作用順序を一手に握る orchestrator。
 *
 * Google Sheets 取り込みでは importedSnapshotOrchestrator が先に
 * [A] parseGoogleSheetsInput、[A'] fetchSheetsSnapshot、[B-pre] 正規化テキスト化を行い、
 * 以降は本関数と同じ [B]〜[H] の鎖に合流する。
 *
 * 段（アップロード直パスは [B] から）:
 *   [B] uploadRawObject — 生バイトを GCS raw へ
 *   [C] Firestore initial set — 失敗時 GCS rollback
 *   [D] Firestore update(curating) — 失敗時 GCS + Firestore set rollback
 *   [E][F] runCuratorPhase — curatorFlow + Firestore 終端（curated / blocked / masking）
 *   [G][H] runMaskerPhase — requires_masking のときのみ、ai_safe / restricted / failed 終端更新
 *
 * route.ts は本関数の戻り値を HTTP レスポンスへ整形するだけにする。
 */
export async function orchestrateUploadProcessing(
  input: OrchestrateInput
): Promise<OrchestrateResult> {
  const docId = randomUUID();
  const safeOriginalFileName = sanitizeOriginalFileName(input.displayName);
  const storagePath = buildRawObjectPath(docId, safeOriginalFileName);
  const aiSafeStoragePath = `masked/${docId}/${safeOriginalFileName}`;
  const contentSha256 = hashContentSha256(input.buffer);

  // [B] uploadRawObject — 生バイトを GCS raw へ
  await uploadRawObject(storagePath, input.buffer, input.contentType);

  const db = getFirestoreClient();
  const docRef = db.collection(DOCUMENTS_COLLECTION).doc(docId);

  // [C] Firestore initial set — uploaded 相当の初回フィールド
  try {
    await docRef.set(
      buildUploadInitialDocumentBody({
        docId,
        displayName: input.displayName,
        contentType: input.contentType,
        byteSize: input.buffer.length,
        contentSha256,
        storagePath,
        sourceSubtype: input.sourceSubtype ?? null,
      })
    );
  } catch (e) {
    await safeDeleteRawObject(storagePath);
    throw e;
  }

  // [D] Firestore update(curating) — エージェント段の直前に status を curating へ
  try {
    await transitionDocumentToCurating(docRef, contentSha256);
  } catch (e) {
    await safeDeleteRawObject(storagePath);
    await safeDeleteFirestoreDoc(docRef);
    throw e;
  }

  // PDF path (Phase 3-H-2 M1): curator + DocumentIR GCS write + optional chunking
  if (input.documentIr) {
    return orchestratePdfPath({
      docRef,
      docId,
      displayName: input.displayName,
      content: input.content,
      contentSha256,
      storagePath,
      aiSafeStoragePath,
      documentIr: input.documentIr,
      curatorContent: input.pdfCuratorContent ?? input.content,
      curatorInputMode: input.pdfCuratorInputMode ?? 'full_text',
      auditContext: input.auditContext,
      conversion: input.conversion ?? DEFAULT_PDF_CONVERSION_AUDIT,
    });
  }

  return runCuratorAndMaskerLifecycle({
    docRef,
    docId,
    displayName: input.displayName,
    content: input.content,
    curatorContent: input.curatorContent,
    curatorInputMode: input.curatorInputMode,
    contentSha256,
    sourceKind: 'upload',
    externalSource: null,
    storagePath,
    aiSafeStoragePath,
  });
}

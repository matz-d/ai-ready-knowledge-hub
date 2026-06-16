import type { DocumentReference, Firestore } from '@google-cloud/firestore';
import { modelId } from '../agents/_shared/genkitClient';
import { buildPdfCuratorContent } from './extractors/pdfExtractionDispatcher';
import {
  createFirestorePdfFlagReader,
  dispatchPdfExtraction,
  type PdfExtractionDispatchFailure,
} from './extractors/pdfExtractionDispatcher';
import { FieldValue, getFirestoreClient } from './firestore';
import {
  hashContentSha256,
  type FirestoreDocument,
  type FirestoreDocumentStatus,
} from './firestoreSchema';
import { parseFirestoreDocumentSnapshot } from './parseFirestoreDocumentData';
import { readRawObject } from './storage';
import {
  sanitizeOriginalFileName,
  type DocumentUploadSuccessResponse,
} from './documents';
import { documentUploadSuccessBodyFromOrchestrate } from './documentUploadResponseMapper';
import { clearChunksForDoc } from './chunkRegenerator';
import {
  safeDeleteMaskedObject,
  type OrchestrateAuditContext,
} from './uploadOrchestrator';
import { orchestratePdfPath } from './uploadOrchestrator/pdfPath';
import type { TableAssistSummary } from './extractors/officialDocPdfTableAssist';

const REPROCESSABLE_STATUSES = new Set<FirestoreDocumentStatus>([
  'curated',
  'ai_safe',
  'restricted',
  'blocked',
]);

/**
 * A crashed reprocess can leave `reprocessing: true` behind. After this TTL the
 * lease is treated as stale and may be stolen, so a single failed run cannot
 * block the document forever. Generous relative to a worst-case reprocess
 * (table-assist Gemini pass + curator + masker ≈ 1–2 min).
 */
const REPROCESS_LEASE_TTL_MS = 15 * 60 * 1000;

export type PdfTableAssistReprocessFailure =
  | { code: 'document_not_found' }
  | { code: 'document_not_reprocessable'; status: FirestoreDocumentStatus }
  | { code: 'not_uploaded_pdf' }
  | { code: 'not_official_doc_pdf' }
  | { code: 'raw_content_hash_mismatch' }
  | { code: 'reprocess_in_progress' }
  | { code: 'table_assist_flag_disabled' }
  | { code: 'pdf_dispatch_failed'; failure: PdfExtractionDispatchFailure };

export type PdfTableAssistReprocessSuccess = {
  body: DocumentUploadSuccessResponse & {
    tableAssist: TableAssistSummary;
  };
};

export type PdfTableAssistReprocessOutcome =
  | { ok: true; result: PdfTableAssistReprocessSuccess }
  | { ok: false; failure: PdfTableAssistReprocessFailure };

function isUploadedPdf(doc: FirestoreDocument): boolean {
  return (
    doc.sourceKind === 'upload' && doc.fileName.toLowerCase().endsWith('.pdf')
  );
}

function buildAiSafeStoragePath(docId: string, fileName: string): string {
  return `masked/${docId}/${sanitizeOriginalFileName(fileName)}`;
}

type ReprocessLeaseResult =
  | { ok: true }
  | { ok: false; reason: 'document_not_found' }
  | {
      ok: false;
      reason: 'document_not_reprocessable';
      status: FirestoreDocumentStatus;
    }
  | { ok: false; reason: 'reprocess_in_progress' };

function timestampToMillis(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  if (value instanceof Date) return value.getTime();
  const maybeTimestamp = value as { toMillis?: () => number };
  if (typeof maybeTimestamp.toMillis === 'function') {
    return maybeTimestamp.toMillis();
  }
  return null;
}

/**
 * Single-flight lease for reprocess. Uses a dedicated `reprocessing` field rather
 * than the lifecycle status so it survives the curator/masker status writes inside
 * `orchestratePdfPath` and never collides with the terminal-status invariants. The
 * status re-check inside the transaction also closes the TOCTOU window with the
 * pre-lease validation read. A stale lease (crashed run, older than
 * `REPROCESS_LEASE_TTL_MS`) is stolen rather than blocking the document forever.
 */
async function acquireReprocessLease(
  db: Firestore,
  docRef: DocumentReference
): Promise<ReprocessLeaseResult> {
  const now = Date.now();
  return db.runTransaction<ReprocessLeaseResult>(async (tx) => {
    const snapshot = await tx.get(docRef);
    if (!snapshot.exists) {
      return { ok: false, reason: 'document_not_found' };
    }
    const data = snapshot.data() ?? {};
    const status = data.status as FirestoreDocumentStatus;
    if (!REPROCESSABLE_STATUSES.has(status)) {
      return { ok: false, reason: 'document_not_reprocessable', status };
    }
    const startedAt = timestampToMillis(data.reprocessingStartedAt);
    const heldFresh =
      data.reprocessing === true &&
      startedAt !== null &&
      now - startedAt <= REPROCESS_LEASE_TTL_MS;
    if (heldFresh) {
      return { ok: false, reason: 'reprocess_in_progress' };
    }
    tx.update(docRef, {
      reprocessing: true,
      reprocessingStartedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  });
}

async function releaseReprocessLease(docRef: DocumentReference): Promise<void> {
  // Best-effort: a failed release must not mask the real reprocess outcome. The
  // TTL steal path recovers a lease that is somehow left set.
  try {
    await docRef.update({ reprocessing: false });
  } catch (error) {
    console.warn(
      '[documents/table-assist] failed to release reprocess lease',
      error
    );
  }
}

function leaseFailure(
  lease: Extract<ReprocessLeaseResult, { ok: false }>
): PdfTableAssistReprocessFailure {
  switch (lease.reason) {
    case 'document_not_found':
      return { code: 'document_not_found' };
    case 'document_not_reprocessable':
      return { code: 'document_not_reprocessable', status: lease.status };
    case 'reprocess_in_progress':
      return { code: 'reprocess_in_progress' };
  }
}

/**
 * Product-path entrypoint for grounded Gemini table-assist.
 *
 * The synchronous upload route remains hard-gated to `tableAssistMode: 'disabled'`.
 * This service is intentionally shaped like a worker handler: it reloads the
 * persisted raw PDF, dispatches extraction with the async execution gate, then
 * sends the augmented DocumentIR through the normal PDF curator/masker/chunk path.
 *
 * A single-flight lease (`acquireReprocessLease`) serializes concurrent reprocess
 * of the same document so double-click / retry / overlap with chunk regeneration
 * cannot race on the same Firestore doc, masked object, and chunk set.
 */
export async function reprocessPdfWithTableAssist(args: {
  docId: string;
  tenantId: string;
  auditContext?: OrchestrateAuditContext;
}): Promise<PdfTableAssistReprocessOutcome> {
  const db = getFirestoreClient();
  const docRef = db.collection('documents').doc(args.docId);
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    return { ok: false, failure: { code: 'document_not_found' } };
  }

  const doc = parseFirestoreDocumentSnapshot(snapshot);

  if (!REPROCESSABLE_STATUSES.has(doc.status)) {
    return {
      ok: false,
      failure: { code: 'document_not_reprocessable', status: doc.status },
    };
  }

  if (!isUploadedPdf(doc)) {
    return { ok: false, failure: { code: 'not_uploaded_pdf' } };
  }

  if (doc.sourceSubtype !== 'official-doc-pdf') {
    return { ok: false, failure: { code: 'not_official_doc_pdf' } };
  }

  const isFlagEnabled = createFirestorePdfFlagReader(db, args.tenantId);
  if (!(await isFlagEnabled('pdf-table-assist'))) {
    return { ok: false, failure: { code: 'table_assist_flag_disabled' } };
  }

  const lease = await acquireReprocessLease(db, docRef);
  if (!lease.ok) {
    return { ok: false, failure: leaseFailure(lease) };
  }

  try {
    const buffer = await readRawObject(doc.storagePath);
    if (hashContentSha256(buffer) !== doc.contentSha256) {
      return { ok: false, failure: { code: 'raw_content_hash_mismatch' } };
    }

    const dispatchOutcome = await dispatchPdfExtraction({
      buffer,
      fileName: doc.fileName,
      isFlagEnabled,
      tableAssistMode: 'async',
    });

    if (!dispatchOutcome.ok) {
      return {
        ok: false,
        failure: {
          code: 'pdf_dispatch_failed',
          failure: dispatchOutcome.failure,
        },
      };
    }

    const { result: extraction } = dispatchOutcome;
    const tableAssist = extraction.conversion.tableAssist;
    if (tableAssist === undefined) {
      return { ok: false, failure: { code: 'table_assist_flag_disabled' } };
    }

    const previousAiSafeStoragePath = doc.aiSafeStoragePath;
    const aiSafeStoragePath =
      previousAiSafeStoragePath ??
      buildAiSafeStoragePath(args.docId, doc.fileName);

    const result = await orchestratePdfPath({
      docRef,
      docId: args.docId,
      displayName: doc.fileName,
      content: extraction.textContent,
      curatorContent: buildPdfCuratorContent(extraction),
      curatorInputMode:
        extraction.pageGroupPlan === undefined
          ? 'full_text'
          : 'page_group_manifest',
      contentSha256: doc.contentSha256,
      storagePath: doc.storagePath,
      aiSafeStoragePath,
      documentIr: extraction.documentIr,
      auditContext: args.auditContext,
      conversion: extraction.conversion,
    });

    if (result.kind === 'blocked' || result.kind === 'restricted') {
      await clearChunksForDoc(args.docId);
    }

    if (previousAiSafeStoragePath && result.kind !== 'ai_safe') {
      await safeDeleteMaskedObject(previousAiSafeStoragePath);
    }

    return {
      ok: true,
      result: {
        body: {
          ...documentUploadSuccessBodyFromOrchestrate({
            displayName: doc.fileName,
            contentType: doc.contentType,
            byteSize: doc.byteSize,
            modelId,
            result,
            ingestMeta: { kind: 'overwritten' },
          }),
          tableAssist,
        },
      },
    };
  } finally {
    await releaseReprocessLease(docRef);
  }
}

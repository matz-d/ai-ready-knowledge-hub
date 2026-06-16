import { modelId } from '../agents/_shared/genkitClient';
import { buildPdfCuratorContent } from './extractors/pdfExtractionDispatcher';
import {
  createFirestorePdfFlagReader,
  dispatchPdfExtraction,
  type PdfExtractionDispatchFailure,
} from './extractors/pdfExtractionDispatcher';
import { getFirestoreClient } from './firestore';
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

export type PdfTableAssistReprocessFailure =
  | { code: 'document_not_found' }
  | { code: 'document_not_reprocessable'; status: FirestoreDocumentStatus }
  | { code: 'not_uploaded_pdf' }
  | { code: 'not_official_doc_pdf' }
  | { code: 'raw_content_hash_mismatch' }
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

/**
 * Product-path entrypoint for grounded Gemini table-assist.
 *
 * The synchronous upload route remains hard-gated to `tableAssistMode: 'disabled'`.
 * This service is intentionally shaped like a worker handler: it reloads the
 * persisted raw PDF, dispatches extraction with the async execution gate, then
 * sends the augmented DocumentIR through the normal PDF curator/masker/chunk path.
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
      extraction.pageGroupPlan === undefined ? 'full_text' : 'page_group_manifest',
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
}

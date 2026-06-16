import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getFirestoreClientMock,
  docGetMock,
  docUpdateMock,
  runTransactionMock,
  txUpdateMock,
  createFirestorePdfFlagReaderMock,
  dispatchPdfExtractionMock,
  buildPdfCuratorContentMock,
  readRawObjectMock,
  orchestratePdfPathMock,
  clearChunksForDocMock,
  safeDeleteMaskedObjectMock,
} = vi.hoisted(() => ({
  getFirestoreClientMock: vi.fn(),
  docGetMock: vi.fn(),
  docUpdateMock: vi.fn(),
  runTransactionMock: vi.fn(),
  txUpdateMock: vi.fn(),
  createFirestorePdfFlagReaderMock: vi.fn(),
  dispatchPdfExtractionMock: vi.fn(),
  buildPdfCuratorContentMock: vi.fn(),
  readRawObjectMock: vi.fn(),
  orchestratePdfPathMock: vi.fn(),
  clearChunksForDocMock: vi.fn(),
  safeDeleteMaskedObjectMock: vi.fn(),
}));

vi.mock('../../agents/_shared/genkitClient', () => ({
  modelId: 'test-model',
}));

vi.mock('../firestore', () => ({
  getFirestoreClient: getFirestoreClientMock,
  FieldValue: { serverTimestamp: () => '__server_timestamp__' },
}));

vi.mock('../extractors/pdfExtractionDispatcher', () => ({
  createFirestorePdfFlagReader: createFirestorePdfFlagReaderMock,
  dispatchPdfExtraction: dispatchPdfExtractionMock,
  buildPdfCuratorContent: buildPdfCuratorContentMock,
}));

vi.mock('../storage', () => ({
  readRawObject: readRawObjectMock,
}));

vi.mock('../uploadOrchestrator/pdfPath', () => ({
  orchestratePdfPath: orchestratePdfPathMock,
}));

vi.mock('../chunkRegenerator', () => ({
  clearChunksForDoc: clearChunksForDocMock,
}));

vi.mock('../uploadOrchestrator', () => {
  class CuratorPhaseErrorMock extends Error {}
  class MaskerPhaseErrorMock extends Error {}
  return {
    CuratorPhaseError: CuratorPhaseErrorMock,
    MaskerPhaseError: MaskerPhaseErrorMock,
    safeDeleteMaskedObject: safeDeleteMaskedObjectMock,
  };
});

import type { DocumentIr } from '../../eval/conversion/documentIr';
import { reprocessPdfWithTableAssist } from '../pdfTableAssistReprocessor';

const rawPdf = Buffer.from('%PDF-1.4 table-assist fixture');
const rawPdfSha256 = createHash('sha256').update(rawPdf).digest('hex');

const baseFirestoreDoc = {
  schemaVersion: 2,
  fileName: 'sample.pdf',
  contentType: 'application/pdf',
  byteSize: rawPdf.length,
  contentSha256: rawPdfSha256,
  sourceKind: 'upload',
  sourceSubtype: 'official-doc-pdf',
  externalSource: null,
  storagePath: 'raw/doc-1/sample.pdf',
  aiSafeStoragePath: null,
  status: 'curated',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  documentType: 'メモ',
  businessDomain: '社内手順',
  sensitivity: 'Internal',
  freshness: 'current',
  isAuthoritativeCandidate: true,
  aiUsePolicy: 'direct',
  sensitivitySource: 'curator',
  originalCuratorSensitivity: null,
  sensitivityReason: null,
  curator: {
    documentType: 'メモ',
    businessDomain: '社内手順',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    aiUsePolicy: 'direct',
    rationale: 'ok',
    completedAt: '2026-06-01T00:00:00.000Z',
    modelId: 'test-model',
  },
  curatorError: null,
  masker: null,
  maskerError: null,
};

const baseDocumentIr: DocumentIr = {
  schemaVersion: 1,
  source: {
    fileName: 'sample.pdf',
    mediaType: 'application/pdf',
    sourceKind: 'upload',
    sourceSubtype: 'official-doc-pdf',
  },
  pages: [
    {
      pageNumber: 1,
      blocks: [{ blockId: 'p1-b0', kind: 'paragraph', text: 'PDF body text' }],
    },
  ],
};

const tableAssistDocumentIr: DocumentIr = {
  ...baseDocumentIr,
  pages: [
    {
      pageNumber: 1,
      blocks: [
        baseDocumentIr.pages[0]!.blocks[0]!,
        {
          blockId: 'p1-table-assist-0',
          kind: 'table',
          text: '| name | value |\n| Labor | 10 |',
          metadata: { extractionProvider: 'gemini-table-assist' },
        },
      ],
    },
  ],
};

function installFirestoreDoc(data: Record<string, unknown> | null) {
  docGetMock.mockResolvedValue({
    exists: data !== null,
    id: 'doc-1',
    data: () => data,
  });
}

const curator = {
  documentType: 'メモ',
  businessDomain: '社内手順',
  sensitivity: 'Internal',
  freshness: 'current',
  isAuthoritativeCandidate: true,
  aiUsePolicy: 'direct',
  rationale: 'ok',
};

beforeEach(() => {
  vi.clearAllMocks();

  getFirestoreClientMock.mockReturnValue({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: docGetMock,
        update: docUpdateMock,
      })),
    })),
    runTransaction: runTransactionMock,
  });
  runTransactionMock.mockImplementation(
    async (
      fn: (tx: { get: typeof docGetMock; update: typeof txUpdateMock }) => unknown
    ) => fn({ get: docGetMock, update: txUpdateMock })
  );
  installFirestoreDoc(baseFirestoreDoc);

  const flagReader = vi.fn(async (flagId: string) =>
    flagId === 'pdf-table-assist' || flagId === 'pdf-conversion-subtype-1'
  );
  createFirestorePdfFlagReaderMock.mockReturnValue(flagReader);
  readRawObjectMock.mockResolvedValue(rawPdf);
  buildPdfCuratorContentMock.mockReturnValue('PDF curator content');
  dispatchPdfExtractionMock.mockResolvedValue({
    ok: true,
    result: {
      textContent: 'PDF body text with table',
      documentIr: tableAssistDocumentIr,
      conversion: {
        converterId: 'pdf-parse',
        tableAssist: {
          mode: 'async',
          enabled: true,
          pagesSelected: 1,
          pagesSucceeded: 1,
          pagesFailed: 0,
          candidatesGrounded: 2,
          candidatesRejected: 0,
          blocksAdded: 1,
        },
      },
    },
  });
  orchestratePdfPathMock.mockResolvedValue({
    kind: 'curated',
    docId: 'doc-1',
    storagePath: 'raw/doc-1/sample.pdf',
    curator,
    curatorCompletedAt: new Date('2026-06-01T00:00:00.000Z'),
  });
  clearChunksForDocMock.mockResolvedValue(undefined);
  safeDeleteMaskedObjectMock.mockResolvedValue(undefined);
});

describe('reprocessPdfWithTableAssist', () => {
  it('does not read raw bytes or dispatch Gemini assist when the tenant flag is off', async () => {
    createFirestorePdfFlagReaderMock.mockReturnValue(
      vi.fn(async (flagId: string) => flagId === 'pdf-conversion-subtype-1')
    );

    const outcome = await reprocessPdfWithTableAssist({
      docId: 'doc-1',
      tenantId: 'tenant-1',
    });

    expect(outcome).toEqual({
      ok: false,
      failure: { code: 'table_assist_flag_disabled' },
    });
    expect(readRawObjectMock).not.toHaveBeenCalled();
    expect(dispatchPdfExtractionMock).not.toHaveBeenCalled();
    expect(orchestratePdfPathMock).not.toHaveBeenCalled();
  });

  it('dispatches table-assist from the product reprocess path and forwards augmented IR', async () => {
    installFirestoreDoc({
      ...baseFirestoreDoc,
      status: 'ai_safe',
      aiSafeStoragePath: 'masked/doc-1/sample.pdf',
    });

    const outcome = await reprocessPdfWithTableAssist({
      docId: 'doc-1',
      tenantId: 'tenant-1',
    });

    expect(outcome.ok).toBe(true);
    expect(dispatchPdfExtractionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        buffer: rawPdf,
        fileName: 'sample.pdf',
        tableAssistMode: 'async',
      })
    );
    expect(orchestratePdfPathMock).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 'doc-1',
        documentIr: tableAssistDocumentIr,
        content: 'PDF body text with table',
        curatorContent: 'PDF curator content',
        conversion: expect.objectContaining({
          tableAssist: expect.objectContaining({
            blocksAdded: 1,
            candidatesGrounded: 2,
          }),
        }),
      })
    );
    expect(safeDeleteMaskedObjectMock).toHaveBeenCalledWith(
      'masked/doc-1/sample.pdf'
    );
    expect(outcome).toEqual(
      expect.objectContaining({
        ok: true,
        result: {
          body: expect.objectContaining({
            kind: 'overwritten',
            tableAssist: expect.objectContaining({ blocksAdded: 1 }),
          }),
        },
      })
    );
  });

  it('clears stale chunks when the reprocessed document becomes restricted', async () => {
    orchestratePdfPathMock.mockResolvedValue({
      kind: 'restricted',
      docId: 'doc-1',
      storagePath: 'raw/doc-1/sample.pdf',
      curator: {
        ...curator,
        sensitivity: 'Confidential',
        aiUsePolicy: 'requires_masking',
      },
      curatorCompletedAt: new Date('2026-06-01T00:00:00.000Z'),
      restrictionSource: 'masker',
      sensitivityReason: 'residual risk',
      masker: {
        decision: 'restricted_promoted',
        provider: 'simple-rule',
        maskedSpansCount: 1,
        ruleHits: { email: 1 },
        residualRisk: { detected: true, reasons: ['email'] },
        rationale: 'risk',
        recommendedSensitivity: 'Restricted',
        completedAt: new Date('2026-06-01T00:00:00.000Z'),
        modelId: 'test-model',
      },
      originalCuratorSensitivity: 'Confidential',
    });

    const outcome = await reprocessPdfWithTableAssist({
      docId: 'doc-1',
      tenantId: 'tenant-1',
    });

    expect(outcome.ok).toBe(true);
    expect(clearChunksForDocMock).toHaveBeenCalledWith('doc-1');
  });

  it('rejects non official-doc-pdf before acquiring a lease', async () => {
    installFirestoreDoc({ ...baseFirestoreDoc, sourceSubtype: 'scan-pdf' });

    const outcome = await reprocessPdfWithTableAssist({
      docId: 'doc-1',
      tenantId: 'tenant-1',
    });

    expect(outcome).toEqual({
      ok: false,
      failure: { code: 'not_official_doc_pdf' },
    });
    expect(runTransactionMock).not.toHaveBeenCalled();
  });

  it('rejects with reprocess_in_progress when a fresh lease is held', async () => {
    installFirestoreDoc({
      ...baseFirestoreDoc,
      reprocessing: true,
      reprocessingStartedAt: new Date().toISOString(),
    });

    const outcome = await reprocessPdfWithTableAssist({
      docId: 'doc-1',
      tenantId: 'tenant-1',
    });

    expect(outcome).toEqual({
      ok: false,
      failure: { code: 'reprocess_in_progress' },
    });
    expect(txUpdateMock).not.toHaveBeenCalled();
    expect(dispatchPdfExtractionMock).not.toHaveBeenCalled();
    expect(orchestratePdfPathMock).not.toHaveBeenCalled();
  });

  it('steals a stale lease past the TTL and proceeds', async () => {
    installFirestoreDoc({
      ...baseFirestoreDoc,
      reprocessing: true,
      // Far older than REPROCESS_LEASE_TTL_MS (15 min) relative to now.
      reprocessingStartedAt: '2026-06-01T00:00:00.000Z',
    });

    const outcome = await reprocessPdfWithTableAssist({
      docId: 'doc-1',
      tenantId: 'tenant-1',
    });

    expect(outcome.ok).toBe(true);
    expect(txUpdateMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reprocessing: true })
    );
    expect(dispatchPdfExtractionMock).toHaveBeenCalled();
  });

  it('releases the lease after a successful reprocess', async () => {
    const outcome = await reprocessPdfWithTableAssist({
      docId: 'doc-1',
      tenantId: 'tenant-1',
    });

    expect(outcome.ok).toBe(true);
    expect(docUpdateMock).toHaveBeenCalledWith({ reprocessing: false });
  });

  it('returns raw_content_hash_mismatch and still releases the lease', async () => {
    readRawObjectMock.mockResolvedValue(Buffer.from('different bytes entirely'));

    const outcome = await reprocessPdfWithTableAssist({
      docId: 'doc-1',
      tenantId: 'tenant-1',
    });

    expect(outcome).toEqual({
      ok: false,
      failure: { code: 'raw_content_hash_mismatch' },
    });
    expect(dispatchPdfExtractionMock).not.toHaveBeenCalled();
    expect(docUpdateMock).toHaveBeenCalledWith({ reprocessing: false });
  });
});

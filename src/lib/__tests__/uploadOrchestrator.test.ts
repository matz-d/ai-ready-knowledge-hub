import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  randomUUIDMock,
  curatorFlowMock,
  maskerPipelineFlowMock,
  uploadRawObjectMock,
  deleteRawObjectMock,
  uploadMaskedObjectMock,
  deleteMaskedObjectMock,
  getKnowledgeHubBucketNameMock,
  writeDocumentIrSnapshotMock,
  documentIrToKnowledgeChunksMock,
  runConversionEvalHealthCheckMock,
  createConversionEvalStorageMock,
  appendConversionEvalMock,
  replaceChunksForDocumentMock,
  recordAuditEventMock,
  setMock,
  updateMock,
  deleteMock,
  docFnMock,
  collectionMock,
  getFirestoreClientMock,
  serverTimestampMock,
} = vi.hoisted(() => ({
  randomUUIDMock: vi.fn(),
  curatorFlowMock: vi.fn(),
  maskerPipelineFlowMock: vi.fn(),
  uploadRawObjectMock: vi.fn(),
  deleteRawObjectMock: vi.fn(),
  uploadMaskedObjectMock: vi.fn(),
  deleteMaskedObjectMock: vi.fn(),
  getKnowledgeHubBucketNameMock: vi.fn(),
  writeDocumentIrSnapshotMock: vi.fn(),
  documentIrToKnowledgeChunksMock: vi.fn(),
  runConversionEvalHealthCheckMock: vi.fn(),
  createConversionEvalStorageMock: vi.fn(),
  appendConversionEvalMock: vi.fn(),
  replaceChunksForDocumentMock: vi.fn(),
  recordAuditEventMock: vi.fn(),
  setMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  docFnMock: vi.fn(),
  collectionMock: vi.fn(),
  getFirestoreClientMock: vi.fn(),
  serverTimestampMock: vi.fn(),
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomUUID: randomUUIDMock,
  };
});

vi.mock('../../agents/curator/flow', () => ({
  curatorFlow: curatorFlowMock,
}));

vi.mock('../../agents/masker/pipelineFlow', () => ({
  maskerPipelineFlow: maskerPipelineFlowMock,
}));

vi.mock('../../agents/_shared/genkitClient', () => ({
  modelId: 'test-model',
}));

vi.mock('../storage', () => ({
  uploadRawObject: uploadRawObjectMock,
  deleteRawObject: deleteRawObjectMock,
  uploadMaskedObject: uploadMaskedObjectMock,
  deleteMaskedObject: deleteMaskedObjectMock,
  getKnowledgeHubBucketName: getKnowledgeHubBucketNameMock,
}));

vi.mock('../documentIrStorage', () => ({
  DOCUMENT_IR_GCS_VERSION: 'v1',
  writeDocumentIrSnapshot: writeDocumentIrSnapshotMock,
}));

vi.mock('../../eval/conversion/documentIrToKnowledgeChunk', () => ({
  documentIrToKnowledgeChunks: documentIrToKnowledgeChunksMock,
}));

vi.mock('../../eval/conversion/runConversionEvalHealthCheck', () => ({
  runConversionEvalHealthCheck: runConversionEvalHealthCheckMock,
}));

vi.mock('../conversionEvalStorage', () => ({
  createConversionEvalStorage: createConversionEvalStorageMock,
}));

vi.mock('../chunkFirestoreAdapter', () => ({
  createChunkFirestoreAdapter: vi.fn(() => ({
    replaceChunksForDocument: replaceChunksForDocumentMock,
  })),
}));

vi.mock('../audit/auditEvent', async () => {
  const actual = await vi.importActual<typeof import('../audit/auditEvent')>(
    '../audit/auditEvent'
  );
  return {
    ...actual,
    recordAuditEvent: recordAuditEventMock,
  };
});

const docMock = {
  set: setMock,
  update: updateMock,
  delete: deleteMock,
};
docFnMock.mockImplementation(() => docMock);
collectionMock.mockImplementation(() => ({ doc: docFnMock }));
getFirestoreClientMock.mockImplementation(() => ({ collection: collectionMock }));
serverTimestampMock.mockImplementation(() => 'SERVER_TIMESTAMP');
vi.mock('../firestore', () => ({
  FieldValue: {
    serverTimestamp: serverTimestampMock,
  },
  getFirestoreClient: getFirestoreClientMock,
}));

import type { DocumentIr } from '../../eval/conversion/documentIr';
import {
  CuratorPhaseError,
  MaskerPhaseError,
  orchestrateUploadProcessing,
} from '../uploadOrchestrator';

const minimalDocumentIr: DocumentIr = {
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

const pdfBaseInput = {
  displayName: 'sample.pdf',
  contentType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 fake', 'utf-8'),
  content: 'PDF body text',
  documentIr: minimalDocumentIr,
  sourceSubtype: 'official-doc-pdf' as const,
};

const baseInput = {
  displayName: 'sample.txt',
  contentType: 'text/plain',
  buffer: Buffer.from('hello world', 'utf-8'),
  content: 'hello world',
} as const;

const curatorDirectResult = {
  documentType: 'メモ',
  businessDomain: '社内手順',
  sensitivity: 'Internal',
  freshness: 'current',
  isAuthoritativeCandidate: true,
  aiUsePolicy: 'direct',
  rationale: 'direct',
} as const;

const curatorBlockedResult = {
  documentType: '契約書',
  businessDomain: '顧問契約管理',
  sensitivity: 'Restricted',
  freshness: 'current',
  isAuthoritativeCandidate: true,
  aiUsePolicy: 'blocked',
  rationale: 'blocked',
} as const;

const curatorRequiresMaskingResult = {
  documentType: 'メモ',
  businessDomain: '顧客対応',
  sensitivity: 'Confidential',
  freshness: 'current',
  isAuthoritativeCandidate: true,
  aiUsePolicy: 'requires_masking',
  rationale: 'masking',
} as const;

const aiSafePipelineResult = {
  decision: 'ai_safe_ready',
  aiSafeVersion: {
    fileName: 'sample.txt',
    provider: 'simple-rule',
    maskedContent: 'MASKED',
    maskedSpans: [
      {
        start: 0,
        end: 5,
        type: 'CUSTOM_RULE',
        ruleId: 'rule_1',
      },
    ],
    generatedAt: new Date().toISOString(),
    sourceContentHash: 'hash',
    residualRisk: { detected: false, reasons: ['ok'] },
    schemaVersion: 1,
  },
  curatorFeedback: null,
  rawRiskOutput: {
    residualRisk: { detected: false, reasons: ['ok'] },
    recommendedSensitivity: 'Confidential',
    rationale: 'safe',
  },
  maskingResult: {
    provider: 'simple-rule',
    maskedContent: 'MASKED',
    maskedSpans: [
      {
        start: 0,
        end: 5,
        type: 'CUSTOM_RULE',
        ruleId: 'rule_1',
      },
    ],
    ruleHits: { rule_1: 1 },
  },
} as const;

const restrictedPipelineResult = {
  decision: 'restricted_promoted',
  aiSafeVersion: null,
  curatorFeedback: {
    newSensitivity: 'Restricted',
    newAiUsePolicy: 'blocked',
    reason: 'residual risk',
  },
  rawRiskOutput: {
    residualRisk: { detected: true, reasons: ['high reidentification'] },
    recommendedSensitivity: 'Restricted',
    rationale: 'restricted required',
  },
  maskingResult: {
    provider: 'simple-rule',
    maskedContent: 'MASKED',
    maskedSpans: [],
    ruleHits: {},
  },
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  randomUUIDMock.mockReturnValue('doc-1');
  recordAuditEventMock.mockResolvedValue('evt-1');
  setMock.mockResolvedValue(undefined);
  updateMock.mockResolvedValue(undefined);
  deleteMock.mockResolvedValue(undefined);
  uploadRawObjectMock.mockResolvedValue(undefined);
  deleteRawObjectMock.mockResolvedValue(undefined);
  uploadMaskedObjectMock.mockResolvedValue(undefined);
  deleteMaskedObjectMock.mockResolvedValue(undefined);
  getKnowledgeHubBucketNameMock.mockReturnValue('bucket-1');
  writeDocumentIrSnapshotMock.mockResolvedValue('raw/doc-1/document-ir/v1.json');
  runConversionEvalHealthCheckMock.mockReturnValue({
    overall: { status: 'pass', reasons: [] },
  });
  appendConversionEvalMock.mockImplementation(async (input: {
    docId: string;
    revisionId: string;
    stage: 'health';
    result: unknown;
  }) => ({
    evalId: `${input.docId}:${input.revisionId}`,
    docId: input.docId,
    revisionId: input.revisionId,
    stage: input.stage,
    result: input.result,
    createdAt: '2026-01-01T00:00:00.000Z',
  }));
  createConversionEvalStorageMock.mockReturnValue({
    appendConversionEval: appendConversionEvalMock,
    getLatestForDocument: vi.fn(),
  });
  documentIrToKnowledgeChunksMock.mockReturnValue([
    {
      id: 'chunk-1',
      docId: 'doc-1',
      schemaVersion: 1,
      sourceType: 'pdf',
      structureType: 'paragraph',
      locator: { kind: 'pdf', pageNumber: 1, blockId: 'p1-b0' },
      text: 'PDF body text',
      sensitivity: 'Internal',
      aiUsePolicy: 'direct',
      sensitivitySource: 'inherited',
      extractionProvider: 'pdf-parse',
      sourceHash: 'hash',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ]);
  replaceChunksForDocumentMock.mockResolvedValue(undefined);
});

describe('orchestrateUploadProcessing', () => {
  it('returns curated when curator decides direct', async () => {
    curatorFlowMock.mockResolvedValue(curatorDirectResult);

    const result = await orchestrateUploadProcessing(baseInput);

    expect(result.kind).toBe('curated');
    expect(uploadRawObjectMock).toHaveBeenCalledWith(
      'raw/doc-1/sample.txt',
      baseInput.buffer,
      'text/plain'
    );
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKind: 'upload',
        externalSource: null,
      })
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'curated', aiUsePolicy: 'direct' })
    );
  });

  it('returns ai_safe and writes masked object when masker decides ai_safe_ready', async () => {
    randomUUIDMock.mockReturnValue('doc-2');
    curatorFlowMock.mockResolvedValue(curatorRequiresMaskingResult);
    maskerPipelineFlowMock.mockResolvedValue(aiSafePipelineResult);

    const result = await orchestrateUploadProcessing(baseInput);

    expect(result.kind).toBe('ai_safe');
    if (result.kind !== 'ai_safe') {
      throw new Error('expected ai_safe result');
    }
    expect(result.aiSafeStoragePath).toBe('masked/doc-2/sample.txt');
    expect(uploadMaskedObjectMock).toHaveBeenCalledWith(
      'masked/doc-2/sample.txt',
      'MASKED',
      expect.objectContaining({
        aiSafeSchemaVersion: 1,
        provider: 'simple-rule',
      })
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ai_safe',
        aiSafeStoragePath: 'masked/doc-2/sample.txt',
      })
    );
  });

  it('rolls back masked object and records failed masker error when ai_safe firestore update fails', async () => {
    randomUUIDMock.mockReturnValue('doc-3');
    curatorFlowMock.mockResolvedValue(curatorRequiresMaskingResult);
    maskerPipelineFlowMock.mockResolvedValue({
      ...aiSafePipelineResult,
      aiSafeVersion: {
        ...aiSafePipelineResult.aiSafeVersion,
        maskedSpans: [],
      },
      maskingResult: {
        ...aiSafePipelineResult.maskingResult,
        maskedSpans: [],
        ruleHits: {},
      },
    });
    updateMock.mockImplementation(async (payload: Record<string, unknown>) => {
      if (payload.status === 'ai_safe') {
        throw new Error('firestore update failed');
      }
    });

    await expect(orchestrateUploadProcessing(baseInput)).rejects.toBeInstanceOf(
      MaskerPhaseError
    );

    expect(deleteMaskedObjectMock).toHaveBeenCalledWith('masked/doc-3/sample.txt');
    const failedCall = updateMock.mock.calls.find(
      ([payload]) =>
        payload &&
        typeof payload === 'object' &&
        (payload as Record<string, unknown>).status === 'failed'
    );
    expect(failedCall).toBeTruthy();
    expect((failedCall?.[0] as Record<string, unknown>).maskerError).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('マスク処理に失敗しました。'),
      })
    );
  });

  it('returns blocked when curator decides blocked', async () => {
    randomUUIDMock.mockReturnValue('doc-4');
    curatorFlowMock.mockResolvedValue(curatorBlockedResult);

    const result = await orchestrateUploadProcessing(baseInput);

    expect(result.kind).toBe('blocked');
    expect(maskerPipelineFlowMock).not.toHaveBeenCalled();
    expect(uploadMaskedObjectMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'blocked', aiUsePolicy: 'blocked' })
    );
  });

  it('returns restricted and does not write masked object when masker promotes restriction', async () => {
    randomUUIDMock.mockReturnValue('doc-5');
    curatorFlowMock.mockResolvedValue(curatorRequiresMaskingResult);
    maskerPipelineFlowMock.mockResolvedValue(restrictedPipelineResult);

    const result = await orchestrateUploadProcessing(baseInput);

    expect(result.kind).toBe('restricted');
    expect(uploadMaskedObjectMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'restricted',
        aiSafeStoragePath: null,
        sensitivitySource: 'masker',
        aiUsePolicy: 'blocked',
      })
    );
  });

  it('throws and stops when raw upload fails before Firestore write', async () => {
    uploadRawObjectMock.mockRejectedValue(new Error('raw upload failed'));

    await expect(orchestrateUploadProcessing(baseInput)).rejects.toThrow(
      'raw upload failed'
    );

    expect(setMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteRawObjectMock).not.toHaveBeenCalled();
  });

  it('rolls back raw object when Firestore initial set fails', async () => {
    randomUUIDMock.mockReturnValue('doc-6');
    setMock.mockRejectedValue(new Error('set failed'));

    await expect(orchestrateUploadProcessing(baseInput)).rejects.toThrow(
      'set failed'
    );

    expect(deleteRawObjectMock).toHaveBeenCalledWith('raw/doc-6/sample.txt');
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('rolls back raw and firestore doc when curating update fails', async () => {
    randomUUIDMock.mockReturnValue('doc-7');
    updateMock.mockImplementation(async (payload: Record<string, unknown>) => {
      if (payload.status === 'curating') {
        throw new Error('curating failed');
      }
    });

    await expect(orchestrateUploadProcessing(baseInput)).rejects.toThrow(
      'curating failed'
    );

    expect(deleteRawObjectMock).toHaveBeenCalledWith('raw/doc-7/sample.txt');
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it('records failed status with maskerError when masker pipeline throws', async () => {
    randomUUIDMock.mockReturnValue('doc-8');
    curatorFlowMock.mockResolvedValue(curatorRequiresMaskingResult);
    maskerPipelineFlowMock.mockRejectedValue(new Error('pipeline timeout'));

    await expect(orchestrateUploadProcessing(baseInput)).rejects.toBeInstanceOf(
      MaskerPhaseError
    );

    expect(deleteMaskedObjectMock).not.toHaveBeenCalled();
    const failedCall = updateMock.mock.calls.find(
      ([payload]) =>
        payload &&
        typeof payload === 'object' &&
        (payload as Record<string, unknown>).status === 'failed'
    );
    expect(failedCall).toBeTruthy();
    expect((failedCall?.[0] as Record<string, unknown>).maskerError).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('pipeline timeout'),
      })
    );
  });

  it('keeps the original masker error when failed-status recording also fails', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      randomUUIDMock.mockReturnValue('doc-11');
      curatorFlowMock.mockResolvedValue(curatorRequiresMaskingResult);
      maskerPipelineFlowMock.mockRejectedValue(new Error('pipeline timeout'));
      updateMock.mockImplementation(async (payload: Record<string, unknown>) => {
        if (payload.status === 'failed') {
          throw new Error('failed status update failed');
        }
      });

      await expect(orchestrateUploadProcessing(baseInput)).rejects.toMatchObject({
        name: 'MaskerPhaseError',
        message: 'pipeline timeout',
        docId: 'doc-11',
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[orchestrator] masker failed status update',
        expect.any(Error)
      );
      expect(deleteMaskedObjectMock).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('fails masker phase when ai_safe decision has no aiSafeVersion and records maskerError', async () => {
    randomUUIDMock.mockReturnValue('doc-9');
    curatorFlowMock.mockResolvedValue(curatorRequiresMaskingResult);
    maskerPipelineFlowMock.mockResolvedValue({
      ...aiSafePipelineResult,
      aiSafeVersion: null,
    });

    await expect(orchestrateUploadProcessing(baseInput)).rejects.toBeInstanceOf(
      MaskerPhaseError
    );

    expect(uploadMaskedObjectMock).not.toHaveBeenCalled();
    expect(deleteMaskedObjectMock).not.toHaveBeenCalled();
    const failedCall = updateMock.mock.calls.find(
      ([payload]) =>
        payload &&
        typeof payload === 'object' &&
        (payload as Record<string, unknown>).status === 'failed'
    );
    expect(failedCall).toBeTruthy();
  });

  describe('PDF path (Phase 3-H-2 M1)', () => {
    it('writes DocumentIR, health eval, and chunks for direct PDFs', async () => {
      randomUUIDMock.mockReturnValue('doc-pdf-direct');
      curatorFlowMock.mockResolvedValue(curatorDirectResult);

      const result = await orchestrateUploadProcessing(pdfBaseInput);

      expect(result).toEqual(
        expect.objectContaining({ kind: 'curated', docId: 'doc-pdf-direct' })
      );
      expect(writeDocumentIrSnapshotMock).toHaveBeenCalledWith(
        expect.objectContaining({
          bucketName: 'bucket-1',
          docId: 'doc-pdf-direct',
          documentIr: minimalDocumentIr,
        })
      );
      expect(documentIrToKnowledgeChunksMock).toHaveBeenCalled();
      expect(runConversionEvalHealthCheckMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceSubtype: 'official-doc-pdf',
          schemaValidity: { passed: true },
        })
      );
      expect(appendConversionEvalMock).toHaveBeenCalledTimes(1);
      expect(appendConversionEvalMock).toHaveBeenCalledWith(
        expect.objectContaining({
          docId: 'doc-pdf-direct',
          revisionId: 'v1',
          stage: 'health',
        })
      );
      expect(replaceChunksForDocumentMock).toHaveBeenCalledWith(
        'doc-pdf-direct',
        expect.any(Array),
        expect.objectContaining({ extractorInput: 'PDF body text' })
      );
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          latestConversionEvalId: 'doc-pdf-direct:v1',
        })
      );
      expect(maskerPipelineFlowMock).not.toHaveBeenCalled();
    });

    it('writes DocumentIR but not chunks for requires_masking PDFs', async () => {
      randomUUIDMock.mockReturnValue('doc-pdf-mask');
      curatorFlowMock.mockResolvedValue(curatorRequiresMaskingResult);

      const result = await orchestrateUploadProcessing(pdfBaseInput);

      expect(result).toEqual(
        expect.objectContaining({
          kind: 'curated',
          docId: 'doc-pdf-mask',
          maskingPending: true,
        })
      );
      expect(writeDocumentIrSnapshotMock).toHaveBeenCalled();
      expect(documentIrToKnowledgeChunksMock).toHaveBeenCalledTimes(1);
      expect(replaceChunksForDocumentMock).not.toHaveBeenCalled();
      expect(appendConversionEvalMock).toHaveBeenCalledTimes(1);
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          latestConversionEvalId: 'doc-pdf-mask:v1',
        })
      );
      const curatedParkCall = updateMock.mock.calls.find(
        ([payload]) =>
          payload &&
          typeof payload === 'object' &&
          (payload as Record<string, unknown>).status === 'curated' &&
          (payload as Record<string, unknown>).maskingPending === true
      );
      expect(curatedParkCall).toBeTruthy();
      const parkCallIndex = updateMock.mock.calls.indexOf(curatedParkCall!);
      const evalIdUpdateIndex = updateMock.mock.calls.findIndex(
        ([payload]) =>
          payload &&
          typeof payload === 'object' &&
          (payload as Record<string, unknown>).latestConversionEvalId ===
            'doc-pdf-mask:v1'
      );
      expect(parkCallIndex).toBeGreaterThan(evalIdUpdateIndex);
    });

    it('continues PDF flow when health eval persistence fails', async () => {
      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      try {
        randomUUIDMock.mockReturnValue('doc-pdf-eval-fail');
        curatorFlowMock.mockResolvedValue(curatorDirectResult);
        appendConversionEvalMock.mockRejectedValue(new Error('eval write failed'));

        const result = await orchestrateUploadProcessing(pdfBaseInput);

        expect(result).toEqual(
          expect.objectContaining({ kind: 'curated', docId: 'doc-pdf-eval-fail' })
        );
        expect(replaceChunksForDocumentMock).toHaveBeenCalledWith(
          'doc-pdf-eval-fail',
          expect.any(Array),
          expect.objectContaining({ extractorInput: 'PDF body text' })
        );
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          '[orchestrator] conversion eval health write skipped',
          expect.any(Error)
        );
        const failedCall = updateMock.mock.calls.find(
          ([payload]) =>
            payload &&
            typeof payload === 'object' &&
            (payload as Record<string, unknown>).status === 'failed'
        );
        expect(failedCall).toBeUndefined();
      } finally {
        consoleWarnSpy.mockRestore();
      }
    });

    it('marks failed and rethrows when DocumentIR write fails on direct path', async () => {
      randomUUIDMock.mockReturnValue('doc-pdf-ir-fail');
      curatorFlowMock.mockResolvedValue(curatorDirectResult);
      writeDocumentIrSnapshotMock.mockRejectedValue(new Error('gcs write failed'));

      await expect(orchestrateUploadProcessing(pdfBaseInput)).rejects.toThrow(
        'gcs write failed'
      );

      const failedCall = updateMock.mock.calls.find(
        ([payload]) =>
          payload &&
          typeof payload === 'object' &&
          (payload as Record<string, unknown>).status === 'failed'
      );
      expect(failedCall).toBeTruthy();
      expect((failedCall?.[0] as Record<string, unknown>).conversionError).toEqual(
        expect.objectContaining({
          message: expect.stringContaining('gcs write failed'),
        })
      );
    });

    it('marks failed and rethrows when chunk replacement fails on direct path', async () => {
      randomUUIDMock.mockReturnValue('doc-pdf-chunk-fail');
      curatorFlowMock.mockResolvedValue(curatorDirectResult);
      replaceChunksForDocumentMock.mockRejectedValue(new Error('chunk replace failed'));

      await expect(orchestrateUploadProcessing(pdfBaseInput)).rejects.toThrow(
        'chunk replace failed'
      );

      const failedCall = updateMock.mock.calls.find(
        ([payload]) =>
          payload &&
          typeof payload === 'object' &&
          (payload as Record<string, unknown>).status === 'failed'
      );
      expect(failedCall).toBeTruthy();
      expect((failedCall?.[0] as Record<string, unknown>).conversionError).toEqual(
        expect.objectContaining({
          message: expect.stringContaining('chunk replace failed'),
        })
      );
    });

    it('records document.convert with pdf-parse and no inferenceDestination for official-doc-pdf', async () => {
      randomUUIDMock.mockReturnValue('doc-pdf-audit-official');
      curatorFlowMock.mockResolvedValue(curatorDirectResult);

      await orchestrateUploadProcessing({
        ...pdfBaseInput,
        auditContext: {
          tenantId: 'customer.example',
          actor: {
            userId: 'alice@customer.example',
            ipAddress: '203.0.113.10',
            userAgent: 'vitest',
          },
        },
        conversion: { converterId: 'pdf-parse' },
      });

      expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
      const payload = recordAuditEventMock.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
      expect(payload.action).toBe('document.convert');
      expect(payload.conversion).toEqual(
        expect.objectContaining({
          converterId: 'pdf-parse',
          sourceSubtype: 'official-doc-pdf',
        })
      );
      expect(payload.inferenceDestination).toBeUndefined();
    });

    it('records document.convert with gemini-direct-read + inferenceDestination for slide-pdf Vertex success', async () => {
      randomUUIDMock.mockReturnValue('doc-pdf-audit-slide');
      curatorFlowMock.mockResolvedValue(curatorDirectResult);

      const slideDocumentIr: DocumentIr = {
        ...minimalDocumentIr,
        source: {
          ...minimalDocumentIr.source,
          sourceSubtype: 'slide-pdf',
        },
      };

      await orchestrateUploadProcessing({
        ...pdfBaseInput,
        documentIr: slideDocumentIr,
        sourceSubtype: 'slide-pdf',
        auditContext: {
          tenantId: 'customer.example',
          actor: {
            userId: 'alice@customer.example',
            ipAddress: '203.0.113.10',
            userAgent: 'vitest',
          },
        },
        conversion: {
          converterId: 'gemini-direct-read',
          inferenceDestination: {
            vendor: 'vertex',
            region: 'asia-northeast1',
            model: 'gemini-2.5-flash',
          },
        },
      });

      expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
      const payload = recordAuditEventMock.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
      expect(payload.conversion).toEqual(
        expect.objectContaining({
          converterId: 'gemini-direct-read',
          sourceSubtype: 'slide-pdf',
        })
      );
      expect(payload.inferenceDestination).toEqual({
        vendor: 'vertex',
        region: 'asia-northeast1',
        model: 'gemini-2.5-flash',
      });
    });

    it('rethrows inferenceDestination invariant violations from document.convert audit', async () => {
      const { ConversionInferenceDestinationInvariantError } =
        await vi.importActual<typeof import('../audit/auditEvent')>(
          '../audit/auditEvent'
        );
      randomUUIDMock.mockReturnValue('doc-pdf-audit-invariant');
      curatorFlowMock.mockResolvedValue(curatorDirectResult);
      recordAuditEventMock.mockRejectedValue(
        new ConversionInferenceDestinationInvariantError(
          'document.convert: inferenceDestination is required for converterId=gemini-direct-read on sourceSubtype=slide-pdf'
        )
      );

      const slideDocumentIr: DocumentIr = {
        ...minimalDocumentIr,
        source: {
          ...minimalDocumentIr.source,
          sourceSubtype: 'slide-pdf',
        },
      };

      await expect(
        orchestrateUploadProcessing({
          ...pdfBaseInput,
          documentIr: slideDocumentIr,
          sourceSubtype: 'slide-pdf',
          auditContext: {
            tenantId: 'customer.example',
            actor: {
              userId: 'alice@customer.example',
              ipAddress: '203.0.113.10',
              userAgent: 'vitest',
            },
          },
          conversion: {
            converterId: 'gemini-direct-read',
            // wiring mistake: missing inferenceDestination
          },
        })
      ).rejects.toBeInstanceOf(ConversionInferenceDestinationInvariantError);
    });

    it('continues curated upload when document.convert audit storage fails', async () => {
      randomUUIDMock.mockReturnValue('doc-pdf-audit-storage-fail');
      curatorFlowMock.mockResolvedValue(curatorDirectResult);
      recordAuditEventMock.mockRejectedValue(new Error('firestore unavailable'));

      const result = await orchestrateUploadProcessing({
        ...pdfBaseInput,
        auditContext: {
          tenantId: 'customer.example',
          actor: {
            userId: 'alice@customer.example',
            ipAddress: '203.0.113.10',
            userAgent: 'vitest',
          },
        },
        conversion: { converterId: 'pdf-parse' },
      });

      expect(result.kind).toBe('curated');
      expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
    });

    it('records document.convert without inferenceDestination for slide-pdf pdf-parse-fallback', async () => {
      randomUUIDMock.mockReturnValue('doc-pdf-audit-slide-fb');
      curatorFlowMock.mockResolvedValue(curatorDirectResult);

      const slideDocumentIr: DocumentIr = {
        ...minimalDocumentIr,
        source: {
          ...minimalDocumentIr.source,
          sourceSubtype: 'slide-pdf',
        },
      };

      await orchestrateUploadProcessing({
        ...pdfBaseInput,
        documentIr: slideDocumentIr,
        sourceSubtype: 'slide-pdf',
        auditContext: {
          tenantId: 'customer.example',
          actor: {
            userId: 'alice@customer.example',
            ipAddress: '203.0.113.10',
            userAgent: 'vitest',
          },
        },
        conversion: { converterId: 'pdf-parse-fallback' },
      });

      expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
      const payload = recordAuditEventMock.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
      expect(payload.conversion).toEqual(
        expect.objectContaining({
          converterId: 'pdf-parse-fallback',
          sourceSubtype: 'slide-pdf',
        })
      );
      expect(payload.inferenceDestination).toBeUndefined();
    });

    it('marks failed when DocumentIR write fails on requires_masking path', async () => {
      randomUUIDMock.mockReturnValue('doc-pdf-mask-ir-fail');
      curatorFlowMock.mockResolvedValue(curatorRequiresMaskingResult);
      writeDocumentIrSnapshotMock.mockRejectedValue(new Error('gcs write failed'));

      await expect(orchestrateUploadProcessing(pdfBaseInput)).rejects.toThrow(
        'gcs write failed'
      );

      const failedCall = updateMock.mock.calls.find(
        ([payload]) =>
          payload &&
          typeof payload === 'object' &&
          (payload as Record<string, unknown>).status === 'failed'
      );
      expect(failedCall).toBeTruthy();
      expect((failedCall?.[0] as Record<string, unknown>).conversionError).toEqual(
        expect.objectContaining({
          message: expect.stringContaining('gcs write failed'),
        })
      );
    });
  });

  it('wraps curator exceptions as CuratorPhaseError and records curatorError', async () => {
    randomUUIDMock.mockReturnValue('doc-10');
    curatorFlowMock.mockRejectedValue(new Error('curator unavailable'));

    await expect(orchestrateUploadProcessing(baseInput)).rejects.toBeInstanceOf(
      CuratorPhaseError
    );

    const failedCall = updateMock.mock.calls.find(
      ([payload]) =>
        payload &&
        typeof payload === 'object' &&
        (payload as Record<string, unknown>).status === 'failed'
    );
    expect(failedCall).toBeTruthy();
    expect((failedCall?.[0] as Record<string, unknown>).curatorError).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('curator unavailable'),
      })
    );
  });
});

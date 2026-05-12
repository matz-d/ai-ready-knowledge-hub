import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  randomUUIDMock,
  curatorFlowMock,
  maskerPipelineFlowMock,
  uploadRawObjectMock,
  deleteRawObjectMock,
  uploadMaskedObjectMock,
  deleteMaskedObjectMock,
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
}));

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

import {
  CuratorPhaseError,
  MaskerPhaseError,
  orchestrateUploadProcessing,
} from '../uploadOrchestrator';

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
  setMock.mockResolvedValue(undefined);
  updateMock.mockResolvedValue(undefined);
  deleteMock.mockResolvedValue(undefined);
  uploadRawObjectMock.mockResolvedValue(undefined);
  deleteRawObjectMock.mockResolvedValue(undefined);
  uploadMaskedObjectMock.mockResolvedValue(undefined);
  deleteMaskedObjectMock.mockResolvedValue(undefined);
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

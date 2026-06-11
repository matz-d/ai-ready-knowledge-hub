import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  claimContextPackageJobMock,
  getContextPackageJobMock,
  completeContextPackageJobMock,
  completeContextPackageJobWithResultRefMock,
  failContextPackageJobMock,
  releaseContextPackageJobLeaseMock,
  updateContextPackageJobProgressMock,
  deleteContextPackageJobResultMock,
  writeContextPackageJobResultMock,
  runStrategistOrchestratorMock,
  recordAuditEventMock,
  StrategistFullCoverageLeaseLostErrorMock,
  NoInventoryDocumentsErrorMock,
  UnresolvedDocIdsErrorMock,
} = vi.hoisted(() => {
  class StrategistFullCoverageLeaseLostErrorMock extends Error {
    constructor() {
      super('full coverage job lease was lost during batch progress update.');
      this.name = 'StrategistFullCoverageLeaseLostError';
    }
  }
  class NoInventoryDocumentsErrorMock extends Error {
    constructor() {
      super('No terminal inventory documents found.');
      this.name = 'NoInventoryDocumentsError';
    }
  }
  class UnresolvedDocIdsErrorMock extends Error {
    readonly unknownDocIds: string[];
    readonly nonTerminalDocIds: { docId: string; status: string }[];
    constructor(params: {
      unknownDocIds: string[];
      nonTerminalDocIds: { docId: string; status: string }[];
    }) {
      super('unresolved');
      this.name = 'UnresolvedDocIdsError';
      this.unknownDocIds = params.unknownDocIds;
      this.nonTerminalDocIds = params.nonTerminalDocIds;
    }
  }
  return {
    claimContextPackageJobMock: vi.fn(),
    getContextPackageJobMock: vi.fn(),
    completeContextPackageJobMock: vi.fn(),
    completeContextPackageJobWithResultRefMock: vi.fn(),
    failContextPackageJobMock: vi.fn(),
    releaseContextPackageJobLeaseMock: vi.fn(),
    updateContextPackageJobProgressMock: vi.fn(),
    deleteContextPackageJobResultMock: vi.fn(),
    writeContextPackageJobResultMock: vi.fn(),
    runStrategistOrchestratorMock: vi.fn(),
    recordAuditEventMock: vi.fn(),
    StrategistFullCoverageLeaseLostErrorMock,
    NoInventoryDocumentsErrorMock,
    UnresolvedDocIdsErrorMock,
  };
});

vi.mock('../firestoreAdapter', () => ({
  claimContextPackageJob: claimContextPackageJobMock,
  getContextPackageJob: getContextPackageJobMock,
  completeContextPackageJob: completeContextPackageJobMock,
  completeContextPackageJobWithResultRef:
    completeContextPackageJobWithResultRefMock,
  failContextPackageJob: failContextPackageJobMock,
  releaseContextPackageJobLease: releaseContextPackageJobLeaseMock,
  updateContextPackageJobProgress: updateContextPackageJobProgressMock,
}));

vi.mock('../resultStorage', () => ({
  deleteContextPackageJobResult: deleteContextPackageJobResultMock,
  writeContextPackageJobResult: writeContextPackageJobResultMock,
}));

vi.mock('../../../services/strategistOrchestrator', async () => {
  const payload = await vi.importActual<
    typeof import('../../../services/strategistOrchestrator/contextPackagePayload')
  >('../../../services/strategistOrchestrator/contextPackagePayload');
  const auditTarget = await vi.importActual<
    typeof import('../../../services/strategistOrchestrator/auditTarget')
  >('../../../services/strategistOrchestrator/auditTarget');
  return {
    runStrategistOrchestrator: runStrategistOrchestratorMock,
    buildContextPackageResponsePayload: payload.buildContextPackageResponsePayload,
    contextPackageAuditTarget: auditTarget.contextPackageAuditTarget,
    NoInventoryDocumentsError: NoInventoryDocumentsErrorMock,
    NoKnowledgeChunksError: class extends Error {},
    StrategistFullCoverageLeaseLostError:
      StrategistFullCoverageLeaseLostErrorMock,
    StrategistSyncBudgetExceededError: class extends Error {},
    UnresolvedDocIdsError: UnresolvedDocIdsErrorMock,
  };
});

vi.mock('../../audit/auditEvent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../audit/auditEvent')>();
  return { ...actual, recordAuditEvent: recordAuditEventMock };
});

import { runContextPackageJob } from '../runJob';

const ATTEMPT_TOKEN = 'attempt-token-1';

const STUB_PARENT = {
  id: 'doc-1',
  fileName: 'Runbook.md',
  documentType: 'メモ' as const,
  businessDomain: '社内手順' as const,
  freshness: 'current' as const,
  isAuthoritativeCandidate: true,
  updatedAt: '2026-05-14T00:00:00.000Z',
};

const STUB_CHUNK = {
  docId: 'doc-1',
  id: 'chunk-1',
  schemaVersion: 1 as const,
  sourceType: 'text' as const,
  structureType: 'paragraph' as const,
  locator: { kind: 'paragraph' as const },
  text: 'stub',
  sensitivity: 'Internal' as const,
  aiUsePolicy: 'direct' as const,
  sensitivitySource: 'inherited' as const,
  extractionProvider: 'text' as const,
  sourceHash: 'stub-hash',
  createdAt: '2026-05-14T00:00:00.000Z',
};

function stubResult() {
  return {
    purpose: 'テスト用途',
    generatedAt: '2026-05-14T00:00:00.000Z',
    sourceDocumentsReviewed: 3,
    included: [
      {
        docId: 'doc-1',
        chunkId: 'chunk-1',
        rationale: '目的に合致',
        confidence: 0.9,
        chunk: STUB_CHUNK,
        parent: STUB_PARENT,
      },
    ],
    excluded: [],
    safetyExcluded: [],
    missing: [],
    humanReviewQuestions: [],
    budget: {
      config: {
        maxDocuments: 5,
        maxChunks: 80,
        maxTotalPromptChars: 80_000,
        maxCharsPerChunk: 1_200,
      },
      totalCandidates: 1,
      keptChunks: 1,
      droppedChunks: 0,
      keptDocuments: 1,
      estimatedPromptChars: 100,
      estimatedPromptTokens: 50,
    },
    budgetDroppedDocuments: [],
    syncEstimateSeconds: 3,
  };
}

const JOB = {
  jobId: 'job-1',
  status: 'running' as const,
  request: {
    purpose: 'テスト用途',
    limit: 50,
    tenantId: 'tenant-1',
    actor: { userId: 'u1', ipAddress: '', userAgent: '' },
  },
  createdAt: '2026-05-14T00:00:00.000Z',
  updatedAt: '2026-05-14T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  claimContextPackageJobMock.mockResolvedValue({
    claimed: true,
    attemptToken: ATTEMPT_TOKEN,
  });
  completeContextPackageJobMock.mockResolvedValue(true);
  completeContextPackageJobWithResultRefMock.mockResolvedValue(true);
  failContextPackageJobMock.mockResolvedValue(true);
  releaseContextPackageJobLeaseMock.mockResolvedValue(true);
  updateContextPackageJobProgressMock.mockResolvedValue(true);
  deleteContextPackageJobResultMock.mockResolvedValue(undefined);
  writeContextPackageJobResultMock.mockResolvedValue({
    storage: 'gcs',
    bucket: 'test-bucket',
    objectPath: 'context-package/job-results/tenant-1/job-1.json',
    contentType: 'application/json',
    byteSize: 900_001,
  });
  recordAuditEventMock.mockResolvedValue('audit-id');
});

describe('runContextPackageJob', () => {
  it('active lease で claim できないとき orchestrator を呼ばず skip する', async () => {
    claimContextPackageJobMock.mockResolvedValue({
      claimed: false,
      reason: 'active_lease',
    });

    const outcome = await runContextPackageJob('job-1');

    expect(outcome).toEqual({ outcome: 'skipped', reason: 'active_lease' });
    expect(runStrategistOrchestratorMock).not.toHaveBeenCalled();
    expect(completeContextPackageJobMock).not.toHaveBeenCalled();
  });

  it('terminal skip は succeeded 済みなどの重複配信', async () => {
    claimContextPackageJobMock.mockResolvedValue({
      claimed: false,
      reason: 'terminal',
    });

    const outcome = await runContextPackageJob('job-1');

    expect(outcome).toEqual({ outcome: 'skipped', reason: 'terminal' });
    expect(runStrategistOrchestratorMock).not.toHaveBeenCalled();
  });

  it('claim 成功で orchestrator を実行し attemptToken 付きで complete する', async () => {
    getContextPackageJobMock.mockResolvedValue(JOB);
    runStrategistOrchestratorMock.mockResolvedValue(stubResult());

    const outcome = await runContextPackageJob('job-1');

    expect(outcome).toEqual({ outcome: 'claimed_and_run', status: 'succeeded' });
    expect(runStrategistOrchestratorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enforceSyncBudget: false,
        coverage: 'full',
        limit: 50,
      }),
      expect.objectContaining({
        onBatchProgress: expect.any(Function),
      }),
    );
    const progressCallback =
      runStrategistOrchestratorMock.mock.calls[0][1].onBatchProgress;
    await progressCallback({ batchesCompleted: 1, batchesTotal: 2 });
    expect(updateContextPackageJobProgressMock).toHaveBeenCalledWith(
      'job-1',
      ATTEMPT_TOKEN,
      { batchesCompleted: 1, batchesTotal: 2 },
    );
    const [jobId, token, payload, progress] =
      completeContextPackageJobMock.mock.calls[0];
    expect(jobId).toBe('job-1');
    expect(token).toBe(ATTEMPT_TOKEN);
    expect(payload).toMatchObject({ purpose: 'テスト用途' });
    expect(progress).toEqual({
      sourceDocumentsReviewed: 3,
      safeChunks: 1,
      budgetDroppedChunks: 0,
    });
    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
  });

  it('full coverage 中に lease を失ったら complete/fail せず skip する', async () => {
    getContextPackageJobMock
      .mockResolvedValueOnce(JOB)
      .mockResolvedValueOnce({ ...JOB, status: 'running' });
    runStrategistOrchestratorMock.mockRejectedValue(
      new StrategistFullCoverageLeaseLostErrorMock(),
    );

    const outcome = await runContextPackageJob('job-1');

    expect(outcome).toEqual({ outcome: 'skipped', reason: 'active_lease' });
    expect(completeContextPackageJobMock).not.toHaveBeenCalled();
    expect(failContextPackageJobMock).not.toHaveBeenCalled();
    expect(releaseContextPackageJobLeaseMock).not.toHaveBeenCalled();
  });

  it('既知の orchestrator エラーを attemptToken 付き fail にマップする', async () => {
    getContextPackageJobMock.mockResolvedValue(JOB);
    runStrategistOrchestratorMock.mockRejectedValue(
      new UnresolvedDocIdsErrorMock({
        unknownDocIds: ['x'],
        nonTerminalDocIds: [],
      }),
    );

    const outcome = await runContextPackageJob('job-1');

    expect(outcome).toEqual({ outcome: 'claimed_and_run', status: 'failed' });
    expect(failContextPackageJobMock).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ code: 'unknown_doc_ids' }),
      { attemptToken: ATTEMPT_TOKEN },
    );
    expect(completeContextPackageJobMock).not.toHaveBeenCalled();
    expect(releaseContextPackageJobLeaseMock).not.toHaveBeenCalled();
  });

  it('業務失敗の fail が stale 拒否されたら active_lease skip を返す', async () => {
    getContextPackageJobMock.mockResolvedValue(JOB);
    runStrategistOrchestratorMock.mockRejectedValue(
      new UnresolvedDocIdsErrorMock({
        unknownDocIds: ['x'],
        nonTerminalDocIds: [],
      }),
    );
    failContextPackageJobMock.mockResolvedValue(false);

    const outcome = await runContextPackageJob('job-1');

    expect(outcome).toEqual({ outcome: 'skipped', reason: 'active_lease' });
  });

  it('業務失敗の fail が stale 拒否でも terminal 済みなら terminal skip を返す', async () => {
    getContextPackageJobMock
      .mockResolvedValueOnce(JOB)
      .mockResolvedValueOnce({ ...JOB, status: 'succeeded' });
    runStrategistOrchestratorMock.mockRejectedValue(
      new UnresolvedDocIdsErrorMock({
        unknownDocIds: ['x'],
        nonTerminalDocIds: [],
      }),
    );
    failContextPackageJobMock.mockResolvedValue(false);

    const outcome = await runContextPackageJob('job-1');

    expect(outcome).toEqual({ outcome: 'skipped', reason: 'terminal' });
  });

  it('業務失敗の Firestore 書き込み例外は lease を解放して rethrow する', async () => {
    getContextPackageJobMock.mockResolvedValue(JOB);
    runStrategistOrchestratorMock.mockRejectedValue(
      new UnresolvedDocIdsErrorMock({
        unknownDocIds: ['x'],
        nonTerminalDocIds: [],
      }),
    );
    failContextPackageJobMock.mockRejectedValue(new Error('firestore unavailable'));

    await expect(runContextPackageJob('job-1')).rejects.toThrow(
      'firestore unavailable',
    );
    expect(releaseContextPackageJobLeaseMock).toHaveBeenCalledWith(
      'job-1',
      ATTEMPT_TOKEN,
    );
  });

  it('予期せぬ例外は lease を解放して rethrow する', async () => {
    getContextPackageJobMock.mockResolvedValue(JOB);
    runStrategistOrchestratorMock.mockRejectedValue(new Error('vertex 503 transient'));

    await expect(runContextPackageJob('job-1')).rejects.toThrow('vertex 503 transient');

    expect(releaseContextPackageJobLeaseMock).toHaveBeenCalledWith(
      'job-1',
      ATTEMPT_TOKEN,
    );
    expect(failContextPackageJobMock).not.toHaveBeenCalled();
    expect(completeContextPackageJobMock).not.toHaveBeenCalled();
  });

  it('complete が stale 拒否されたら active_lease skip を返す', async () => {
    getContextPackageJobMock.mockResolvedValue(JOB);
    runStrategistOrchestratorMock.mockResolvedValue(stubResult());
    completeContextPackageJobMock.mockResolvedValue(false);

    const outcome = await runContextPackageJob('job-1');

    expect(outcome).toEqual({ outcome: 'skipped', reason: 'active_lease' });
  });

  it('GCS offload 後の complete stale 拒否では offloaded object を best-effort 削除する', async () => {
    getContextPackageJobMock.mockResolvedValue(JOB);
    runStrategistOrchestratorMock.mockResolvedValue({
      ...stubResult(),
      included: [
        {
          ...stubResult().included[0],
          chunk: { ...STUB_CHUNK, text: 'x'.repeat(950_000) },
        },
      ],
    });
    completeContextPackageJobWithResultRefMock.mockResolvedValue(false);

    const outcome = await runContextPackageJob('job-1');

    expect(outcome).toEqual({ outcome: 'skipped', reason: 'active_lease' });
    expect(deleteContextPackageJobResultMock).toHaveBeenCalledWith(
      expect.objectContaining({
        objectPath: 'context-package/job-results/tenant-1/job-1.json',
      }),
    );
  });

  it('payload が大きい場合は GCS offload して resultRef で complete する', async () => {
    getContextPackageJobMock.mockResolvedValue(JOB);
    runStrategistOrchestratorMock.mockResolvedValue({
      ...stubResult(),
      included: [
        {
          ...stubResult().included[0],
          chunk: { ...STUB_CHUNK, text: 'x'.repeat(950_000) },
        },
      ],
    });

    const outcome = await runContextPackageJob('job-1');

    expect(outcome).toEqual({ outcome: 'claimed_and_run', status: 'succeeded' });
    expect(writeContextPackageJobResultMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', jobId: 'job-1' }),
    );
    expect(completeContextPackageJobWithResultRefMock).toHaveBeenCalledWith(
      'job-1',
      ATTEMPT_TOKEN,
      expect.objectContaining({ storage: 'gcs' }),
      expect.objectContaining({ sourceDocumentsReviewed: 3 }),
    );
    expect(completeContextPackageJobMock).not.toHaveBeenCalled();
  });

  it('GCS offload 失敗は lease 解放して rethrow する（retry を維持）', async () => {
    getContextPackageJobMock.mockResolvedValue(JOB);
    runStrategistOrchestratorMock.mockResolvedValue({
      ...stubResult(),
      included: [
        {
          ...stubResult().included[0],
          chunk: { ...STUB_CHUNK, text: 'x'.repeat(950_000) },
        },
      ],
    });
    writeContextPackageJobResultMock.mockRejectedValue(
      new Error('gcs unavailable'),
    );

    await expect(runContextPackageJob('job-1')).rejects.toThrow('gcs unavailable');
    expect(releaseContextPackageJobLeaseMock).toHaveBeenCalledWith(
      'job-1',
      ATTEMPT_TOKEN,
    );
    expect(failContextPackageJobMock).not.toHaveBeenCalled();
  });
});

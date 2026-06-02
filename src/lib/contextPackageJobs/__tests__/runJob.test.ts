import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  claimContextPackageJobMock,
  getContextPackageJobMock,
  completeContextPackageJobMock,
  failContextPackageJobMock,
  runStrategistOrchestratorMock,
  recordAuditEventMock,
  NoInventoryDocumentsErrorMock,
  UnresolvedDocIdsErrorMock,
} = vi.hoisted(() => {
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
    failContextPackageJobMock: vi.fn(),
    runStrategistOrchestratorMock: vi.fn(),
    recordAuditEventMock: vi.fn(),
    NoInventoryDocumentsErrorMock,
    UnresolvedDocIdsErrorMock,
  };
});

vi.mock('../firestoreAdapter', () => ({
  claimContextPackageJob: claimContextPackageJobMock,
  getContextPackageJob: getContextPackageJobMock,
  completeContextPackageJob: completeContextPackageJobMock,
  failContextPackageJob: failContextPackageJobMock,
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
    StrategistSyncBudgetExceededError: class extends Error {},
    UnresolvedDocIdsError: UnresolvedDocIdsErrorMock,
  };
});

vi.mock('../../audit/auditEvent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../audit/auditEvent')>();
  return { ...actual, recordAuditEvent: recordAuditEventMock };
});

import { runContextPackageJob } from '../runJob';

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
  completeContextPackageJobMock.mockResolvedValue(undefined);
  failContextPackageJobMock.mockResolvedValue(undefined);
  recordAuditEventMock.mockResolvedValue('audit-id');
});

describe('runContextPackageJob', () => {
  it('claim に失敗（既に running 等）したら orchestrator を呼ばず skip する', async () => {
    claimContextPackageJobMock.mockResolvedValue(false);
    getContextPackageJobMock.mockResolvedValue(JOB);

    const outcome = await runContextPackageJob('job-1');

    expect(outcome).toEqual({ outcome: 'skipped', reason: 'not_queued' });
    expect(runStrategistOrchestratorMock).not.toHaveBeenCalled();
    expect(completeContextPackageJobMock).not.toHaveBeenCalled();
  });

  it('claim 成功で orchestrator を 20秒ゲート無しで実行し、結果と監査を記録する', async () => {
    claimContextPackageJobMock.mockResolvedValue(true);
    getContextPackageJobMock.mockResolvedValue(JOB);
    runStrategistOrchestratorMock.mockResolvedValue(stubResult());

    const outcome = await runContextPackageJob('job-1');

    expect(outcome).toEqual({ outcome: 'claimed_and_run', status: 'succeeded' });
    expect(runStrategistOrchestratorMock).toHaveBeenCalledWith(
      expect.objectContaining({ enforceSyncBudget: false, limit: 50 }),
    );
    const [jobId, payload, progress] = completeContextPackageJobMock.mock.calls[0];
    expect(jobId).toBe('job-1');
    expect(payload).toMatchObject({ purpose: 'テスト用途' });
    expect(progress).toEqual({
      sourceDocumentsReviewed: 3,
      safeChunks: 1,
      budgetDroppedChunks: 0,
    });
    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
  });

  it('既知の orchestrator エラーを job error code へマップして fail する', async () => {
    claimContextPackageJobMock.mockResolvedValue(true);
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
    );
    expect(completeContextPackageJobMock).not.toHaveBeenCalled();
  });

  it('予期せぬ例外は failed にせず rethrow する（lease 期限切れ後の retry に委ねる）', async () => {
    claimContextPackageJobMock.mockResolvedValue(true);
    getContextPackageJobMock.mockResolvedValue(JOB);
    runStrategistOrchestratorMock.mockRejectedValue(new Error('vertex 503 transient'));

    await expect(runContextPackageJob('job-1')).rejects.toThrow('vertex 503 transient');

    // lease を残したまま落とすため failed には更新しない（worker route が 500 を返す）。
    expect(failContextPackageJobMock).not.toHaveBeenCalled();
    expect(completeContextPackageJobMock).not.toHaveBeenCalled();
  });
});

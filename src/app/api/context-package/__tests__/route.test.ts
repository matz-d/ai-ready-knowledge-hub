import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  runStrategistOrchestratorMock,
  buildStrategistContextPackageMock,
  NoInventoryDocumentsErrorMock,
  NoKnowledgeChunksErrorMock,
  StrategistSyncBudgetExceededErrorMock,
  UnresolvedDocIdsErrorMock,
  JobQueueNotConfiguredErrorMock,
  recordAuditEventMock,
  createContextPackageJobMock,
  failContextPackageJobMock,
  enqueueMock,
} = vi.hoisted(() => {
  class NoInventoryDocumentsErrorMock extends Error {
    constructor(message = 'No terminal inventory documents found.') {
      super(message);
      this.name = 'NoInventoryDocumentsError';
    }
  }

  class NoKnowledgeChunksErrorMock extends Error {
    constructor(message = 'No knowledge chunks found.') {
      super(message);
      this.name = 'NoKnowledgeChunksError';
    }
  }

  class StrategistSyncBudgetExceededErrorMock extends Error {
    readonly estimatedSeconds: number;
    readonly targetSeconds: number;
    readonly budget: Record<string, unknown>;
    readonly suggestedDocIds: string[];

    constructor() {
      super('Estimated sync duration exceeds the target budget for /api/context-package.');
      this.name = 'StrategistSyncBudgetExceededError';
      this.estimatedSeconds = 24.8;
      this.targetSeconds = 20;
      this.budget = {
        config: {
          maxDocuments: 5,
          maxChunks: 80,
          maxTotalPromptChars: 80_000,
          maxCharsPerChunk: 1_200,
        },
        totalCandidates: 100,
        keptChunks: 80,
        droppedChunks: 20,
        keptDocuments: 5,
        estimatedPromptChars: 80_000,
        estimatedPromptTokens: 40_000,
      };
      this.suggestedDocIds = ['doc-1', 'doc-2'];
    }
  }

  class UnresolvedDocIdsErrorMock extends Error {
    readonly unknownDocIds: string[];
    readonly nonTerminalDocIds: { docId: string; status: string }[];

    constructor(params: {
      unknownDocIds: string[];
      nonTerminalDocIds: { docId: string; status: string }[];
    }) {
      super('One or more requested docIds could not be resolved to terminal inventory documents.');
      this.name = 'UnresolvedDocIdsError';
      this.unknownDocIds = params.unknownDocIds;
      this.nonTerminalDocIds = params.nonTerminalDocIds;
    }
  }

  class JobQueueNotConfiguredErrorMock extends Error {
    constructor(missing: string[]) {
      super(`Cloud Tasks queue is not configured: missing ${missing.join(', ')}`);
      this.name = 'JobQueueNotConfiguredError';
    }
  }

  return {
    runStrategistOrchestratorMock: vi.fn(),
    buildStrategistContextPackageMock: vi.fn(),
    NoInventoryDocumentsErrorMock,
    NoKnowledgeChunksErrorMock,
    StrategistSyncBudgetExceededErrorMock,
    UnresolvedDocIdsErrorMock,
    JobQueueNotConfiguredErrorMock,
    recordAuditEventMock: vi.fn().mockResolvedValue('audit-event-1'),
    createContextPackageJobMock: vi.fn(),
    failContextPackageJobMock: vi.fn(),
    enqueueMock: vi.fn(),
  };
});

vi.mock('../../../../services/strategistOrchestrator', async () => {
  // projection / payload / auditTarget は本物を使う（pure module。genkit / firestore に
  // 依存しない）。raw chunk.text を漏らさない projection を本物で検証するため。
  const responseView = await vi.importActual<
    typeof import('../../../../services/strategistOrchestrator/responseView')
  >('../../../../services/strategistOrchestrator/responseView');
  const payload = await vi.importActual<
    typeof import('../../../../services/strategistOrchestrator/contextPackagePayload')
  >('../../../../services/strategistOrchestrator/contextPackagePayload');
  const auditTarget = await vi.importActual<
    typeof import('../../../../services/strategistOrchestrator/auditTarget')
  >('../../../../services/strategistOrchestrator/auditTarget');
  return {
    runStrategistOrchestrator: runStrategistOrchestratorMock,
    buildStrategistContextPackage: buildStrategistContextPackageMock,
    buildContextPackageResponsePayload: payload.buildContextPackageResponsePayload,
    contextPackageAuditTarget: auditTarget.contextPackageAuditTarget,
    NoInventoryDocumentsError: NoInventoryDocumentsErrorMock,
    NoKnowledgeChunksError: NoKnowledgeChunksErrorMock,
    StrategistSyncBudgetExceededError: StrategistSyncBudgetExceededErrorMock,
    UnresolvedDocIdsError: UnresolvedDocIdsErrorMock,
    toIncludedChunkView: responseView.toIncludedChunkView,
    toExcludedChunkView: responseView.toExcludedChunkView,
    toSafetyExcludedChunkView: responseView.toSafetyExcludedChunkView,
  };
});

vi.mock('../../../../lib/audit/auditEvent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/audit/auditEvent')>();
  return {
    ...actual,
    recordAuditEvent: recordAuditEventMock,
  };
});

vi.mock('../../../../lib/contextPackageJobs/firestoreAdapter', () => ({
  createContextPackageJob: createContextPackageJobMock,
  failContextPackageJob: failContextPackageJobMock,
}));

vi.mock('../../../../lib/contextPackageJobs/enqueuer', () => ({
  cloudTasksEnqueuer: { enqueue: enqueueMock },
  JobQueueNotConfiguredError: JobQueueNotConfiguredErrorMock,
}));

import { POST } from '../route';
import { createPurposeBinding } from '../../../../lib/audit/auditEvent';

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/context-package', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

const STUB_PARENT = {
  id: 'doc-1',
  fileName: 'Runbook.md',
  documentType: 'メモ' as const,
  businessDomain: '社内手順' as const,
  freshness: 'current' as const,
  isAuthoritativeCandidate: true,
  updatedAt: '2026-05-14T00:00:00.000Z',
};

const STUB_CHUNK_BASE = {
  docId: 'doc-1',
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

const STUB_RESULT = {
  purpose: 'テスト用途',
  generatedAt: '2026-05-14T00:00:00.000Z',
  sourceDocumentsReviewed: 3,
  included: [
    {
      docId: 'doc-1',
      chunkId: 'chunk-1',
      rationale: '目的に合致',
      confidence: 0.9,
      chunk: { ...STUB_CHUNK_BASE, id: 'chunk-1' },
      parent: STUB_PARENT,
    },
  ],
  excluded: [
    {
      docId: 'doc-1',
      chunkId: 'chunk-2',
      rationale: '古い',
      reason: 'superseded_or_stale' as const,
      chunk: { ...STUB_CHUNK_BASE, id: 'chunk-2' },
      parent: STUB_PARENT,
    },
  ],
  safetyExcluded: [
    {
      docId: 'doc-1',
      chunkId: 'chunk-3',
      rationale: 'Restricted',
      reason: 'restricted_sensitivity' as const,
      chunk: {
        ...STUB_CHUNK_BASE,
        id: 'chunk-3',
        sensitivity: 'Restricted' as const,
        aiUsePolicy: 'blocked' as const,
      },
      parent: STUB_PARENT,
    },
  ],
  missing: ['最新の運用責任者'],
  humanReviewQuestions: ['旧ルールは廃止済みですか？'],
  budget: {
    config: {
      maxDocuments: 5,
      maxChunks: 80,
      maxTotalPromptChars: 80_000,
      maxCharsPerChunk: 1_200,
    },
    totalCandidates: 12,
    keptChunks: 10,
    droppedChunks: 2,
    keptDocuments: 3,
    estimatedPromptChars: 14_200,
    estimatedPromptTokens: 7_100,
  },
  budgetDroppedDocuments: [],
  syncEstimateSeconds: 7.4,
};

// route が境界で投影した後の安全な形（raw chunk.text を含まない）。
const EXPECTED_INCLUDED = [
  {
    docId: 'doc-1',
    chunkId: 'chunk-1',
    rationale: '目的に合致',
    confidence: 0.9,
    aiSafeViaMasking: false,
    chunk: { sensitivity: 'Internal' },
    parent: { fileName: 'Runbook.md', documentType: 'メモ', businessDomain: '社内手順' },
    aiSafeContent: 'stub',
  },
];
const EXPECTED_EXCLUDED = [
  {
    docId: 'doc-1',
    chunkId: 'chunk-2',
    rationale: '古い',
    reason: 'superseded_or_stale',
    chunk: { sensitivity: 'Internal' },
    parent: { fileName: 'Runbook.md', documentType: 'メモ', businessDomain: '社内手順' },
  },
];
const EXPECTED_SAFETY_EXCLUDED = [
  {
    docId: 'doc-1',
    chunkId: 'chunk-3',
    rationale: 'Restricted',
    reason: 'restricted_sensitivity',
    chunk: { sensitivity: 'Restricted' },
    parent: { fileName: 'Runbook.md', documentType: 'メモ', businessDomain: '社内手順' },
  },
];

const STUB_MARKDOWN = '# Context Package\n\n## 目的\nテスト用途\n';

beforeEach(() => {
  vi.clearAllMocks();
  runStrategistOrchestratorMock.mockResolvedValue(STUB_RESULT);
  buildStrategistContextPackageMock.mockReturnValue({ input: {}, markdown: STUB_MARKDOWN });
  createContextPackageJobMock.mockResolvedValue({ jobId: 'job-123', status: 'queued' });
  failContextPackageJobMock.mockResolvedValue(undefined);
  enqueueMock.mockResolvedValue(undefined);
});

describe('POST /api/context-package', () => {
  it('returns full response shape on success', async () => {
    const response = await POST(buildRequest({ purpose: 'テスト用途', limit: 50 }));
    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(runStrategistOrchestratorMock).toHaveBeenCalledWith({
      purpose: 'テスト用途',
      limit: 50,
    });
    expect(body).toEqual({
      purpose: 'テスト用途',
      generatedAt: '2026-05-14T00:00:00.000Z',
      sourceDocumentsReviewed: 3,
      included: EXPECTED_INCLUDED,
      excluded: EXPECTED_EXCLUDED,
      safetyExcluded: EXPECTED_SAFETY_EXCLUDED,
      missing: ['最新の運用責任者'],
      humanReviewQuestions: ['旧ルールは廃止済みですか？'],
      budget: {
        ...STUB_RESULT.budget,
        budgetDroppedCount: 2,
      },
      budgetDroppedDocuments: [],
      syncEstimateSeconds: 7.4,
      // markdown は本物の payload builder が生成する（内容ではなく projection 経路を検証）。
      markdown: expect.any(String),
      counts: {
        included: 1,
        excluded: 1,
        safetyExcluded: 1,
        missing: 1,
        humanReviewQuestions: 1,
      },
    });
    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'document.export',
        result: 'success',
        processingProfile: {
          profileName: 'cloud-managed',
          ingressBoundary: 'tenant-cloud',
          sanitizationStage: 'post-ingress',
          inferenceScope: 'shared-cloud',
        },
        purposeBinding: createPurposeBinding({
          purpose: 'テスト用途',
          tenantId: 'local-dev',
          timestamp: '2026-05-14T00:00:00.000Z',
        }),
        inferenceDestination: {
          vendor: 'vertex',
          region: process.env.GOOGLE_CLOUD_LOCATION ?? 'global',
          model: process.env.GEMINI_MODEL ?? 'gemini-3.5-flash',
        },
        dataResidency: {
          storage:
            process.env.KNOWLEDGE_HUB_DATA_RESIDENCY_LOCATION ?? 'asia-northeast1',
          processing:
            process.env.KNOWLEDGE_HUB_DATA_RESIDENCY_LOCATION ?? 'asia-northeast1',
        },
        target: {
          docId: 'doc-1',
          fileName: 'Runbook.md',
          sourceKind: 'upload',
          sensitivity: 'Internal',
        },
      })
    );
  });

  it('never serializes raw chunk text; included carries masked AI-safe body only', async () => {
    runStrategistOrchestratorMock.mockResolvedValue({
      ...STUB_RESULT,
      included: [
        {
          docId: 'doc-1',
          chunkId: 'masked-1',
          rationale: 'masked body is AI-safe',
          confidence: 0.8,
          chunk: {
            ...STUB_CHUNK_BASE,
            id: 'masked-1',
            aiUsePolicy: 'requires_masking',
            sensitivity: 'Confidential',
            text: 'RAW_SECRET_CUSTOMER_NAME',
            maskedText: 'MASKED_OK',
          },
          parent: STUB_PARENT,
        },
      ],
      excluded: [
        {
          docId: 'doc-1',
          chunkId: 'ex-1',
          rationale: 'stale',
          reason: 'superseded_or_stale',
          chunk: { ...STUB_CHUNK_BASE, id: 'ex-1', text: 'EXCLUDED_RAW_BODY' },
          parent: STUB_PARENT,
        },
      ],
      safetyExcluded: [
        {
          docId: 'doc-1',
          chunkId: 'safe-1',
          rationale: 'restricted',
          reason: 'restricted_sensitivity',
          chunk: {
            ...STUB_CHUNK_BASE,
            id: 'safe-1',
            sensitivity: 'Restricted',
            aiUsePolicy: 'blocked',
            text: 'RESTRICTED_RAW_BODY',
          },
          parent: STUB_PARENT,
        },
      ],
    });

    const response = await POST(buildRequest({ purpose: 'テスト用途' }));
    const rawJson = await response.text();

    expect(response.status).toBe(200);
    // raw 本文は included / excluded / safetyExcluded のどこにも出てはいけない。
    expect(rawJson).not.toContain('RAW_SECRET_CUSTOMER_NAME');
    expect(rawJson).not.toContain('EXCLUDED_RAW_BODY');
    expect(rawJson).not.toContain('RESTRICTED_RAW_BODY');
    // included は masked 本文のみを AI-safe content として持つ。
    expect(rawJson).toContain('MASKED_OK');

    const body = JSON.parse(rawJson) as {
      included: { aiSafeContent: string; aiSafeViaMasking: boolean; chunk: Record<string, unknown> }[];
      excluded: { chunk: Record<string, unknown> }[];
      safetyExcluded: { chunk: Record<string, unknown> }[];
    };
    expect(body.included[0]?.aiSafeContent).toBe('MASKED_OK');
    expect(body.included[0]?.aiSafeViaMasking).toBe(true);
    // 投影後の chunk metadata に raw text フィールドが残っていないこと。
    expect(body.included[0]?.chunk).not.toHaveProperty('text');
    expect(body.excluded[0]?.chunk).not.toHaveProperty('text');
    expect(body.safetyExcluded[0]?.chunk).not.toHaveProperty('text');
  });

  it('exposes budgetDroppedDocuments so truncation is visible to clients', async () => {
    runStrategistOrchestratorMock.mockResolvedValue({
      ...STUB_RESULT,
      budgetDroppedDocuments: [
        { docId: 'doc-2', fileName: 'handbook.pdf', droppedChunks: 3 },
      ],
    });

    const response = await POST(buildRequest({ purpose: 'テスト用途' }));
    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(body.budgetDroppedDocuments).toEqual([
      { docId: 'doc-2', fileName: 'handbook.pdf', droppedChunks: 3 },
    ]);
  });

  it('uses default limit of 100 when limit is omitted', async () => {
    const response = await POST(buildRequest({ purpose: 'テスト用途' }));

    expect(response.status).toBe(200);
    expect(runStrategistOrchestratorMock).toHaveBeenCalledWith({
      purpose: 'テスト用途',
      limit: 100,
    });
  });

  it('passes docIds filter when provided', async () => {
    const response = await POST(
      buildRequest({ purpose: 'テスト用途', limit: 10, docIds: ['doc-1', 'doc-2'] }),
    );

    expect(response.status).toBe(200);
    expect(runStrategistOrchestratorMock).toHaveBeenCalledWith({
      purpose: 'テスト用途',
      limit: 10,
      docIds: ['doc-1', 'doc-2'],
    });
  });

  it('returns 400 unknown_doc_ids when a requested docId does not exist', async () => {
    runStrategistOrchestratorMock.mockRejectedValue(
      new UnresolvedDocIdsErrorMock({
        unknownDocIds: ['doc-missing'],
        nonTerminalDocIds: [],
      }),
    );

    const response = await POST(
      buildRequest({ purpose: 'テスト用途', docIds: ['doc-missing'] }),
    );
    const body = await parseJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe('unknown_doc_ids');
    expect(body.details).toMatchObject({ unknownDocIds: ['doc-missing'] });
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('returns 400 non_terminal_doc_ids with status when a requested docId is not terminal', async () => {
    runStrategistOrchestratorMock.mockRejectedValue(
      new UnresolvedDocIdsErrorMock({
        unknownDocIds: [],
        nonTerminalDocIds: [{ docId: 'doc-draft', status: 'uploaded' }],
      }),
    );

    const response = await POST(
      buildRequest({ purpose: 'テスト用途', docIds: ['doc-draft'] }),
    );
    const body = await parseJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe('non_terminal_doc_ids');
    expect(body.details).toMatchObject({
      nonTerminalDocIds: [{ docId: 'doc-draft', status: 'uploaded' }],
    });
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('returns 400 for missing purpose', async () => {
    const response = await POST(buildRequest({ limit: 10 }));
    const body = await parseJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_request');
    expect(body).toHaveProperty('details');
    expect(runStrategistOrchestratorMock).not.toHaveBeenCalled();
  });

  it('returns 400 for empty purpose string', async () => {
    const response = await POST(buildRequest({ purpose: '' }));
    const body = await parseJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_request');
  });

  it('returns 400 for purpose exceeding 2000 chars', async () => {
    const response = await POST(buildRequest({ purpose: 'a'.repeat(2001) }));
    const body = await parseJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_request');
  });

  it('returns 400 for limit out of range', async () => {
    const response = await POST(buildRequest({ purpose: 'テスト', limit: 0 }));
    const body = await parseJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_request');
  });

  it('returns 400 for non-JSON body', async () => {
    const response = await POST(
      new Request('http://localhost/api/context-package', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not json',
      }),
    );
    const body = await parseJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_request');
  });

  it('returns 409 for NoInventoryDocumentsError', async () => {
    runStrategistOrchestratorMock.mockRejectedValue(new NoInventoryDocumentsErrorMock());

    const response = await POST(buildRequest({ purpose: 'テスト用途' }));
    const body = await parseJson(response);

    expect(response.status).toBe(409);
    expect(body.error).toBe('no_inventory_documents');
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('returns 409 for NoKnowledgeChunksError', async () => {
    runStrategistOrchestratorMock.mockRejectedValue(new NoKnowledgeChunksErrorMock());

    const response = await POST(buildRequest({ purpose: 'テスト用途' }));
    const body = await parseJson(response);

    expect(response.status).toBe(409);
    expect(body.error).toBe('no_knowledge_chunks');
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('returns 502 for unexpected orchestrator error', async () => {
    runStrategistOrchestratorMock.mockRejectedValue(new Error('Firestore connection failed'));

    const response = await POST(buildRequest({ purpose: 'テスト用途' }));
    const body = await parseJson(response);

    expect(response.status).toBe(502);
    expect(body.error).toBe('upstream_failure');
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('returns 422 with narrowing guidance when sync budget is exceeded', async () => {
    runStrategistOrchestratorMock.mockRejectedValue(
      new StrategistSyncBudgetExceededErrorMock(),
    );

    const response = await POST(buildRequest({ purpose: 'テスト用途', limit: 100 }));
    const body = await parseJson(response);

    expect(response.status).toBe(422);
    expect(body.error).toBe('sync_budget_exceeded');
    expect(body.details).toBe(
      '同期処理の目標時間（20秒）を超える見込みです。対象を絞るか mode:"async" で再実行してください。',
    );
    expect(body.targetSeconds).toBe(20);
    expect(body.estimatedSeconds).toBe(24.8);
    expect(body).toMatchObject({
      recommendation: {
        suggestedDocIds: ['doc-1', 'doc-2'],
      },
    });
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/context-package (async modes)', () => {
  it('mode:"async" は同期実行せず job 化し 202 + jobId / status・result URL を返す', async () => {
    const response = await POST(
      buildRequest({ purpose: 'テスト用途', limit: 50, mode: 'async' }),
    );
    const body = await parseJson(response);

    expect(response.status).toBe(202);
    expect(runStrategistOrchestratorMock).not.toHaveBeenCalled();
    expect(createContextPackageJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'テスト用途', limit: 50 }),
    );
    expect(enqueueMock).toHaveBeenCalledWith('job-123');
    expect(body).toMatchObject({
      jobId: 'job-123',
      status: 'queued',
      statusUrl: '/api/context-package/jobs/job-123',
      resultUrl: '/api/context-package/jobs/job-123/result',
    });
  });

  it('mode:"auto" は budget 超過時に 422 ではなく job 化へフォールバックする', async () => {
    runStrategistOrchestratorMock.mockRejectedValue(
      new StrategistSyncBudgetExceededErrorMock(),
    );

    const response = await POST(
      buildRequest({ purpose: 'テスト用途', limit: 100, mode: 'auto' }),
    );
    const body = await parseJson(response);

    expect(response.status).toBe(202);
    expect(enqueueMock).toHaveBeenCalledWith('job-123');
    expect(body).toMatchObject({
      jobId: 'job-123',
      reason: 'sync_budget_exceeded',
      targetSeconds: 20,
      syncEstimateSeconds: 24.8,
    });
  });

  it('mode:"sync"（既定）は budget 超過で従来どおり 422、job 化しない', async () => {
    runStrategistOrchestratorMock.mockRejectedValue(
      new StrategistSyncBudgetExceededErrorMock(),
    );

    const response = await POST(buildRequest({ purpose: 'テスト用途', limit: 100 }));

    expect(response.status).toBe(422);
    expect(createContextPackageJobMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('queue 未設定（JobQueueNotConfiguredError）なら 503 を返す', async () => {
    enqueueMock.mockRejectedValue(
      new JobQueueNotConfiguredErrorMock(['CONTEXT_PACKAGE_TASKS_QUEUE']),
    );

    const response = await POST(
      buildRequest({ purpose: 'テスト用途', mode: 'async' }),
    );
    const body = await parseJson(response);

    expect(response.status).toBe(503);
    expect(body.error).toBe('job_queue_unavailable');
    expect(body.jobId).toBe('job-123');
    // enqueue 失敗で queued を放置せず failed に更新する。
    expect(failContextPackageJobMock).toHaveBeenCalledWith(
      'job-123',
      expect.objectContaining({ code: 'enqueue_failed' }),
    );
  });
});

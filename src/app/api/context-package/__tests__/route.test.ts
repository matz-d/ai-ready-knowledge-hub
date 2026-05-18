import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  runStrategistOrchestratorMock,
  buildStrategistContextPackageMock,
  NoInventoryDocumentsErrorMock,
  NoKnowledgeChunksErrorMock,
  recordAuditEventMock,
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

  return {
    runStrategistOrchestratorMock: vi.fn(),
    buildStrategistContextPackageMock: vi.fn(),
    NoInventoryDocumentsErrorMock,
    NoKnowledgeChunksErrorMock,
    recordAuditEventMock: vi.fn().mockResolvedValue('audit-event-1'),
  };
});

vi.mock('../../../../services/strategistOrchestrator', () => ({
  runStrategistOrchestrator: runStrategistOrchestratorMock,
  buildStrategistContextPackage: buildStrategistContextPackageMock,
  NoInventoryDocumentsError: NoInventoryDocumentsErrorMock,
  NoKnowledgeChunksError: NoKnowledgeChunksErrorMock,
}));

vi.mock('../../../../lib/audit/auditEvent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/audit/auditEvent')>();
  return {
    ...actual,
    recordAuditEvent: recordAuditEventMock,
  };
});

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
};

const STUB_MARKDOWN = '# Context Package\n\n## 目的\nテスト用途\n';

beforeEach(() => {
  vi.clearAllMocks();
  runStrategistOrchestratorMock.mockResolvedValue(STUB_RESULT);
  buildStrategistContextPackageMock.mockReturnValue({ input: {}, markdown: STUB_MARKDOWN });
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
    expect(buildStrategistContextPackageMock).toHaveBeenCalledWith(STUB_RESULT);
    expect(body).toEqual({
      purpose: 'テスト用途',
      generatedAt: '2026-05-14T00:00:00.000Z',
      sourceDocumentsReviewed: 3,
      included: STUB_RESULT.included,
      excluded: STUB_RESULT.excluded,
      safetyExcluded: STUB_RESULT.safetyExcluded,
      missing: ['最新の運用責任者'],
      humanReviewQuestions: ['旧ルールは廃止済みですか？'],
      markdown: STUB_MARKDOWN,
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
          region: process.env.GOOGLE_CLOUD_LOCATION ?? 'asia-northeast1',
          model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
        },
        dataResidency: {
          storage: process.env.GOOGLE_CLOUD_LOCATION ?? 'asia-northeast1',
          processing: process.env.GOOGLE_CLOUD_LOCATION ?? 'asia-northeast1',
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

  it('uses default limit of 100 when limit is omitted', async () => {
    const response = await POST(buildRequest({ purpose: 'テスト用途' }));

    expect(response.status).toBe(200);
    expect(runStrategistOrchestratorMock).toHaveBeenCalledWith({
      purpose: 'テスト用途',
      limit: 100,
    });
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
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  runStrategistOrchestratorMock,
  buildStrategistContextPackageMock,
  NoInventoryDocumentsErrorMock,
  NoKnowledgeChunksErrorMock,
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
  };
});

vi.mock('../../../../services/strategistOrchestrator', () => ({
  runStrategistOrchestrator: runStrategistOrchestratorMock,
  buildStrategistContextPackage: buildStrategistContextPackageMock,
  NoInventoryDocumentsError: NoInventoryDocumentsErrorMock,
  NoKnowledgeChunksError: NoKnowledgeChunksErrorMock,
}));

import { POST } from '../route';

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

const STUB_RESULT = {
  purpose: 'テスト用途',
  generatedAt: '2026-05-14T00:00:00.000Z',
  sourceDocumentsReviewed: 3,
  included: [{ docId: 'doc-1', chunkId: 'chunk-1', rationale: '目的に合致', confidence: 0.9 }],
  excluded: [{ docId: 'doc-1', chunkId: 'chunk-2', rationale: '古い', reason: 'superseded_or_stale' }],
  safetyExcluded: [{ docId: 'doc-1', chunkId: 'chunk-3', rationale: 'Restricted', reason: 'restricted_sensitivity' }],
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
  });

  it('returns 409 for NoKnowledgeChunksError', async () => {
    runStrategistOrchestratorMock.mockRejectedValue(new NoKnowledgeChunksErrorMock());

    const response = await POST(buildRequest({ purpose: 'テスト用途' }));
    const body = await parseJson(response);

    expect(response.status).toBe(409);
    expect(body.error).toBe('no_knowledge_chunks');
  });

  it('returns 502 for unexpected orchestrator error', async () => {
    runStrategistOrchestratorMock.mockRejectedValue(new Error('Firestore connection failed'));

    const response = await POST(buildRequest({ purpose: 'テスト用途' }));
    const body = await parseJson(response);

    expect(response.status).toBe(502);
    expect(body.error).toBe('upstream_failure');
  });
});

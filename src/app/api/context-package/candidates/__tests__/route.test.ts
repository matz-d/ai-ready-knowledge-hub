import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryDocument } from '../../../../../lib/inventory';
import { handleCandidatesPost } from '../handler';

const listInventoryDocumentsMock = vi.fn();
const selectCandidatesMock = vi.fn();

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/context-package/candidates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function sampleDoc(overrides: Partial<InventoryDocument> = {}): InventoryDocument {
  return {
    id: 'doc-payroll-1',
    fileName: '給与計算チェックリスト.csv',
    documentType: '表',
    businessDomain: '給与計算',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    aiUsePolicy: 'direct',
    status: 'curated',
    rationale: '',
    sensitivitySource: 'curator',
    updatedAt: '2026-05-20T10:00:00.000Z',
    ...overrides,
  };
}

const stubCandidate = {
  docId: 'doc-payroll-1',
  fileName: '給与計算チェックリスト.csv',
  documentType: '表' as const,
  businessDomain: '給与計算' as const,
  sensitivity: 'Internal' as const,
  freshness: 'current' as const,
  isAuthoritativeCandidate: true,
  status: 'curated' as const,
  updatedAt: '2026-05-20T10:00:00.000Z',
  score: 0.82,
  recommendation: 'include' as const,
  matchReason: '給与計算に関連する現行版の正本候補',
};

describe('POST /api/context-package/candidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listInventoryDocumentsMock.mockResolvedValue([sampleDoc()]);
    selectCandidatesMock.mockReturnValue({
      candidates: [stubCandidate],
      missingHints: [],
      totalClassified: 1,
    });
  });

  const deps = () => ({
    listInventoryDocuments: listInventoryDocumentsMock,
    selectCandidates: selectCandidatesMock,
  });

  it('returns 200 with candidates, missingHints, and inventoryScanned', async () => {
    const response = await handleCandidatesPost(
      buildRequest({ purpose: '新人向けに給与計算業務を学べるAIを作りたい' }),
      deps(),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({
      candidates: [stubCandidate],
      missingHints: [],
      inventoryScanned: 1,
    });
    expect(listInventoryDocumentsMock).toHaveBeenCalledWith(300);
    expect(selectCandidatesMock).toHaveBeenCalledWith(
      '新人向けに給与計算業務を学べるAIを作りたい',
      [sampleDoc()],
      { responseLimit: 50 },
    );
  });

  it('passes custom inventoryLimit and responseLimit', async () => {
    await handleCandidatesPost(
      buildRequest({
        purpose: 'payroll onboarding',
        inventoryLimit: 120,
        responseLimit: 25,
      }),
      deps(),
    );

    expect(listInventoryDocumentsMock).toHaveBeenCalledWith(120);
    expect(selectCandidatesMock).toHaveBeenCalledWith(
      'payroll onboarding',
      [sampleDoc()],
      { responseLimit: 25 },
    );
  });

  it('returns 400 invalid_request for malformed JSON', async () => {
    const response = await handleCandidatesPost(
      new Request('http://localhost/api/context-package/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
      deps(),
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.code).toBe('invalid_request');
    expect(selectCandidatesMock).not.toHaveBeenCalled();
  });

  it('returns 400 invalid_request when purpose is empty', async () => {
    const response = await handleCandidatesPost(buildRequest({ purpose: '' }), deps());

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.code).toBe('invalid_request');
    expect(listInventoryDocumentsMock).not.toHaveBeenCalled();
  });

  it('returns 400 invalid_request when limits are out of range', async () => {
    const response = await handleCandidatesPost(
      buildRequest({ purpose: 'test', inventoryLimit: 501 }),
      deps(),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_request');
    expect(listInventoryDocumentsMock).not.toHaveBeenCalled();
  });

  it('returns 409 no_inventory_documents when inventory is empty', async () => {
    listInventoryDocumentsMock.mockResolvedValue([]);

    const response = await handleCandidatesPost(buildRequest({ purpose: 'test purpose' }), deps());

    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json).toEqual({ code: 'no_inventory_documents' });
    expect(selectCandidatesMock).not.toHaveBeenCalled();
  });

  it('returns 200 with empty candidates when selection yields none', async () => {
    selectCandidatesMock.mockReturnValue({
      candidates: [],
      missingHints: ['給与計算領域に現行版の正本候補文書がありません'],
      totalClassified: 1,
    });

    const response = await handleCandidatesPost(buildRequest({ purpose: 'test' }), deps());

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.candidates).toEqual([]);
    expect(json.missingHints).toHaveLength(1);
    expect(json.inventoryScanned).toBe(1);
  });

  it('does not expose body fields on candidate objects', async () => {
    const response = await handleCandidatesPost(buildRequest({ purpose: 'test' }), deps());
    const json = await response.json();

    for (const candidate of json.candidates) {
      expect(candidate).not.toHaveProperty('aiSafeContent');
      expect(candidate).not.toHaveProperty('maskedText');
      expect(candidate).not.toHaveProperty('rationale');
    }
  });

  it('returns 502 when inventory listing fails', async () => {
    listInventoryDocumentsMock.mockRejectedValue(new Error('Firestore unavailable'));

    const response = await handleCandidatesPost(buildRequest({ purpose: 'test' }), deps());

    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe('upstream_failure');
  });
});

describe('POST /api/context-package/candidates (integration with selectCandidates)', () => {
  it('classifies real inventory rows without mocked selectCandidates', async () => {
    listInventoryDocumentsMock.mockResolvedValue([
      sampleDoc(),
      sampleDoc({
        id: 'doc-restricted',
        fileName: '顧問契約書.pdf',
        sensitivity: 'Restricted',
        aiUsePolicy: 'blocked',
        status: 'restricted',
        businessDomain: '顧問契約管理',
      }),
    ]);

    const response = await handleCandidatesPost(buildRequest({ purpose: '給与計算 研修' }), {
      listInventoryDocuments: listInventoryDocumentsMock,
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.inventoryScanned).toBe(2);
    expect(json.candidates.length).toBeGreaterThan(0);

    const restricted = json.candidates.find(
      (c: { docId: string }) => c.docId === 'doc-restricted',
    );
    expect(restricted?.recommendation).toBe('exclude');
    expect(restricted?.reasonCode).toBe('restricted_sensitivity');
    expect(restricted).not.toHaveProperty('aiSafeContent');
  });
});

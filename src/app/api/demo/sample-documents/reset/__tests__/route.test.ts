import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  acquireDemoResetLockMock,
  ingestAllDemoSamplesMock,
  isDemoModeMock,
  purgeDemoSampleDocumentsMock,
  releaseDemoResetLockMock,
} = vi.hoisted(() => ({
  acquireDemoResetLockMock: vi.fn(),
  ingestAllDemoSamplesMock: vi.fn(),
  isDemoModeMock: vi.fn(),
  purgeDemoSampleDocumentsMock: vi.fn(),
  releaseDemoResetLockMock: vi.fn(),
}));

vi.mock('../../../../../../lib/demoMode', () => ({
  isDemoMode: isDemoModeMock,
}));

vi.mock('../../../../../../lib/demoSampleDocuments', () => ({
  ingestAllDemoSamples: ingestAllDemoSamplesMock,
}));

vi.mock('../../../../../../lib/demoSamplePurge', () => ({
  purgeDemoSampleDocuments: purgeDemoSampleDocumentsMock,
}));

vi.mock('../../../../../../lib/demoSampleResetLock', () => ({
  acquireDemoResetLock: acquireDemoResetLockMock,
  releaseDemoResetLock: releaseDemoResetLockMock,
}));

vi.mock('../../../../../../lib/storage', () => ({
  getKnowledgeHubBucketName: vi.fn(() => 'demo-bucket'),
}));

import { POST as resetDemoSamples } from '../route';

function resetRequest(headers?: Record<string, string>): Request {
  return new Request('http://localhost/api/demo/sample-documents/reset', {
    method: 'POST',
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DEMO_RESET_TOKEN;
  isDemoModeMock.mockReturnValue(true);
  acquireDemoResetLockMock.mockResolvedValue({ ok: true, lockId: 'lock-1' });
  purgeDemoSampleDocumentsMock.mockResolvedValue({
    docIds: ['doc-1'],
    gcsObjectsDeleted: 2,
    deletedPrefixes: ['raw/doc-1/', 'masked/doc-1/'],
    failures: [],
  });
  ingestAllDemoSamplesMock.mockResolvedValue({
    sampleSet: 'accounting-office',
    modelId: 'gemini-test',
    imported: 11,
    alreadyPresent: 0,
    failed: 0,
    documents: [],
  });
  releaseDemoResetLockMock.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.DEMO_RESET_TOKEN;
});

describe('POST /api/demo/sample-documents/reset', () => {
  it('returns 403 when demo mode is disabled', async () => {
    isDemoModeMock.mockReturnValue(false);

    const response = await resetDemoSamples(resetRequest());

    expect(response.status).toBe(403);
  });

  it('returns 401 when token is missing or invalid', async () => {
    process.env.DEMO_RESET_TOKEN = 'secret';

    const missing = await resetDemoSamples(resetRequest());
    expect(missing.status).toBe(401);

    const invalid = await resetDemoSamples(
      resetRequest({ 'X-Demo-Reset-Token': 'wrong' })
    );
    expect(invalid.status).toBe(401);
  });

  it('returns 409 when reset lock is already held', async () => {
    process.env.DEMO_RESET_TOKEN = 'secret';
    acquireDemoResetLockMock.mockResolvedValue({
      ok: false,
      reason: 'reset_in_progress',
    });

    const response = await resetDemoSamples(
      resetRequest({ 'X-Demo-Reset-Token': 'secret' })
    );

    expect(response.status).toBe(409);
    expect(purgeDemoSampleDocumentsMock).not.toHaveBeenCalled();
  });

  it('purges, re-ingests, and releases the lock on success', async () => {
    process.env.DEMO_RESET_TOKEN = 'secret';
    const request = resetRequest({ 'X-Demo-Reset-Token': 'secret' });

    const response = await resetDemoSamples(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(purgeDemoSampleDocumentsMock).toHaveBeenCalledTimes(1);
    expect(ingestAllDemoSamplesMock).toHaveBeenCalledWith(request);
    expect(releaseDemoResetLockMock).toHaveBeenCalledWith('lock-1');
    expect(body.purged.docIds).toEqual(['doc-1']);
    expect(body.imported).toBe(11);
  });

  it('returns 500 when purge or re-ingest is incomplete', async () => {
    process.env.DEMO_RESET_TOKEN = 'secret';
    purgeDemoSampleDocumentsMock.mockResolvedValue({
      docIds: ['doc-1'],
      gcsObjectsDeleted: 0,
      deletedPrefixes: [],
      failures: [{ docId: 'doc-1', stage: 'firestore', message: 'delete failed' }],
    });

    const response = await resetDemoSamples(
      resetRequest({ 'X-Demo-Reset-Token': 'secret' })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('reset_incomplete');
    expect(body.purged.failures).toHaveLength(1);
    expect(releaseDemoResetLockMock).toHaveBeenCalledWith('lock-1');
  });
});

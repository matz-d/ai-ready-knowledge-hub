import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getContextPackageJobMock, runContextPackageJobMock } = vi.hoisted(() => ({
  getContextPackageJobMock: vi.fn(),
  runContextPackageJobMock: vi.fn(),
}));

vi.mock('../../../../../lib/contextPackageJobs/firestoreAdapter', () => ({
  getContextPackageJob: getContextPackageJobMock,
}));

vi.mock('../../../../../lib/contextPackageJobs/runJob', () => ({
  runContextPackageJob: runContextPackageJobMock,
}));

// auditActorFromRequest は本物を使う（local fallback で tenantId = 'local-dev'）。

import { GET as getStatus } from '../[jobId]/route';
import { GET as getResult } from '../[jobId]/result/route';
import { POST as runWorker } from '../[jobId]/run/route';

function statusRequest(): Request {
  return new Request('http://localhost/api/context-package/jobs/job-1');
}
function workerRequest(headers?: Record<string, string>): Request {
  return new Request('http://localhost/api/context-package/jobs/job-1/run', {
    method: 'POST',
    headers,
  });
}
function params(jobId: string) {
  return { params: Promise.resolve({ jobId }) };
}

const OWN_TENANT_JOB = {
  jobId: 'job-1',
  status: 'succeeded' as const,
  request: {
    purpose: 'p',
    limit: 10,
    tenantId: 'local-dev',
    actor: { userId: 'u', ipAddress: '', userAgent: '' },
  },
  result: { markdown: '# ok' },
  createdAt: 'x',
  updatedAt: 'x',
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CONTEXT_PACKAGE_JOB_TOKEN;
});

describe('GET /jobs/:jobId (status)', () => {
  it('自 tenant の job は status を返す', async () => {
    getContextPackageJobMock.mockResolvedValue(OWN_TENANT_JOB);
    const res = await getStatus(statusRequest(), params('job-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('succeeded');
    expect(body.resultUrl).toBe('/api/context-package/jobs/job-1/result');
  });

  it('別 tenant の job は存在を隠して 404', async () => {
    getContextPackageJobMock.mockResolvedValue({
      ...OWN_TENANT_JOB,
      request: { ...OWN_TENANT_JOB.request, tenantId: 'other-tenant' },
    });
    const res = await getStatus(statusRequest(), params('job-1'));
    expect(res.status).toBe(404);
  });

  it('存在しない job は 404', async () => {
    getContextPackageJobMock.mockResolvedValue(null);
    const res = await getStatus(statusRequest(), params('job-1'));
    expect(res.status).toBe(404);
  });
});

describe('GET /jobs/:jobId/result', () => {
  it('自 tenant の succeeded job は result payload を返す', async () => {
    getContextPackageJobMock.mockResolvedValue(OWN_TENANT_JOB);
    const res = await getResult(statusRequest(), params('job-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ markdown: '# ok' });
  });

  it('別 tenant の result は 404', async () => {
    getContextPackageJobMock.mockResolvedValue({
      ...OWN_TENANT_JOB,
      request: { ...OWN_TENANT_JOB.request, tenantId: 'other-tenant' },
    });
    const res = await getResult(statusRequest(), params('job-1'));
    expect(res.status).toBe(404);
  });

  it('未完了 job は 409', async () => {
    getContextPackageJobMock.mockResolvedValue({
      ...OWN_TENANT_JOB,
      status: 'running',
      result: undefined,
    });
    const res = await getResult(statusRequest(), params('job-1'));
    expect(res.status).toBe(409);
  });
});

describe('POST /jobs/:jobId/run (worker)', () => {
  it('runContextPackageJob の outcome を 200 で返す（業務的失敗もリトライ不要）', async () => {
    runContextPackageJobMock.mockResolvedValue({
      outcome: 'claimed_and_run',
      status: 'failed',
    });
    const res = await runWorker(workerRequest(), params('job-1'));
    expect(res.status).toBe(200);
    expect(runContextPackageJobMock).toHaveBeenCalledWith('job-1');
  });

  it('予期せぬ例外は 500（Cloud Tasks に retry させる）', async () => {
    runContextPackageJobMock.mockRejectedValue(new Error('boom'));
    const res = await runWorker(workerRequest(), params('job-1'));
    expect(res.status).toBe(500);
  });

  it('共有トークン設定時、不一致は 401 で runJob を呼ばない', async () => {
    process.env.CONTEXT_PACKAGE_JOB_TOKEN = 'secret';
    const res = await runWorker(
      workerRequest({ 'x-context-package-job-token': 'wrong' }),
      params('job-1'),
    );
    expect(res.status).toBe(401);
    expect(runContextPackageJobMock).not.toHaveBeenCalled();
  });

  it('共有トークン一致なら実行する', async () => {
    process.env.CONTEXT_PACKAGE_JOB_TOKEN = 'secret';
    runContextPackageJobMock.mockResolvedValue({
      outcome: 'skipped',
      reason: 'not_queued',
    });
    const res = await runWorker(
      workerRequest({ 'x-context-package-job-token': 'secret' }),
      params('job-1'),
    );
    expect(res.status).toBe(200);
    expect(runContextPackageJobMock).toHaveBeenCalledWith('job-1');
  });
});

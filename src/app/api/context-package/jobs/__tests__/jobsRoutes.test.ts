import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cancelContextPackageJobMock,
  getContextPackageJobMock,
  isContextPackageJobLeaseExpiredMock,
  readContextPackageJobResultMock,
  recoverStaleRunningContextPackageJobMock,
  recoverStaleRunningContextPackageJobsMock,
  runContextPackageJobMock,
} = vi.hoisted(() => ({
  cancelContextPackageJobMock: vi.fn(),
  getContextPackageJobMock: vi.fn(),
  isContextPackageJobLeaseExpiredMock: vi.fn(),
  readContextPackageJobResultMock: vi.fn(),
  recoverStaleRunningContextPackageJobMock: vi.fn(),
  recoverStaleRunningContextPackageJobsMock: vi.fn(),
  runContextPackageJobMock: vi.fn(),
}));

vi.mock('../../../../../lib/contextPackageJobs/firestoreAdapter', () => ({
  cancelContextPackageJob: cancelContextPackageJobMock,
  getContextPackageJob: getContextPackageJobMock,
  isContextPackageJobLeaseExpired: isContextPackageJobLeaseExpiredMock,
  recoverStaleRunningContextPackageJob: recoverStaleRunningContextPackageJobMock,
  recoverStaleRunningContextPackageJobs: recoverStaleRunningContextPackageJobsMock,
}));

vi.mock('../../../../../lib/contextPackageJobs/resultStorage', () => ({
  readContextPackageJobResult: readContextPackageJobResultMock,
}));

vi.mock('../../../../../lib/contextPackageJobs/runJob', () => ({
  runContextPackageJob: runContextPackageJobMock,
}));

// auditActorFromRequest は本物を使う（local fallback で tenantId = 'local-dev'）。

import { GET as getStatus } from '../[jobId]/route';
import { DELETE as cancelJob } from '../[jobId]/route';
import { GET as getResult } from '../[jobId]/result/route';
import { POST as runWorker } from '../[jobId]/run/route';
import { POST as runSweep } from '../sweep/route';

function statusRequest(): Request {
  return new Request('http://localhost/api/context-package/jobs/job-1');
}
function deleteRequest(): Request {
  return new Request('http://localhost/api/context-package/jobs/job-1', {
    method: 'DELETE',
  });
}
function workerRequest(headers?: Record<string, string>): Request {
  return new Request('http://localhost/api/context-package/jobs/job-1/run', {
    method: 'POST',
    headers,
  });
}
function sweepRequest(
  body?: Record<string, unknown>,
  headers?: Record<string, string>,
): Request {
  return new Request('http://localhost/api/context-package/jobs/sweep', {
    method: 'POST',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(headers ?? {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
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
  recoverStaleRunningContextPackageJobMock.mockResolvedValue({
    recovered: false,
    reason: 'within_retry_window',
  });
  cancelContextPackageJobMock.mockResolvedValue({
    cancelled: true,
    previousStatus: 'queued',
  });
  recoverStaleRunningContextPackageJobsMock.mockResolvedValue({
    scanned: 0,
    recovered: 0,
    skipped: {
      notFound: 0,
      notRunning: 0,
      leaseActive: 0,
      withinRetryWindow: 0,
    },
  });
  readContextPackageJobResultMock.mockResolvedValue({ markdown: '# gcs' });
  isContextPackageJobLeaseExpiredMock.mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
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

  it('running job の lease が有効なら stale recovery を試行しない', async () => {
    getContextPackageJobMock.mockResolvedValue({
      ...OWN_TENANT_JOB,
      status: 'running',
      leaseExpiresAt: '2026-06-03T00:15:00.000Z',
    });

    const res = await getStatus(statusRequest(), params('job-1'));
    expect(res.status).toBe(200);
    expect(recoverStaleRunningContextPackageJobMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.status).toBe('running');
  });

  it('running job の lease が期限切れなら stale recovery を試行して最新 status を返す', async () => {
    getContextPackageJobMock
      .mockResolvedValueOnce({ ...OWN_TENANT_JOB, status: 'running' })
      .mockResolvedValueOnce({ ...OWN_TENANT_JOB, status: 'failed' });
    isContextPackageJobLeaseExpiredMock.mockReturnValue(true);
    recoverStaleRunningContextPackageJobMock.mockResolvedValue({ recovered: true });

    const res = await getStatus(statusRequest(), params('job-1'));
    expect(res.status).toBe(200);
    expect(recoverStaleRunningContextPackageJobMock).toHaveBeenCalledWith('job-1');
    const body = await res.json();
    expect(body.status).toBe('failed');
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

  it('inline result が無く resultRef がある場合は GCS から返す', async () => {
    getContextPackageJobMock.mockResolvedValue({
      ...OWN_TENANT_JOB,
      result: undefined,
      resultRef: {
        storage: 'gcs',
        bucket: 'bucket-1',
        objectPath: 'context-package/job-results/local-dev/job-1.json',
        contentType: 'application/json',
        byteSize: 123,
      },
    });

    const res = await getResult(statusRequest(), params('job-1'));
    expect(res.status).toBe(200);
    expect(readContextPackageJobResultMock).toHaveBeenCalledWith(
      expect.objectContaining({ storage: 'gcs' }),
      { tenantId: 'local-dev', jobId: 'job-1' },
    );
    expect(await res.json()).toEqual({ markdown: '# gcs' });
  });

  it('resultRef 読み取り失敗は 502 result_unavailable', async () => {
    getContextPackageJobMock.mockResolvedValue({
      ...OWN_TENANT_JOB,
      result: undefined,
      resultRef: {
        storage: 'gcs',
        bucket: 'bucket-1',
        objectPath: 'context-package/job-results/local-dev/job-1.json',
        contentType: 'application/json',
        byteSize: 123,
      },
    });
    readContextPackageJobResultMock.mockRejectedValue(new Error('missing object'));

    const res = await getResult(statusRequest(), params('job-1'));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'result_unavailable' });
  });
});

describe('DELETE /jobs/:jobId (cancel)', () => {
  it('queued/running job は cancelled に遷移する', async () => {
    getContextPackageJobMock.mockResolvedValue({
      ...OWN_TENANT_JOB,
      status: 'queued',
      result: undefined,
    });
    cancelContextPackageJobMock.mockResolvedValue({
      cancelled: true,
      previousStatus: 'queued',
    });

    const res = await cancelJob(deleteRequest(), params('job-1'));
    expect(res.status).toBe(200);
    expect(cancelContextPackageJobMock).toHaveBeenCalledWith('job-1');
    expect(await res.json()).toEqual({ jobId: 'job-1', status: 'cancelled' });
  });

  it('別 tenant の cancel は 404', async () => {
    getContextPackageJobMock.mockResolvedValue({
      ...OWN_TENANT_JOB,
      request: { ...OWN_TENANT_JOB.request, tenantId: 'other-tenant' },
    });

    const res = await cancelJob(deleteRequest(), params('job-1'));
    expect(res.status).toBe(404);
    expect(cancelContextPackageJobMock).not.toHaveBeenCalled();
  });

  it('すでに terminal（succeeded/failed）は 409', async () => {
    getContextPackageJobMock.mockResolvedValue(OWN_TENANT_JOB);
    const res = await cancelJob(deleteRequest(), params('job-1'));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('job_not_cancellable');
  });

  it('すでに cancelled は 200 を返す（idempotent）', async () => {
    getContextPackageJobMock.mockResolvedValue({
      ...OWN_TENANT_JOB,
      status: 'cancelled',
      result: undefined,
    });
    const res = await cancelJob(deleteRequest(), params('job-1'));
    expect(res.status).toBe(200);
    expect(cancelContextPackageJobMock).not.toHaveBeenCalled();
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

  it('production では共有トークン未設定を 401 で拒否する', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await runWorker(workerRequest(), params('job-1'));
    expect(res.status).toBe(401);
    expect(runContextPackageJobMock).not.toHaveBeenCalled();
  });

  it('共有トークン一致なら実行する', async () => {
    process.env.CONTEXT_PACKAGE_JOB_TOKEN = 'secret';
    runContextPackageJobMock.mockResolvedValue({
      outcome: 'skipped',
      reason: 'terminal',
    });
    const res = await runWorker(
      workerRequest({ 'x-context-package-job-token': 'secret' }),
      params('job-1'),
    );
    expect(res.status).toBe(200);
    expect(runContextPackageJobMock).toHaveBeenCalledWith('job-1');
  });

  it('active lease 中の重複配信は 503（Cloud Tasks を成功扱いにしない）', async () => {
    runContextPackageJobMock.mockResolvedValue({
      outcome: 'skipped',
      reason: 'active_lease',
    });
    const res = await runWorker(workerRequest(), params('job-1'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.reason).toBe('active_lease');
  });

  it('terminal skip は 200（冪等な重複配信）', async () => {
    runContextPackageJobMock.mockResolvedValue({
      outcome: 'skipped',
      reason: 'terminal',
    });
    const res = await runWorker(workerRequest(), params('job-1'));
    expect(res.status).toBe(200);
  });
});

describe('POST /jobs/sweep', () => {
  it('トークン不一致は 401', async () => {
    process.env.CONTEXT_PACKAGE_JOB_TOKEN = 'secret';
    const res = await runSweep(
      sweepRequest(undefined, { 'x-context-package-job-token': 'wrong' }),
    );
    expect(res.status).toBe(401);
    expect(recoverStaleRunningContextPackageJobsMock).not.toHaveBeenCalled();
  });

  it('authorized request は stale recovery batch を実行する', async () => {
    process.env.CONTEXT_PACKAGE_JOB_TOKEN = 'secret';
    recoverStaleRunningContextPackageJobsMock.mockResolvedValue({
      scanned: 5,
      recovered: 2,
      skipped: {
        notFound: 0,
        notRunning: 1,
        leaseActive: 1,
        withinRetryWindow: 1,
      },
    });

    const res = await runSweep(
      sweepRequest(
        { limit: 50 },
        { 'x-context-package-job-token': 'secret' },
      ),
    );
    expect(res.status).toBe(200);
    expect(recoverStaleRunningContextPackageJobsMock).toHaveBeenCalledWith({
      limit: 50,
    });
    const body = await res.json();
    expect(body.recovered).toBe(2);
  });
});

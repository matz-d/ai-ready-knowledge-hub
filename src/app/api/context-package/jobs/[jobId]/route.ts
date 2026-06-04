/**
 * `GET /api/context-package/jobs/[jobId]` — job の状態を返す（ポーリング用）。
 *
 * result 本文は含めない（完了後は `…/result` で取得）。UI は status と progress を
 * 見て「処理中 / 完了 / 失敗」を表示する。
 */
import { NextResponse } from 'next/server';
import {
  cancelContextPackageJob,
  getContextPackageJob,
  isContextPackageJobLeaseExpired,
  recoverStaleRunningContextPackageJob,
} from '../../../../../lib/contextPackageJobs/firestoreAdapter';
import { auditActorFromRequest } from '../../../../../lib/audit/auditEvent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ jobId: string }> };

function statusResponse(job: NonNullable<Awaited<ReturnType<typeof getContextPackageJob>>>) {
  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    expiresAt: job.expiresAt,
    resultUrl:
      job.status === 'succeeded'
        ? `/api/context-package/jobs/${job.jobId}/result`
        : undefined,
  };
}

export async function GET(
  request: Request,
  { params }: RouteParams,
) {
  const { jobId } = await params;
  if (!jobId?.trim()) {
    return NextResponse.json({ error: 'job_id_required' }, { status: 400 });
  }

  // tenant 越境防止: 別 tenant の jobId を知っていても読めないよう、存在を隠して 404。
  const { tenantId } = auditActorFromRequest(request);
  const job = await getContextPackageJob(jobId);
  if (!job || job.request.tenantId !== tenantId) {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }

  let latest = job;
  if (
    job.status === 'running' &&
    isContextPackageJobLeaseExpired(job.leaseExpiresAt)
  ) {
    try {
      await recoverStaleRunningContextPackageJob(jobId);
      const refreshed = await getContextPackageJob(jobId);
      if (refreshed && refreshed.request.tenantId === tenantId) {
        latest = refreshed;
      }
    } catch (error) {
      // status polling 自体は落とさず、回収は best-effort で継続する。
      console.error('[context-package-job] stale recovery check failed', {
        jobId,
        error,
      });
    }
  }

  return NextResponse.json(statusResponse(latest));
}

/**
 * `DELETE /api/context-package/jobs/[jobId]` — job cancel（tenant owner のみ）。
 *
 * queued/running のみ `cancelled` へ遷移。`running` の in-flight worker は即停止できず、
 * 後続 complete/fail が status 条件で拒否されることで実質的に結果を破棄する。
 */
export async function DELETE(
  request: Request,
  { params }: RouteParams,
) {
  const { jobId } = await params;
  if (!jobId?.trim()) {
    return NextResponse.json({ error: 'job_id_required' }, { status: 400 });
  }

  const { tenantId } = auditActorFromRequest(request);
  const job = await getContextPackageJob(jobId);
  if (!job || job.request.tenantId !== tenantId) {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }

  if (job.status === 'cancelled') {
    return NextResponse.json({ jobId, status: 'cancelled' });
  }
  if (job.status === 'succeeded' || job.status === 'failed') {
    return NextResponse.json(
      { error: 'job_not_cancellable', status: job.status },
      { status: 409 },
    );
  }

  const cancelled = await cancelContextPackageJob(jobId);
  if (cancelled.cancelled) {
    return NextResponse.json({ jobId, status: 'cancelled' });
  }
  if (cancelled.reason === 'not_found') {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }

  // 競合で terminal へ変わったケースは現状態を返す（idempotent / conflict を明示）。
  const current = await getContextPackageJob(jobId);
  if (current?.request.tenantId === tenantId && current.status === 'cancelled') {
    return NextResponse.json({ jobId, status: 'cancelled' });
  }
  return NextResponse.json(
    { error: 'job_not_cancellable', status: current?.status ?? 'failed' },
    { status: 409 },
  );
}

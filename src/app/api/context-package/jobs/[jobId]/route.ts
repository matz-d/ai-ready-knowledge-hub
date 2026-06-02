/**
 * `GET /api/context-package/jobs/[jobId]` — job の状態を返す（ポーリング用）。
 *
 * result 本文は含めない（完了後は `…/result` で取得）。UI は status と progress を
 * 見て「処理中 / 完了 / 失敗」を表示する。
 */
import { NextResponse } from 'next/server';
import { getContextPackageJob } from '../../../../../lib/contextPackageJobs/firestoreAdapter';
import { auditActorFromRequest } from '../../../../../lib/audit/auditEvent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  if (!jobId?.trim()) {
    return NextResponse.json({ error: 'job_id_required' }, { status: 400 });
  }

  const job = await getContextPackageJob(jobId);
  // tenant 越境防止: 別 tenant の jobId を知っていても読めないよう、存在を隠して 404。
  const { tenantId } = auditActorFromRequest(request);
  if (!job || job.request.tenantId !== tenantId) {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }

  return NextResponse.json({
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    resultUrl:
      job.status === 'succeeded'
        ? `/api/context-package/jobs/${job.jobId}/result`
        : undefined,
  });
}

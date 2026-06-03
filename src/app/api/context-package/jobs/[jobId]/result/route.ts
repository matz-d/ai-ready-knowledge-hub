/**
 * `GET /api/context-package/jobs/[jobId]/result` — 完了 job の Context Package payload。
 *
 * payload は同期経路 `POST /api/context-package` のレスポンス本文と同型
 * （markdown + projection 済み chunk view）。未完了 / 失敗時は 409 で status を返す。
 */
import { NextResponse } from 'next/server';
import { getContextPackageJob } from '../../../../../../lib/contextPackageJobs/firestoreAdapter';
import { readContextPackageJobResult } from '../../../../../../lib/contextPackageJobs/resultStorage';
import { auditActorFromRequest } from '../../../../../../lib/audit/auditEvent';

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
  // tenant 越境防止: 別 tenant の result を読めないよう、存在を隠して 404。
  const { tenantId } = auditActorFromRequest(request);
  if (!job || job.request.tenantId !== tenantId) {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }

  if (job.status !== 'succeeded' || (!job.result && !job.resultRef)) {
    return NextResponse.json(
      {
        error: 'job_not_succeeded',
        status: job.status,
        ...(job.error ? { jobError: job.error } : {}),
      },
      { status: 409 },
    );
  }

  if (job.result) {
    return NextResponse.json(job.result);
  }

  try {
    const payload = await readContextPackageJobResult(job.resultRef!, {
      tenantId,
      jobId,
    });
    return NextResponse.json(payload);
  } catch (error) {
    console.error('[context-package-job] failed to read offloaded result', {
      jobId,
      error,
    });
    return NextResponse.json({ error: 'result_unavailable' }, { status: 502 });
  }
}

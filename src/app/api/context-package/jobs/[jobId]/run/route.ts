/**
 * `POST /api/context-package/jobs/[jobId]/run` — Cloud Tasks worker。
 *
 * Cloud Tasks が enqueue した task がこのエンドポイントを叩く。job を冪等に
 * 実行し、結果を job doc へ書き戻す。
 *
 * 認証:
 * - 本番は Cloud Tasks の OIDC token（service account）で保護する想定。
 * - 加えて共有シークレット `CONTEXT_PACKAGE_JOB_TOKEN`（env）が設定されていれば
 *   `X-Context-Package-Job-Token` ヘッダと照合する（多層防御 / dev での簡易ガード）。
 *
 * Cloud Tasks リトライ制御:
 * - 実行できた（成功・業務的失敗とも job doc に記録済み）→ 200（リトライ不要。
 *   失敗は claim 消費済みのため再試行しても冪等 skip になる）。
 * - 想定外の例外（claim 永続化前など）→ 500 でリトライさせる。
 */
import { NextResponse } from 'next/server';
import { runContextPackageJob } from '../../../../../../lib/contextPackageJobs/runJob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  const expected = process.env.CONTEXT_PACKAGE_JOB_TOKEN;
  if (!expected) {
    // 共有シークレット未設定時は OIDC 等の上位レイヤに委ね、ここでは素通し（dev）。
    return true;
  }
  return request.headers.get('x-context-package-job-token') === expected;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { jobId } = await params;
  if (!jobId?.trim()) {
    return NextResponse.json({ error: 'job_id_required' }, { status: 400 });
  }

  try {
    const outcome = await runContextPackageJob(jobId);
    return NextResponse.json(outcome, { status: 200 });
  } catch (e) {
    // claim 永続化前などの想定外例外のみ 500 にして Cloud Tasks の再試行に委ねる。
    console.error('[context-package-job] worker crashed', { jobId, error: e });
    return NextResponse.json({ error: 'worker_failure', jobId }, { status: 500 });
  }
}

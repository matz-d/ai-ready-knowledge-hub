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
 * - 実行できた（成功・業務的失敗とも job doc に記録済み）→ 200（リトライ不要）。
 * - 終端状態への重複配信（terminal skip）→ 200（冪等）。
 * - 有効 lease 下での重複配信（active_lease skip）→ 503（タスク成功扱いにしない）。
 * - 想定外の例外（transient 失敗など）→ 500 でリトライさせる。
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

function workerHttpStatus(
  outcome: Awaited<ReturnType<typeof runContextPackageJob>>,
): number {
  if (outcome.outcome === 'skipped') {
    if (outcome.reason === 'active_lease') return 503;
    if (outcome.reason === 'not_found') return 404;
    // terminal: 既に succeeded / failed / cancelled — 再実行不要。
    return 200;
  }
  return 200;
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
    return NextResponse.json(outcome, { status: workerHttpStatus(outcome) });
  } catch (e) {
    console.error('[context-package-job] worker crashed', { jobId, error: e });
    return NextResponse.json({ error: 'worker_failure', jobId }, { status: 500 });
  }
}

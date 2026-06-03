/**
 * `POST /api/context-package/jobs/sweep` — stale running recovery sweeper。
 *
 * Cloud Scheduler などの定期実行で `running` job を走査し、lease 期限切れかつ
 * retry 窓超過のものを terminal (`failed`) へ回収する。
 */
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { recoverStaleRunningContextPackageJobs } from '../../../../../lib/contextPackageJobs/firestoreAdapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SweepRequestSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
});

function isAuthorized(request: Request): boolean {
  const expected = process.env.CONTEXT_PACKAGE_JOB_TOKEN;
  if (!expected) {
    return false;
  }
  const actual = request.headers.get('x-context-package-job-token');
  if (!actual) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  if (expectedBytes.length !== actualBytes.length) return false;
  return timingSafeEqual(expectedBytes, actualBytes);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown = {};
  try {
    const raw = await request.text();
    if (raw.trim()) {
      body = JSON.parse(raw);
    }
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', details: 'JSON body を送信してください。' },
      { status: 400 },
    );
  }

  const parsed = SweepRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await recoverStaleRunningContextPackageJobs({
      ...(parsed.data.limit ? { limit: parsed.data.limit } : {}),
    });
    console.info('[context-package-job] sweeper completed', result);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[context-package-job] sweeper failed', error);
    return NextResponse.json({ error: 'sweeper_failure' }, { status: 500 });
  }
}

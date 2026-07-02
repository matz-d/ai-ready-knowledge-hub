/**
 * `POST /api/demo/sample-documents/reset` — purge and reseed accounting-office demo samples.
 *
 * Intended for Cloud Scheduler in the public demo project only. Requires
 * `DEMO_MODE=true` and `X-Demo-Reset-Token`.
 */
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { isDemoMode } from '../../../../../lib/demoMode';
import { ingestAllDemoSamples } from '../../../../../lib/demoSampleDocuments';
import { purgeDemoSampleDocuments } from '../../../../../lib/demoSamplePurge';
import {
  acquireDemoResetLock,
  releaseDemoResetLock,
} from '../../../../../lib/demoSampleResetLock';
import { getKnowledgeHubBucketName } from '../../../../../lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  const expected = process.env.DEMO_RESET_TOKEN;
  if (!expected) {
    return false;
  }
  const actual = request.headers.get('x-demo-reset-token');
  if (!actual) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  if (expectedBytes.length !== actualBytes.length) return false;
  return timingSafeEqual(expectedBytes, actualBytes);
}

export async function POST(request: Request) {
  if (!isDemoMode()) {
    return NextResponse.json({ error: 'demo_mode_disabled' }, { status: 403 });
  }

  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    getKnowledgeHubBucketName();
  } catch {
    return NextResponse.json(
      { error: 'サーバー設定 (KNOWLEDGE_HUB_BUCKET) が未完了です。' },
      { status: 503 }
    );
  }

  const lock = await acquireDemoResetLock();
  if (!lock.ok) {
    return NextResponse.json({ error: 'reset_in_progress' }, { status: 409 });
  }

  try {
    const purged = await purgeDemoSampleDocuments();
    const ingest = await ingestAllDemoSamples(request);

    console.info('[demo] sample reset completed', {
      purgedDocCount: purged.docIds.length,
      gcsObjectsDeleted: purged.gcsObjectsDeleted,
      imported: ingest.imported,
      alreadyPresent: ingest.alreadyPresent,
      failed: ingest.failed,
      purgeFailures: purged.failures.length,
    });

    if (purged.failures.length > 0 || ingest.failed > 0) {
      return NextResponse.json(
        {
          error: 'reset_incomplete',
          purged,
          ...ingest,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      purged,
      ...ingest,
    });
  } catch (error) {
    console.error('[demo] sample reset failed', error);
    return NextResponse.json({ error: 'reset_failure' }, { status: 500 });
  } finally {
    await releaseDemoResetLock(lock.lockId);
  }
}

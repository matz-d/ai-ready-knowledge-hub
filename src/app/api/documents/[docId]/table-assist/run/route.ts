/**
 * `POST /api/documents/[docId]/table-assist/run` — Cloud Tasks worker.
 *
 * This endpoint is the async ingest entrypoint for grounded Gemini table-assist.
 * It reuses the product reprocess service so the same feature flag, subtype,
 * raw hash, Masker-before-chunk, rollback, and single-flight lease invariants
 * are enforced in both manual and automatic paths.
 */
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  reprocessPdfWithTableAssist,
  type PdfTableAssistReprocessFailure,
} from '../../../../../../lib/pdfTableAssistReprocessor';
import { verifyPdfTableAssistTaskPayload } from '../../../../../../lib/pdfTableAssistTaskSigning';
import type { OrchestrateAuditContext } from '../../../../../../lib/uploadOrchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function tokensMatch(provided: string | null, expected: string): boolean {
  const providedBytes = Buffer.from(provided ?? '');
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length) {
    return false;
  }
  return timingSafeEqual(providedBytes, expectedBytes);
}

function isAuthorized(request: Request): boolean {
  const expected =
    process.env.PDF_TABLE_ASSIST_WORKER_TOKEN ??
    process.env.CONTEXT_PACKAGE_JOB_TOKEN;
  // The shared token is defense-in-depth on top of Cloud Run IAP/OIDC and the
  // required Cloud Tasks payload signature (verified below). When no token is
  // configured we defer to those layers instead of failing closed here, so a
  // "signing configured, token omitted" production deployment is not silently
  // rejected at the token gate while still being signature-gated. This mirrors
  // the enqueuer, which requires signing but treats the token as optional.
  if (!expected) {
    return true;
  }
  return tokensMatch(
    request.headers.get('x-pdf-table-assist-worker-token'),
    expected
  );
}

async function parseWorkerBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function auditContextFromVerifiedPayload(payload: {
  tenantId: string;
  actor: OrchestrateAuditContext['actor'];
}): OrchestrateAuditContext | null {
  if (payload.tenantId.trim().length === 0) {
    return null;
  }
  return {
    tenantId: payload.tenantId,
    actor: payload.actor,
  };
}

function workerHttpStatus(
  failure: PdfTableAssistReprocessFailure | undefined
): number {
  if (failure?.code === 'reprocess_in_progress') {
    // Keep the task alive so Cloud Tasks can retry after the current lease clears.
    return 503;
  }
  // All other structured failures are terminal for this task delivery: the
  // worker re-ran validation and decided the document should not be augmented.
  return 200;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ docId: string }> }
) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { docId } = await params;
  if (!docId?.trim()) {
    return NextResponse.json({ error: 'doc_id_required' }, { status: 400 });
  }

  const body = await parseWorkerBody(request);
  if (body === null || typeof body !== 'object') {
    return NextResponse.json({ error: 'task_signature_required' }, { status: 401 });
  }

  const verified = verifyPdfTableAssistTaskPayload(body);
  if (!verified.ok) {
    // All signature failures (required / invalid / expired) reject with 401.
    // Cloud Tasks retries any non-2xx until maxAttempts regardless of the exact
    // 4xx code, so the code is informational and surfaced only in the body.
    return NextResponse.json({ error: verified.code }, { status: 401 });
  }

  const { payload } = verified;
  if (payload.docId !== docId) {
    return NextResponse.json({ error: 'doc_id_mismatch' }, { status: 400 });
  }

  const auditContext = auditContextFromVerifiedPayload(payload);
  if (auditContext === null) {
    return NextResponse.json({ error: 'tenant_required' }, { status: 400 });
  }

  try {
    const outcome = await reprocessPdfWithTableAssist({
      docId,
      tenantId: auditContext.tenantId,
      auditContext,
    });

    if (!outcome.ok) {
      return NextResponse.json(
        { outcome: 'skipped', failure: outcome.failure },
        { status: workerHttpStatus(outcome.failure) }
      );
    }

    return NextResponse.json({
      outcome: 'reprocessed',
      docId,
      tableAssist: outcome.result.body.tableAssist,
    });
  } catch (error) {
    console.error('[documents/table-assist-worker] reprocess crashed', {
      docId,
      error,
    });
    return NextResponse.json(
      { error: 'table_assist_worker_failure', docId },
      { status: 500 }
    );
  }
}

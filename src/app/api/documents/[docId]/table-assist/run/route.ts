/**
 * `POST /api/documents/[docId]/table-assist/run` — Cloud Tasks worker.
 *
 * This endpoint is the async ingest entrypoint for grounded Gemini table-assist.
 * It reuses the product reprocess service so the same feature flag, subtype,
 * raw hash, Masker-before-chunk, rollback, and single-flight lease invariants
 * are enforced in both manual and automatic paths.
 */
import { NextResponse } from 'next/server';
import {
  reprocessPdfWithTableAssist,
  type PdfTableAssistReprocessFailure,
} from '../../../../../../lib/pdfTableAssistReprocessor';
import { verifyPdfTableAssistTaskPayload } from '../../../../../../lib/pdfTableAssistTaskSigning';
import type { OrchestrateAuditContext } from '../../../../../../lib/uploadOrchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  const expected =
    process.env.PDF_TABLE_ASSIST_WORKER_TOKEN ??
    process.env.CONTEXT_PACKAGE_JOB_TOKEN;
  if (!expected) {
    return process.env.NODE_ENV !== 'production';
  }
  return request.headers.get('x-pdf-table-assist-worker-token') === expected;
}

async function parseWorkerBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function signatureHttpStatus(
  _code: 'task_signature_required' | 'task_signature_invalid' | 'task_signature_expired'
): number {
  return 401;
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
    return NextResponse.json(
      { error: verified.code },
      { status: signatureHttpStatus(verified.code) }
    );
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

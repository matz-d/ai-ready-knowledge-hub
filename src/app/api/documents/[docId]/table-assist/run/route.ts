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
import type { OrchestrateAuditContext } from '../../../../../../lib/uploadOrchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type WorkerBody = {
  docId?: unknown;
  tenantId?: unknown;
  actor?: unknown;
};

function isAuthorized(request: Request): boolean {
  const expected =
    process.env.PDF_TABLE_ASSIST_WORKER_TOKEN ??
    process.env.CONTEXT_PACKAGE_JOB_TOKEN;
  if (!expected) {
    return process.env.NODE_ENV !== 'production';
  }
  return request.headers.get('x-pdf-table-assist-worker-token') === expected;
}

async function parseWorkerBody(request: Request): Promise<WorkerBody> {
  try {
    return (await request.json()) as WorkerBody;
  } catch {
    return {};
  }
}

function parseAuditContext(body: WorkerBody): OrchestrateAuditContext | null {
  if (typeof body.tenantId !== 'string' || body.tenantId.trim().length === 0) {
    return null;
  }
  const actor = body.actor;
  if (actor === null || typeof actor !== 'object') return null;

  const candidate = actor as Record<string, unknown>;
  const userId = candidate.userId;
  const ipAddress = candidate.ipAddress;
  const userAgent = candidate.userAgent;
  if (
    typeof userId !== 'string' ||
    typeof ipAddress !== 'string' ||
    typeof userAgent !== 'string'
  ) {
    return null;
  }

  return {
    tenantId: body.tenantId,
    actor: { userId, ipAddress, userAgent },
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
  if (typeof body.docId === 'string' && body.docId !== docId) {
    return NextResponse.json({ error: 'doc_id_mismatch' }, { status: 400 });
  }

  const auditContext = parseAuditContext(body);
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

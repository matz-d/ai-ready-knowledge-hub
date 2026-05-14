/**
 * `POST /api/context-package` — Purpose Query API (Phase 3-C-4)
 *
 * Validates the request, runs the Strategist orchestrator, and returns a
 * structured Context Package with a rendered markdown export.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Sensitivity } from '../../../agents/curator/schema';
import {
  buildStrategistContextPackage,
  NoInventoryDocumentsError,
  NoKnowledgeChunksError,
  runStrategistOrchestrator,
  type StrategistOrchestratorResult,
} from '../../../services/strategistOrchestrator';
import { auditActorFromRequest, recordAuditEvent } from '../../../lib/audit/auditEvent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function contextPackageAuditTarget(result: StrategistOrchestratorResult): {
  docId: string;
  fileName: string;
  sourceKind: 'upload';
  sensitivity: Sensitivity | 'Unknown';
} {
  const row =
    result.included[0] ?? result.excluded[0] ?? result.safetyExcluded[0];
  if (row) {
    return {
      docId: row.chunk.docId,
      fileName: row.parent.fileName,
      sourceKind: 'upload',
      sensitivity: row.chunk.sensitivity,
    };
  }
  return {
    docId: 'context-package',
    fileName:
      result.purpose.trim().length > 0
        ? result.purpose.slice(0, 200)
        : 'Context Package',
    sourceKind: 'upload',
    sensitivity: 'Unknown',
  };
}

const RequestSchema = z.object({
  purpose: z.string().min(1).max(2000),
  limit: z.number().int().min(1).max(100).default(100),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', details: 'JSON body を送信してください。' },
      { status: 400 },
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { purpose, limit } = parsed.data;

  try {
    const result = await runStrategistOrchestrator({ purpose, limit });
    const { markdown } = buildStrategistContextPackage(result);

    try {
      const { tenantId, actor } = auditActorFromRequest(request);
      await recordAuditEvent({
        tenantId,
        actor,
        action: 'document.export',
        target: contextPackageAuditTarget(result),
        result: 'success',
      });
    } catch (auditErr) {
      console.error('[context-package] recordAuditEvent failed', auditErr);
    }

    return NextResponse.json({
      purpose: result.purpose,
      generatedAt: result.generatedAt,
      sourceDocumentsReviewed: result.sourceDocumentsReviewed,
      included: result.included,
      excluded: result.excluded,
      safetyExcluded: result.safetyExcluded,
      missing: result.missing,
      humanReviewQuestions: result.humanReviewQuestions,
      markdown,
      counts: {
        included: result.included.length,
        excluded: result.excluded.length,
        safetyExcluded: result.safetyExcluded.length,
        missing: result.missing.length,
        humanReviewQuestions: result.humanReviewQuestions.length,
      },
    });
  } catch (e) {
    if (e instanceof NoInventoryDocumentsError) {
      return NextResponse.json({ error: 'no_inventory_documents' }, { status: 409 });
    }
    if (e instanceof NoKnowledgeChunksError) {
      return NextResponse.json({ error: 'no_knowledge_chunks' }, { status: 409 });
    }
    console.error('[context-package] orchestrator failed', e);
    return NextResponse.json({ error: 'upstream_failure' }, { status: 502 });
  }
}

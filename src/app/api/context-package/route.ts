/**
 * `POST /api/context-package` — Purpose Query API (Phase 3-C-4)
 *
 * Validates the request, runs the Strategist orchestrator, and returns a
 * structured Context Package with a rendered markdown export.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { modelId } from '../../../agents/_shared/genkitClient';
import type { Sensitivity } from '../../../agents/curator/schema';
import {
  buildStrategistContextPackage,
  NoInventoryDocumentsError,
  NoKnowledgeChunksError,
  StrategistSyncBudgetExceededError,
  UnresolvedDocIdsError,
  runStrategistOrchestrator,
  toExcludedChunkView,
  toIncludedChunkView,
  toSafetyExcludedChunkView,
  type StrategistOrchestratorResult,
} from '../../../services/strategistOrchestrator';
import {
  auditActorFromRequest,
  createPurposeBinding,
  recordAuditEvent,
} from '../../../lib/audit/auditEvent';
import { PROCESSING_PROFILE_PRESETS } from '../../../lib/processingProfile';

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
  docIds: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
});

/** Maps strict docIds resolution failures to 400. Prefer `unknown_doc_ids` when both
 *  kinds are present; `details` always includes both `unknownDocIds` and
 *  `nonTerminalDocIds` for UI / audit. */
function unresolvedDocIdsResponse(e: UnresolvedDocIdsError): {
  error: 'unknown_doc_ids' | 'non_terminal_doc_ids';
  details: {
    unknownDocIds: string[];
    nonTerminalDocIds: { docId: string; status: string }[];
  };
} {
  const error = e.unknownDocIds.length > 0 ? 'unknown_doc_ids' : 'non_terminal_doc_ids';
  return {
    error,
    details: {
      unknownDocIds: e.unknownDocIds,
      nonTerminalDocIds: e.nonTerminalDocIds,
    },
  };
}

function defaultCloudRegion(): string {
  return process.env.GOOGLE_CLOUD_LOCATION ?? 'asia-northeast1';
}

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

  const { purpose, limit, docIds } = parsed.data;

  try {
    const result = await runStrategistOrchestrator({
      purpose,
      limit,
      ...(docIds && docIds.length > 0 ? { docIds } : {}),
    });
    const { markdown } = buildStrategistContextPackage(result);

    try {
      const { tenantId, actor } = auditActorFromRequest(request);
      const region = defaultCloudRegion();
      await recordAuditEvent({
        tenantId,
        actor,
        action: 'document.export',
        target: contextPackageAuditTarget(result),
        result: 'success',
        processingProfile: PROCESSING_PROFILE_PRESETS['cloud-managed'],
        purposeBinding: createPurposeBinding({
          purpose: result.purpose,
          tenantId,
          timestamp: result.generatedAt,
        }),
        inferenceDestination: {
          vendor: 'vertex',
          region,
          model: modelId,
        },
        dataResidency: {
          storage: region,
          processing: region,
        },
      });
    } catch (auditErr) {
      console.error('[context-package] recordAuditEvent failed', auditErr);
    }

    return NextResponse.json({
      purpose: result.purpose,
      generatedAt: result.generatedAt,
      sourceDocumentsReviewed: result.sourceDocumentsReviewed,
      // raw chunk.text を境界外へ出さないため metadata + AI-safe 本文のみへ projection する。
      included: result.included.map(toIncludedChunkView),
      excluded: result.excluded.map(toExcludedChunkView),
      safetyExcluded: result.safetyExcluded.map(toSafetyExcludedChunkView),
      missing: result.missing,
      humanReviewQuestions: result.humanReviewQuestions,
      syncEstimateSeconds: result.syncEstimateSeconds,
      markdown,
      counts: {
        included: result.included.length,
        excluded: result.excluded.length,
        safetyExcluded: result.safetyExcluded.length,
        missing: result.missing.length,
        humanReviewQuestions: result.humanReviewQuestions.length,
      },
      budget: {
        ...result.budget,
        // 観測用の明示エイリアス（report の droppedChunks と同値）
        budgetDroppedCount: result.budget.droppedChunks,
      },
      // budget で落とした safe chunk の文書別内訳。空でなければ package は不完全。
      budgetDroppedDocuments: result.budgetDroppedDocuments,
    });
  } catch (e) {
    if (e instanceof UnresolvedDocIdsError) {
      return NextResponse.json(unresolvedDocIdsResponse(e), { status: 400 });
    }
    if (e instanceof NoInventoryDocumentsError) {
      return NextResponse.json({ error: 'no_inventory_documents' }, { status: 409 });
    }
    if (e instanceof NoKnowledgeChunksError) {
      return NextResponse.json({ error: 'no_knowledge_chunks' }, { status: 409 });
    }
    if (e instanceof StrategistSyncBudgetExceededError) {
      return NextResponse.json(
        {
          error: 'sync_budget_exceeded',
          details:
            '同期処理の目標時間（20秒）を超える見込みです。対象を絞って再実行してください。',
          estimatedSeconds: e.estimatedSeconds,
          targetSeconds: e.targetSeconds,
          budget: e.budget,
          recommendation: {
            hint:
              'docIds フィルタや limit 指定で対象文書を絞ると、同期レスポンスで完了しやすくなります。',
            suggestedDocIds: e.suggestedDocIds,
          },
        },
        { status: 422 },
      );
    }
    console.error('[context-package] orchestrator failed', e);
    return NextResponse.json({ error: 'upstream_failure' }, { status: 502 });
  }
}

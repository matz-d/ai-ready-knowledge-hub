/**
 * `POST /api/context-package` — Purpose Query API (Phase 3-C-4)
 *
 * Validates the request, runs the Strategist orchestrator, and returns a
 * structured Context Package with a rendered markdown export.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { location, modelId } from '../../../agents/_shared/genkitClient';
import {
  buildContextPackageResponsePayload,
  contextPackageAuditTarget,
  NoInventoryDocumentsError,
  NoKnowledgeChunksError,
  StrategistSyncBudgetExceededError,
  UnresolvedDocIdsError,
  runStrategistOrchestrator,
  type StrategistOrchestratorResult,
} from '../../../services/strategistOrchestrator';
import {
  auditActorFromRequest,
  createPurposeBinding,
  recordAuditEvent,
} from '../../../lib/audit/auditEvent';
import { PROCESSING_PROFILE_PRESETS } from '../../../lib/processingProfile';
import {
  DEMO_MAX_PURPOSE_LENGTH,
  DEMO_SAMPLE_SET_ID,
  isDemoMode,
} from '../../../lib/demoMode';
import {
  createContextPackageJob,
  failContextPackageJob,
} from '../../../lib/contextPackageJobs/firestoreAdapter';
import {
  cloudTasksEnqueuer,
  JobQueueNotConfiguredError,
  type ContextPackageJobEnqueuer,
} from '../../../lib/contextPackageJobs/enqueuer';
import type { ContextPackageJobRequest } from '../../../lib/contextPackageJobs/schema';
import { MAX_CONTEXT_PACKAGE_DOC_IDS } from '../../../lib/contextPackageLimits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** route から差し替え可能にしておく（テストで Cloud Tasks 呼び出しを mock する）。 */
const jobEnqueuer: ContextPackageJobEnqueuer = cloudTasksEnqueuer;

/**
 * 実行モード。
 * - `sync`:  常に同期実行。pre-LLM budget 超過は 422 で fail-fast（今回 PR の既存挙動）。
 * - `async`: 常に job 化し 202 を返す。
 * - `auto`:  まず同期を試み、budget 超過時に 422 ではなく job 化へフォールバックする。
 */
type ExecutionMode = 'sync' | 'async' | 'auto';

/**
 * pre-LLM budget 超過（同期 20 秒ゲート）に当たったとき、422 で返すか job 化へ
 * フォールバックするかを決める製品ポリシー。
 *
 * 既定方針: `auto` のときだけ job 化へフォールバックする。`sync` 明示時は従来どおり
 * 422 を返し、呼び出し側に「対象を絞る」か「async を明示する」かを委ねる。
 */
function shouldFallbackToAsync(mode: ExecutionMode): boolean {
  return mode === 'auto';
}

const RequestSchema = z.object({
  purpose: z.string().min(1).max(2000),
  limit: z.number().int().min(1).max(100).default(100),
  docIds: z
    .array(z.string().trim().min(1).max(200))
    .max(MAX_CONTEXT_PACKAGE_DOC_IDS)
    .optional(),
  mode: z.enum(['sync', 'async', 'auto']).default('sync'),
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
  return location;
}

function defaultDataResidencyLocation(): string {
  return process.env.KNOWLEDGE_HUB_DATA_RESIDENCY_LOCATION ?? 'asia-northeast1';
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

  const { purpose, limit, docIds, mode } = parsed.data;
  const demoMode = isDemoMode();
  if (demoMode && purpose.length > DEMO_MAX_PURPOSE_LENGTH) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        details: `公開デモの Purpose は ${DEMO_MAX_PURPOSE_LENGTH} 文字以内にしてください。`,
      },
      { status: 400 },
    );
  }

  const { tenantId, actor } = auditActorFromRequest(request);
  const executionMode: ExecutionMode = demoMode ? 'sync' : mode;
  const jobRequest: ContextPackageJobRequest = {
    purpose,
    limit,
    ...(docIds && docIds.length > 0 ? { docIds } : {}),
    tenantId,
    actor,
  };

  // 明示 async は同期実行を試さず即 job 化する。
  if (executionMode === 'async') {
    return enqueueJobResponse(jobRequest);
  }

  try {
    const result = await runStrategistOrchestrator({
      purpose,
      limit,
      ...(docIds && docIds.length > 0 ? { docIds } : {}),
      ...(demoMode ? { demoSampleSet: DEMO_SAMPLE_SET_ID } : {}),
    });

    try {
      const region = defaultCloudRegion();
      const dataResidencyLocation = defaultDataResidencyLocation();
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
          storage: dataResidencyLocation,
          processing: dataResidencyLocation,
        },
      });
    } catch (auditErr) {
      console.error('[context-package] recordAuditEvent failed', auditErr);
    }

    return NextResponse.json(buildContextPackageResponsePayload(result));
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
      // budget 超過: auto なら 422 で諦めず job 化へフォールバックする。
      if (shouldFallbackToAsync(executionMode)) {
        return enqueueJobResponse(jobRequest, {
          syncBudget: {
            estimatedSeconds: e.estimatedSeconds,
            targetSeconds: e.targetSeconds,
          },
        });
      }
      return NextResponse.json(
        {
          error: 'sync_budget_exceeded',
          details:
            '同期処理の目標時間（20秒）を超える見込みです。対象を絞るか mode:"async" で再実行してください。',
          estimatedSeconds: e.estimatedSeconds,
          targetSeconds: e.targetSeconds,
          budget: e.budget,
          recommendation: {
            hint:
              'docIds フィルタや limit 指定で対象文書を絞ると、同期レスポンスで完了しやすくなります。広い母集団は mode:"async" で job 化できます。',
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

/**
 * job を作成し Cloud Tasks へ enqueue したうえで 202 Accepted を返す。
 * queue 未設定（env 不足）のときは 503 で「同期 or 設定」を促す。
 */
async function enqueueJobResponse(
  jobRequest: ContextPackageJobRequest,
  meta?: { syncBudget?: { estimatedSeconds: number; targetSeconds: number } },
): Promise<NextResponse> {
  const job = await createContextPackageJob(jobRequest);
  try {
    await jobEnqueuer.enqueue(job.jobId);
  } catch (e) {
    // enqueue できなかった job を queued のまま放置しない（worker が拾えず詰まる）。
    const message = e instanceof Error ? e.message : String(e);
    await failContextPackageJob(job.jobId, {
      code: 'enqueue_failed',
      message,
    }).catch((failErr) => {
      console.error('[context-package] failContextPackageJob after enqueue error failed', failErr);
    });

    if (e instanceof JobQueueNotConfiguredError) {
      console.error('[context-package] job queue not configured', e);
      return NextResponse.json(
        {
          error: 'job_queue_unavailable',
          details:
            '非同期 job キューが未設定です。対象を絞って同期実行するか、queue 設定を確認してください。',
          jobId: job.jobId,
        },
        { status: 503 },
      );
    }
    console.error('[context-package] enqueue failed', e);
    return NextResponse.json(
      { error: 'enqueue_failed', jobId: job.jobId },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      jobId: job.jobId,
      status: job.status,
      statusUrl: `/api/context-package/jobs/${job.jobId}`,
      resultUrl: `/api/context-package/jobs/${job.jobId}/result`,
      ...(meta?.syncBudget
        ? {
            reason: 'sync_budget_exceeded',
            details:
              '同期目標時間を超える見込みのため job 化しました。完了後に result を取得してください。',
            syncEstimateSeconds: meta.syncBudget.estimatedSeconds,
            targetSeconds: meta.syncBudget.targetSeconds,
          }
        : {}),
    },
    { status: 202 },
  );
}

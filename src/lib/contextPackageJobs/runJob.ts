/**
 * Context Package job の worker 本体。
 *
 * Cloud Tasks が `POST /api/context-package/jobs/{jobId}/run` を叩くと呼ばれる。
 * `queued → running` を冪等に claim し、orchestrator を同期 20 秒ゲート無しで実行、
 * 結果を job doc に書き戻す。Cloud Tasks のリトライで二重起動されても、claim 失敗で
 * 早期 return するため二重実行されない。
 */
import { modelId } from '../../agents/_shared/genkitClient';
import {
  NoInventoryDocumentsError,
  NoKnowledgeChunksError,
  StrategistSyncBudgetExceededError,
  UnresolvedDocIdsError,
  buildContextPackageResponsePayload,
  contextPackageAuditTarget,
  runStrategistOrchestrator,
  type StrategistOrchestratorResult,
} from '../../services/strategistOrchestrator';
import {
  createPurposeBinding,
  recordAuditEvent,
} from '../audit/auditEvent';
import { PROCESSING_PROFILE_PRESETS } from '../processingProfile';
import {
  claimContextPackageJob,
  completeContextPackageJob,
  failContextPackageJob,
  getContextPackageJob,
} from './firestoreAdapter';
import type {
  ContextPackageJobError,
  ContextPackageJobProgress,
  ContextPackageJobRequest,
} from './schema';

/** Firestore doc 上限 1,048,576 bytes に対する result inline 保存の安全閾値。 */
const MAX_INLINE_RESULT_BYTES = 900_000;

export type RunContextPackageJobOutcome =
  | { outcome: 'claimed_and_run'; status: 'succeeded' | 'failed' }
  | { outcome: 'skipped'; reason: 'not_found' | 'not_queued' };

function progressFromResult(
  result: StrategistOrchestratorResult,
): ContextPackageJobProgress {
  return {
    sourceDocumentsReviewed: result.sourceDocumentsReviewed,
    safeChunks: result.included.length,
    budgetDroppedChunks: result.budget.droppedChunks,
  };
}

/**
 * 既知の「業務エラー」（入力起因で決定論的に失敗するもの）を job error code へ落とす。
 * これらは retry しても結果が変わらないため `failed` 記録 + 200（retry 不要）にする。
 * 該当しない（= 予期せぬ / transient な可能性がある）エラーは `null` を返し、呼び出し側
 * で lease を残したまま rethrow → worker route 500 → lease 期限切れ後に再 claim させる。
 */
function toBusinessJobError(error: unknown): ContextPackageJobError | null {
  if (error instanceof UnresolvedDocIdsError) {
    const code =
      error.unknownDocIds.length > 0 ? 'unknown_doc_ids' : 'non_terminal_doc_ids';
    return {
      code,
      message: error.message,
      details: {
        unknownDocIds: error.unknownDocIds,
        nonTerminalDocIds: error.nonTerminalDocIds,
      },
    };
  }
  if (error instanceof NoInventoryDocumentsError) {
    return { code: 'no_inventory_documents', message: error.message };
  }
  if (error instanceof NoKnowledgeChunksError) {
    return { code: 'no_knowledge_chunks', message: error.message };
  }
  if (error instanceof StrategistSyncBudgetExceededError) {
    // 非同期経路では enforceSyncBudget:false なので本来到達しない決定論的エラー。
    return { code: 'upstream_failure', message: error.message };
  }
  return null;
}

async function recordExportAudit(
  request: ContextPackageJobRequest,
  result: StrategistOrchestratorResult,
): Promise<void> {
  const region = process.env.GOOGLE_CLOUD_LOCATION ?? 'asia-northeast1';
  await recordAuditEvent({
    tenantId: request.tenantId,
    actor: request.actor,
    action: 'document.export',
    target: contextPackageAuditTarget(result),
    result: 'success',
    processingProfile: PROCESSING_PROFILE_PRESETS['cloud-managed'],
    purposeBinding: createPurposeBinding({
      purpose: result.purpose,
      tenantId: request.tenantId,
      timestamp: result.generatedAt,
    }),
    inferenceDestination: { vendor: 'vertex', region, model: modelId },
    dataResidency: { storage: region, processing: region },
  });
}

export async function runContextPackageJob(
  jobId: string,
): Promise<RunContextPackageJobOutcome> {
  const claimed = await claimContextPackageJob(jobId);
  if (!claimed) {
    const existing = await getContextPackageJob(jobId);
    return {
      outcome: 'skipped',
      reason: existing ? 'not_queued' : 'not_found',
    };
  }

  // claim 後に request を読む（claim は status だけを見て昇格する）。
  const job = await getContextPackageJob(jobId);
  if (!job) {
    // claim 直後に消えるのは想定外。failed として記録を試みる。
    await failContextPackageJob(jobId, {
      code: 'upstream_failure',
      message: 'Job document disappeared after claim.',
    }).catch(() => undefined);
    return { outcome: 'claimed_and_run', status: 'failed' };
  }

  const { request } = job;

  try {
    const result = await runStrategistOrchestrator({
      purpose: request.purpose,
      limit: request.limit,
      ...(request.docIds && request.docIds.length > 0
        ? { docIds: request.docIds }
        : {}),
      // 非同期 job は 20 秒ゲートを外す（pre-LLM budget は引き続き効く）。
      enforceSyncBudget: false,
    });

    const payload = buildContextPackageResponsePayload(result);
    const progress = progressFromResult(result);

    const byteSize = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    if (byteSize > MAX_INLINE_RESULT_BYTES) {
      await failContextPackageJob(
        jobId,
        {
          code: 'result_too_large',
          message:
            `生成結果が Firestore の保存上限を超えました（${byteSize} bytes）。` +
            'docIds や limit で対象を絞って再実行してください。',
          details: { byteSize, maxBytes: MAX_INLINE_RESULT_BYTES },
        },
        progress,
      );
      return { outcome: 'claimed_and_run', status: 'failed' };
    }

    await completeContextPackageJob(jobId, payload, progress);

    try {
      await recordExportAudit(request, result);
    } catch (auditErr) {
      console.error('[context-package-job] recordAuditEvent failed', auditErr);
    }

    return { outcome: 'claimed_and_run', status: 'succeeded' };
  } catch (error) {
    const businessError = toBusinessJobError(error);
    if (businessError) {
      // 入力起因の決定論的失敗: failed に記録し 200 で返す（retry は無意味）。
      console.error('[context-package-job] business failure', { jobId, businessError });
      await failContextPackageJob(jobId, businessError).catch((failErr) => {
        console.error('[context-package-job] failContextPackageJob failed', failErr);
      });
      return { outcome: 'claimed_and_run', status: 'failed' };
    }
    // 予期せぬ / transient な可能性: lease を残したまま rethrow し、worker route で 500。
    // lease 期限切れ後に別 Cloud Tasks 試行が再 claim する。
    console.error('[context-package-job] unexpected failure (will retry after lease)', {
      jobId,
      error,
    });
    throw error;
  }
}

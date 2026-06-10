/**
 * Context Package job の worker 本体。
 *
 * Cloud Tasks が `POST /api/context-package/jobs/{jobId}/run` を叩くと呼ばれる。
 * `queued → running` を冪等に claim し、orchestrator を同期 20 秒ゲート無しで実行、
 * 結果を job doc に書き戻す。各 claim で attempt token を発行し、complete / fail は
 * token 一致時のみ受理する（stale worker による上書きを防ぐ）。
 */
import { location, modelId } from '../../agents/_shared/genkitClient';
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
  completeContextPackageJobWithResultRef,
  failContextPackageJob,
  getContextPackageJob,
  releaseContextPackageJobLease,
  updateContextPackageJobProgress,
} from './firestoreAdapter';
import {
  deleteContextPackageJobResult,
  writeContextPackageJobResult,
} from './resultStorage';
import type {
  ContextPackageJobError,
  ContextPackageJobProgress,
  ContextPackageJobRequest,
} from './schema';

/** Firestore doc 上限 1,048,576 bytes に対する result inline 保存の安全閾値。 */
const MAX_INLINE_RESULT_BYTES = 900_000;

export type RunContextPackageJobOutcome =
  | { outcome: 'claimed_and_run'; status: 'succeeded' | 'failed' }
  | {
      outcome: 'skipped';
      reason: 'not_found' | 'terminal' | 'active_lease';
    };

async function outcomeAfterRejectedAttemptWrite(
  jobId: string,
): Promise<RunContextPackageJobOutcome> {
  const existing = await getContextPackageJob(jobId);
  if (!existing) {
    return { outcome: 'skipped', reason: 'not_found' };
  }
  if (
    existing.status === 'succeeded' ||
    existing.status === 'failed' ||
    existing.status === 'cancelled'
  ) {
    return { outcome: 'skipped', reason: 'terminal' };
  }
  return { outcome: 'skipped', reason: 'active_lease' };
}

/**
 * 業務失敗を永続化してから ack する。stale attempt や Firestore 障害で書き込めない
 * 場合は成功扱いにせず、Cloud Tasks の再配信または最新 attempt の完了に委ねる。
 */
async function persistBusinessFailure(
  jobId: string,
  attemptToken: string,
  error: ContextPackageJobError,
  progress?: ContextPackageJobProgress,
): Promise<RunContextPackageJobOutcome> {
  try {
    const failed = await failContextPackageJob(jobId, error, {
      attemptToken,
      ...(progress ? { progress } : {}),
    });
    if (failed) {
      return { outcome: 'claimed_and_run', status: 'failed' };
    }
    return outcomeAfterRejectedAttemptWrite(jobId);
  } catch (writeError) {
    await releaseContextPackageJobLease(jobId, attemptToken).catch(
      (releaseError) => {
        console.error(
          '[context-package-job] release lease after failure write error failed',
          { jobId, releaseError },
        );
      },
    );
    throw writeError;
  }
}

function progressFromResult(
  result: StrategistOrchestratorResult,
): ContextPackageJobProgress {
  const progress: ContextPackageJobProgress = {
    sourceDocumentsReviewed: result.sourceDocumentsReviewed,
    safeChunks: result.included.length,
    budgetDroppedChunks: result.budget.droppedChunks,
  };
  if (result.coverage?.mode === 'full' && result.coverage.batches !== undefined) {
    progress.batchesTotal = result.coverage.batches;
    progress.batchesCompleted = result.coverage.batches;
  }
  return progress;
}

/**
 * 既知の「業務エラー」（入力起因で決定論的に失敗するもの）を job error code へ落とす。
 * これらは retry しても結果が変わらないため `failed` 記録 + 200（retry 不要）にする。
 * 該当しない（= 予期せぬ / transient な可能性がある）エラーは `null` を返し、呼び出し側
 * で lease を解放したうえで rethrow → worker route 500 → Cloud Tasks 再配信。
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
  const region = location;
  const dataResidencyLocation =
    process.env.KNOWLEDGE_HUB_DATA_RESIDENCY_LOCATION ?? 'asia-northeast1';
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
    dataResidency: {
      storage: dataResidencyLocation,
      processing: dataResidencyLocation,
    },
  });
}

export async function runContextPackageJob(
  jobId: string,
): Promise<RunContextPackageJobOutcome> {
  const claim = await claimContextPackageJob(jobId);
  if (!claim.claimed) {
    return { outcome: 'skipped', reason: claim.reason };
  }

  const { attemptToken } = claim;

  // claim 後に request を読む（claim は status / lease / token だけを見て昇格する）。
  const job = await getContextPackageJob(jobId);
  if (!job) {
    return { outcome: 'skipped', reason: 'not_found' };
  }

  const { request } = job;

  try {
    const result = await runStrategistOrchestrator(
      {
        purpose: request.purpose,
        limit: request.limit,
        ...(request.docIds && request.docIds.length > 0
          ? { docIds: request.docIds }
          : {}),
        enforceSyncBudget: false,
        coverage: 'full',
      },
      {
        onBatchProgress: async ({ batchesCompleted, batchesTotal }) => {
          await updateContextPackageJobProgress(jobId, attemptToken, {
            batchesCompleted,
            batchesTotal,
          });
        },
      },
    );

    const payload = buildContextPackageResponsePayload(result);
    const progress = progressFromResult(result);

    const byteSize = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    let completed: boolean;
    let offloadedResultRef:
      | Awaited<ReturnType<typeof writeContextPackageJobResult>>
      | undefined;
    if (byteSize > MAX_INLINE_RESULT_BYTES) {
      offloadedResultRef = await writeContextPackageJobResult({
        tenantId: request.tenantId,
        jobId,
        payload,
      });
      completed = await completeContextPackageJobWithResultRef(
        jobId,
        attemptToken,
        offloadedResultRef,
        progress,
      );
    } else {
      completed = await completeContextPackageJob(
        jobId,
        attemptToken,
        payload,
        progress,
      );
    }
    if (!completed) {
      console.error(
        '[context-package-job] complete rejected (stale attempt or status drift)',
        { jobId },
      );
      if (offloadedResultRef) {
        await deleteContextPackageJobResult(offloadedResultRef).catch((deleteError) => {
          console.error(
            '[context-package-job] cleanup offloaded result after rejected complete failed',
            { jobId, deleteError },
          );
        });
      }
      return { outcome: 'skipped', reason: 'active_lease' };
    }

    try {
      await recordExportAudit(request, result);
    } catch (auditErr) {
      console.error('[context-package-job] recordAuditEvent failed', auditErr);
    }

    return { outcome: 'claimed_and_run', status: 'succeeded' };
  } catch (error) {
    const businessError = toBusinessJobError(error);
    if (businessError) {
      console.error('[context-package-job] business failure', { jobId, businessError });
      return persistBusinessFailure(jobId, attemptToken, businessError);
    }

    // transient: lease を解放して再配信が再 claim できるようにする（15 分待たない）。
    // attemptToken は維持されるため、この試行の遅延 complete/fail は stale として拒否される。
    await releaseContextPackageJobLease(jobId, attemptToken).catch((releaseErr) => {
      console.error('[context-package-job] releaseContextPackageJobLease failed', {
        jobId,
        releaseErr,
      });
    });
    console.error(
      '[context-package-job] unexpected failure (lease released for retry)',
      { jobId, error },
    );
    throw error;
  }
}

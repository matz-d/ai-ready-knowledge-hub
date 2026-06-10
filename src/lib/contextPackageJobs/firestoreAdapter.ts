/**
 * `context_package_jobs` の Firestore 読み書き。
 *
 * 状態遷移は一方向（`queued → running → succeeded | failed`）。worker が Cloud Tasks
 * のリトライで二重に走っても壊れないよう、`running` への昇格はトランザクション内で
 * claim 条件を満たすときだけ許可する。各 claim で `attemptToken` を発行し、
 * complete / fail は `running` + token 一致時のみ受理する（stale worker 拒否）。
 */
import { randomUUID } from 'node:crypto';
import type { Timestamp } from '@google-cloud/firestore';
import { FieldValue, getFirestoreClient } from '../firestore';
import {
  CONTEXT_PACKAGE_JOB_LEASE_MS,
  CONTEXT_PACKAGE_JOB_MAX_RETRY_DURATION_MS,
  CONTEXT_PACKAGE_JOB_TERMINAL_RETENTION_DAYS,
  CONTEXT_PACKAGE_JOBS_COLLECTION,
  type ClaimContextPackageJobResult,
  type ContextPackageJob,
  type ContextPackageJobError,
  type ContextPackageJobProgress,
  type ContextPackageJobRequest,
  type ContextPackageJobResultRef,
  type ContextPackageJobResult,
  type ContextPackageJobStatus,
} from './schema';

type TimestampLike = Timestamp | Date | string | null | undefined;
const DAY_MS = 24 * 60 * 60 * 1000;

function timestampToIso(value: TimestampLike): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return value.toDate().toISOString();
}

function jobCollection() {
  return getFirestoreClient().collection(CONTEXT_PACKAGE_JOBS_COLLECTION);
}

function jobRef(jobId: string) {
  return jobCollection().doc(jobId);
}

function terminalExpiresAt(nowMs: number = Date.now()): Date {
  return new Date(
    nowMs + CONTEXT_PACKAGE_JOB_TERMINAL_RETENTION_DAYS * DAY_MS,
  );
}

/** queued job を新規作成し、生成された jobId を含むスナップショットを返す。 */
export async function createContextPackageJob(
  request: ContextPackageJobRequest
): Promise<ContextPackageJob> {
  const jobId = randomUUID();
  const ref = jobRef(jobId);
  const now = new Date().toISOString();

  await ref.set({
    jobId,
    status: 'queued' satisfies ContextPackageJobStatus,
    request,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    jobId,
    status: 'queued',
    request,
    // serverTimestamp は書き込み後に確定するため、呼び出し元へは近似 ISO を返す。
    createdAt: now,
    updatedAt: now,
  };
}

function serializeJob(
  jobId: string,
  data: FirebaseFirestore.DocumentData
): ContextPackageJob {
  return {
    jobId,
    status: data.status as ContextPackageJobStatus,
    request: data.request as ContextPackageJobRequest,
    progress: data.progress as ContextPackageJobProgress | undefined,
    result: data.result as ContextPackageJobResult | undefined,
    resultRef: data.resultRef as ContextPackageJobResultRef | undefined,
    error: data.error as ContextPackageJobError | undefined,
    createdAt: timestampToIso(data.createdAt) ?? '',
    updatedAt: timestampToIso(data.updatedAt) ?? '',
    startedAt: timestampToIso(data.startedAt),
    finishedAt: timestampToIso(data.finishedAt),
    leaseExpiresAt: timestampToIso(data.leaseExpiresAt),
    expiresAt: timestampToIso(data.expiresAt),
  };
}

/** lease が無い / 期限切れなら true（= 再 claim 可能）。 */
export function isContextPackageJobLeaseExpired(
  value: TimestampLike,
): boolean {
  const iso = timestampToIso(value);
  if (!iso) return true;
  return Date.parse(iso) <= Date.now();
}

function isStaleRunningJobForRecovery(
  data: FirebaseFirestore.DocumentData,
  nowMs: number,
): boolean {
  if (data.status !== 'running') return false;
  if (!isContextPackageJobLeaseExpired(data.leaseExpiresAt)) return false;
  const updatedAtIso = timestampToIso(data.updatedAt);
  if (!updatedAtIso) return false;
  const updatedAtMs = Date.parse(updatedAtIso);
  if (!Number.isFinite(updatedAtMs)) return false;
  return nowMs - updatedAtMs >= CONTEXT_PACKAGE_JOB_MAX_RETRY_DURATION_MS;
}

export async function getContextPackageJob(
  jobId: string
): Promise<ContextPackageJob | null> {
  const snapshot = await jobRef(jobId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  if (!data) return null;
  return serializeJob(snapshot.id, data);
}

/**
 * job を `running` へ claim する。claim できるのは次のいずれか:
 * - status が `queued`（通常の初回 claim）
 * - status が `running` だが **lease 期限切れ**（前 worker がクラッシュ / 例外解放）
 *
 * succeeded / failed / cancelled、または lease 有効な running は claim 不可。
 * claim ごとに新しい `attemptToken` を発行する。初回（queued）のみ `startedAt` を設定。
 */
export async function claimContextPackageJob(
  jobId: string,
): Promise<ClaimContextPackageJobResult> {
  const db = getFirestoreClient();
  const ref = jobRef(jobId);

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      return { claimed: false, reason: 'not_found' } as const;
    }
    const data = snapshot.data();
    if (!data) {
      return { claimed: false, reason: 'not_found' } as const;
    }

    const status = data.status as ContextPackageJobStatus;
    if (
      status === 'succeeded' ||
      status === 'failed' ||
      status === 'cancelled'
    ) {
      return { claimed: false, reason: 'terminal' } as const;
    }

    const claimable =
      status === 'queued' ||
      (status === 'running' &&
        isContextPackageJobLeaseExpired(data.leaseExpiresAt));

    if (!claimable) {
      return { claimed: false, reason: 'active_lease' } as const;
    }

    const attemptToken = randomUUID();
    const leaseExpiresAt = new Date(
      Date.now() + CONTEXT_PACKAGE_JOB_LEASE_MS,
    ).toISOString();

    tx.update(ref, {
      status: 'running' satisfies ContextPackageJobStatus,
      leaseExpiresAt,
      attemptToken,
      ...(status === 'queued'
        ? { startedAt: FieldValue.serverTimestamp() }
        : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { claimed: true, attemptToken } as const;
  });
}

/**
 * transient 失敗後に Cloud Tasks の再配信で即再 claim できるよう lease を解放する。
 *
 * 設計意図:
 * - status は `running` のまま維持し、`attemptToken` も変えない（この試行の worker だけが知る token）。
 * - `leaseExpiresAt` のみ削除し、lease 判定を「期限切れ」にする。再 claim は新 token を発行する。
 * - 解放前に落ちた worker の complete / fail は古い token のため transaction で拒否される。
 * - 解放せず 15 分待つより、明示解放 + 503 リトライの方が復旧が早い。
 */
export async function releaseContextPackageJobLease(
  jobId: string,
  attemptToken: string,
): Promise<boolean> {
  const db = getFirestoreClient();
  const ref = jobRef(jobId);

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return false;
    const data = snapshot.data();
    if (!data) return false;

    if (data.status !== 'running') return false;
    if (data.attemptToken !== attemptToken) return false;

    tx.update(ref, {
      leaseExpiresAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

export async function updateContextPackageJobProgress(
  jobId: string,
  attemptToken: string,
  progress: ContextPackageJobProgress,
): Promise<boolean> {
  const db = getFirestoreClient();
  const ref = jobRef(jobId);

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return false;
    const data = snapshot.data();
    if (!data) return false;

    if (data.status !== 'running') return false;
    if (data.attemptToken !== attemptToken) return false;

    tx.update(ref, {
      progress,
      leaseExpiresAt: new Date(
        Date.now() + CONTEXT_PACKAGE_JOB_LEASE_MS,
      ).toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

export async function completeContextPackageJob(
  jobId: string,
  attemptToken: string,
  result: ContextPackageJobResult,
  progress?: ContextPackageJobProgress,
): Promise<boolean> {
  const db = getFirestoreClient();
  const ref = jobRef(jobId);

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return false;
    const data = snapshot.data();
    if (!data) return false;

    if (data.status !== 'running') return false;
    if (data.attemptToken !== attemptToken) return false;

    tx.update(ref, {
      status: 'succeeded' satisfies ContextPackageJobStatus,
      result,
      resultRef: FieldValue.delete(),
      ...(progress ? { progress } : {}),
      attemptToken: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete(),
      expiresAt: terminalExpiresAt(),
      finishedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

export async function completeContextPackageJobWithResultRef(
  jobId: string,
  attemptToken: string,
  resultRef: ContextPackageJobResultRef,
  progress?: ContextPackageJobProgress,
): Promise<boolean> {
  const db = getFirestoreClient();
  const ref = jobRef(jobId);

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return false;
    const data = snapshot.data();
    if (!data) return false;

    if (data.status !== 'running') return false;
    if (data.attemptToken !== attemptToken) return false;

    tx.update(ref, {
      status: 'succeeded' satisfies ContextPackageJobStatus,
      result: FieldValue.delete(),
      resultRef,
      ...(progress ? { progress } : {}),
      attemptToken: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete(),
      expiresAt: terminalExpiresAt(),
      finishedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

export type FailContextPackageJobOptions = {
  progress?: ContextPackageJobProgress;
  /**
   * worker 経路では必須（`running` + token 一致のみ failed へ遷移）。
   * enqueue 失敗など `queued` のまま abort するときは省略可。
   */
  attemptToken?: string;
};

export async function failContextPackageJob(
  jobId: string,
  error: ContextPackageJobError,
  options?: FailContextPackageJobOptions,
): Promise<boolean> {
  const db = getFirestoreClient();
  const ref = jobRef(jobId);
  const { progress, attemptToken } = options ?? {};

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return false;
    const data = snapshot.data();
    if (!data) return false;

    const status = data.status as ContextPackageJobStatus;

    if (attemptToken !== undefined) {
      if (status !== 'running') return false;
      if (data.attemptToken !== attemptToken) return false;
    } else if (status !== 'queued') {
      return false;
    }

    tx.update(ref, {
      status: 'failed' satisfies ContextPackageJobStatus,
      error,
      ...(progress ? { progress } : {}),
      attemptToken: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete(),
      expiresAt: terminalExpiresAt(),
      finishedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

export type CancelContextPackageJobResult =
  | { cancelled: true; previousStatus: 'queued' | 'running' }
  | { cancelled: false; reason: 'not_found' | 'already_terminal' };

/**
 * user / admin からの中止要求。
 * `running` の場合も `cancelled` へ遷移するが、in-flight worker は即停止できない。
 * 後続の complete / fail は status 条件で拒否され、結果は破棄される。
 */
export async function cancelContextPackageJob(
  jobId: string,
): Promise<CancelContextPackageJobResult> {
  const db = getFirestoreClient();
  const ref = jobRef(jobId);

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      return { cancelled: false, reason: 'not_found' } as const;
    }
    const data = snapshot.data();
    if (!data) {
      return { cancelled: false, reason: 'not_found' } as const;
    }

    const status = data.status as ContextPackageJobStatus;
    if (
      status === 'succeeded' ||
      status === 'failed' ||
      status === 'cancelled'
    ) {
      return { cancelled: false, reason: 'already_terminal' } as const;
    }

    tx.update(ref, {
      status: 'cancelled' satisfies ContextPackageJobStatus,
      error: {
        code: 'upstream_failure',
        message: 'job was cancelled by request',
        details: { reason: 'cancelled_by_request' },
      } satisfies ContextPackageJobError,
      attemptToken: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete(),
      expiresAt: terminalExpiresAt(),
      finishedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { cancelled: true, previousStatus: status } as const;
  });
}

export type RecoverStaleRunningContextPackageJobResult =
  | { recovered: true }
  | {
      recovered: false;
      reason: 'not_found' | 'not_running' | 'lease_active' | 'within_retry_window';
    };

/**
 * retry 窓を超えて残留した stale running を `failed` へ回収する。
 * 条件は transaction 内で再評価し、reclaim と競合しても誤終端しない。
 */
export async function recoverStaleRunningContextPackageJob(
  jobId: string,
  nowMs: number = Date.now(),
): Promise<RecoverStaleRunningContextPackageJobResult> {
  const db = getFirestoreClient();
  const ref = jobRef(jobId);

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      return { recovered: false, reason: 'not_found' } as const;
    }
    const data = snapshot.data();
    if (!data) {
      return { recovered: false, reason: 'not_found' } as const;
    }
    if (data.status !== 'running') {
      return { recovered: false, reason: 'not_running' } as const;
    }
    if (!isContextPackageJobLeaseExpired(data.leaseExpiresAt)) {
      return { recovered: false, reason: 'lease_active' } as const;
    }
    if (!isStaleRunningJobForRecovery(data, nowMs)) {
      return { recovered: false, reason: 'within_retry_window' } as const;
    }

    tx.update(ref, {
      status: 'failed' satisfies ContextPackageJobStatus,
      error: {
        code: 'upstream_failure',
        message:
          'Cloud Tasks retry window elapsed after lease expiry. Recovered as terminal failed.',
        details: {
          reason: 'stale_running_recovery',
          leaseMs: CONTEXT_PACKAGE_JOB_LEASE_MS,
          queueMaxRetryDurationMs: CONTEXT_PACKAGE_JOB_MAX_RETRY_DURATION_MS,
        },
      } satisfies ContextPackageJobError,
      attemptToken: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete(),
      expiresAt: terminalExpiresAt(nowMs),
      finishedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { recovered: true } as const;
  });
}

export type RecoverStaleRunningContextPackageJobsBatchResult = {
  scanned: number;
  recovered: number;
  skipped: {
    notFound: number;
    notRunning: number;
    leaseActive: number;
    withinRetryWindow: number;
  };
};

/**
 * running job を走査して stale 回収を行う（Cloud Scheduler からの定期実行想定）。
 */
export async function recoverStaleRunningContextPackageJobs(options?: {
  limit?: number;
  nowMs?: number;
}): Promise<RecoverStaleRunningContextPackageJobsBatchResult> {
  const limit = options?.limit ?? 200;
  const nowMs = options?.nowMs ?? Date.now();

  const snapshot = await jobCollection().where('status', '==', 'running').limit(limit).get();
  const summary: RecoverStaleRunningContextPackageJobsBatchResult = {
    scanned: snapshot.docs.length,
    recovered: 0,
    skipped: {
      notFound: 0,
      notRunning: 0,
      leaseActive: 0,
      withinRetryWindow: 0,
    },
  };

  for (const doc of snapshot.docs) {
    const recovered = await recoverStaleRunningContextPackageJob(doc.id, nowMs);
    if (recovered.recovered) {
      summary.recovered += 1;
      continue;
    }
    if (recovered.reason === 'not_found') summary.skipped.notFound += 1;
    else if (recovered.reason === 'not_running') summary.skipped.notRunning += 1;
    else if (recovered.reason === 'lease_active') summary.skipped.leaseActive += 1;
    else summary.skipped.withinRetryWindow += 1;
  }
  return summary;
}

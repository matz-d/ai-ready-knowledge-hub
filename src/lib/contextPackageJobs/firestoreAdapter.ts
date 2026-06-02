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
  CONTEXT_PACKAGE_JOBS_COLLECTION,
  type ClaimContextPackageJobResult,
  type ContextPackageJob,
  type ContextPackageJobError,
  type ContextPackageJobProgress,
  type ContextPackageJobRequest,
  type ContextPackageJobResult,
  type ContextPackageJobStatus,
} from './schema';

type TimestampLike = Timestamp | Date | string | null | undefined;

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
    error: data.error as ContextPackageJobError | undefined,
    createdAt: timestampToIso(data.createdAt) ?? '',
    updatedAt: timestampToIso(data.updatedAt) ?? '',
    startedAt: timestampToIso(data.startedAt),
    finishedAt: timestampToIso(data.finishedAt),
    leaseExpiresAt: timestampToIso(data.leaseExpiresAt),
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
      ...(progress ? { progress } : {}),
      attemptToken: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete(),
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
      finishedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

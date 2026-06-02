/**
 * `context_package_jobs` の Firestore 読み書き。
 *
 * 状態遷移は一方向（`queued → running → succeeded | failed`）。worker が Cloud Tasks
 * のリトライで二重に走っても壊れないよう、`running` への昇格はトランザクション内で
 * 「現状 `queued` のときだけ」許可する。
 */
import { randomUUID } from 'node:crypto';
import type { Timestamp } from '@google-cloud/firestore';
import { FieldValue, getFirestoreClient } from '../firestore';
import {
  CONTEXT_PACKAGE_JOB_LEASE_MS,
  CONTEXT_PACKAGE_JOBS_COLLECTION,
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

/** queued job を新規作成し、生成された jobId を含むスナップショットを返す。 */
export async function createContextPackageJob(
  request: ContextPackageJobRequest
): Promise<ContextPackageJob> {
  const jobId = randomUUID();
  const ref = jobCollection().doc(jobId);
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
function leaseExpired(value: TimestampLike): boolean {
  const iso = timestampToIso(value);
  if (!iso) return true;
  return Date.parse(iso) <= Date.now();
}

export async function getContextPackageJob(
  jobId: string
): Promise<ContextPackageJob | null> {
  const snapshot = await jobCollection().doc(jobId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  if (!data) return null;
  return serializeJob(snapshot.id, data);
}

/**
 * job を `running` へ claim する。claim できるのは次のいずれか:
 * - status が `queued`（通常の初回 claim）
 * - status が `running` だが **lease 期限切れ**（前 worker がクラッシュ / 例外解放漏れ）
 *
 * succeeded / failed / cancelled、または lease 有効な running は `false`（冪等ガード +
 * 二重実行防止）。claim 時に `now + lease` を `leaseExpiresAt` に書き込む。
 * 初回（queued）のときだけ `startedAt` を設定し、再 claim では維持する。
 */
export async function claimContextPackageJob(jobId: string): Promise<boolean> {
  const db = getFirestoreClient();
  const ref = db.collection(CONTEXT_PACKAGE_JOBS_COLLECTION).doc(jobId);

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return false;
    const data = snapshot.data();
    if (!data) return false;

    const status = data.status as ContextPackageJobStatus;
    const claimable =
      status === 'queued' ||
      (status === 'running' && leaseExpired(data.leaseExpiresAt));
    if (!claimable) return false;

    const leaseExpiresAt = new Date(
      Date.now() + CONTEXT_PACKAGE_JOB_LEASE_MS,
    ).toISOString();
    tx.update(ref, {
      status: 'running' satisfies ContextPackageJobStatus,
      leaseExpiresAt,
      ...(status === 'queued' ? { startedAt: FieldValue.serverTimestamp() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

export async function completeContextPackageJob(
  jobId: string,
  result: ContextPackageJobResult,
  progress?: ContextPackageJobProgress
): Promise<void> {
  await jobCollection()
    .doc(jobId)
    .update({
      status: 'succeeded' satisfies ContextPackageJobStatus,
      result,
      ...(progress ? { progress } : {}),
      // terminal なので lease は不要。残すと再 claim 判定がノイズになるため消す。
      leaseExpiresAt: FieldValue.delete(),
      finishedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

export async function failContextPackageJob(
  jobId: string,
  error: ContextPackageJobError,
  progress?: ContextPackageJobProgress
): Promise<void> {
  await jobCollection()
    .doc(jobId)
    .update({
      status: 'failed' satisfies ContextPackageJobStatus,
      error,
      ...(progress ? { progress } : {}),
      leaseExpiresAt: FieldValue.delete(),
      finishedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Fake Firestore（serverTimestamp / doc set/get/update / runTransaction だけ支える）──
type RawData = Record<string, unknown>;

const SERVER_TS = { methodName: 'FieldValue.serverTimestamp' as const };
const DELETE_SENTINEL = { methodName: 'FieldValue.delete' as const };

function sentinelName(v: unknown): string | undefined {
  return v && typeof v === 'object'
    ? (v as { methodName?: string }).methodName
    : undefined;
}

/** serverTimestamp は ISO へ、delete はキー削除マーカーへ正規化する。 */
function applyWrite(target: RawData, data: RawData): void {
  for (const [k, v] of Object.entries(data)) {
    const name = sentinelName(v);
    if (name === 'FieldValue.serverTimestamp') {
      target[k] = new Date().toISOString();
    } else if (name === 'FieldValue.delete') {
      delete target[k];
    } else {
      target[k] = v;
    }
  }
}

class FakeDocRef {
  constructor(
    private readonly store: Map<string, RawData>,
    readonly path: string,
    readonly id: string,
  ) {}

  async get() {
    const data = this.store.get(this.path);
    return { id: this.id, exists: data !== undefined, data: () => data };
  }

  async set(data: RawData): Promise<void> {
    const next: RawData = {};
    applyWrite(next, data);
    this.store.set(this.path, next);
  }

  async update(data: RawData): Promise<void> {
    const existing = this.store.get(this.path);
    if (!existing) throw new Error(`not found: ${this.path}`);
    const next = { ...existing };
    applyWrite(next, data);
    this.store.set(this.path, next);
  }
}

class FakeCollection {
  constructor(
    private readonly store: Map<string, RawData>,
    private readonly name: string,
  ) {}
  doc(id: string): FakeDocRef {
    return new FakeDocRef(this.store, `${this.name}/${id}`, id);
  }
}

class FakeTransaction {
  async get(ref: FakeDocRef) {
    return ref.get();
  }
  update(ref: FakeDocRef, data: RawData): void {
    void ref.update(data);
  }
}

class FakeFirestore {
  readonly store = new Map<string, RawData>();
  collection(name: string): FakeCollection {
    return new FakeCollection(this.store, name);
  }
  async runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    return fn(new FakeTransaction());
  }
}

const fakeDb = new FakeFirestore();

vi.mock('../../firestore', () => ({
  getFirestoreClient: () => fakeDb,
  FieldValue: {
    serverTimestamp: () => SERVER_TS,
    delete: () => DELETE_SENTINEL,
  },
}));

import {
  claimContextPackageJob,
  completeContextPackageJob,
  createContextPackageJob,
  failContextPackageJob,
  getContextPackageJob,
  releaseContextPackageJobLease,
} from '../firestoreAdapter';
import { CONTEXT_PACKAGE_JOBS_COLLECTION } from '../schema';

const REQUEST = {
  purpose: 'テスト用途',
  limit: 50,
  tenantId: 'tenant-1',
  actor: { userId: 'u1', ipAddress: '', userAgent: '' },
};

function jobPath(jobId: string) {
  return `${CONTEXT_PACKAGE_JOBS_COLLECTION}/${jobId}`;
}

function storedAttemptToken(jobId: string): string {
  const token = fakeDb.store.get(jobPath(jobId))?.attemptToken;
  expect(typeof token).toBe('string');
  return token as string;
}

beforeEach(() => {
  fakeDb.store.clear();
});

describe('contextPackageJobs firestoreAdapter', () => {
  it('createContextPackageJob は queued doc を作り jobId を返す', async () => {
    const job = await createContextPackageJob(REQUEST);

    expect(job.status).toBe('queued');
    expect(job.jobId).toBeTruthy();
    const stored = fakeDb.store.get(jobPath(job.jobId));
    expect(stored?.status).toBe('queued');
    expect(stored?.request).toEqual(REQUEST);
  });

  it('claim は queued を running に昇格し attemptToken を発行する', async () => {
    const job = await createContextPackageJob(REQUEST);

    const first = await claimContextPackageJob(job.jobId);

    expect(first).toEqual({
      claimed: true,
      attemptToken: expect.any(String),
    });
    const stored = await getContextPackageJob(job.jobId);
    expect(stored?.status).toBe('running');
    expect(stored?.leaseExpiresAt).toBeTruthy();
    expect(fakeDb.store.get(jobPath(job.jobId))?.attemptToken).toBeTruthy();
  });

  it('claim は lease 有効な running を active_lease で拒否する（重複配信）', async () => {
    const job = await createContextPackageJob(REQUEST);
    const first = await claimContextPackageJob(job.jobId);
    expect(first.claimed).toBe(true);

    const second = await claimContextPackageJob(job.jobId);

    expect(second).toEqual({ claimed: false, reason: 'active_lease' });
  });

  it('存在しない jobId の claim は not_found', async () => {
    expect(await claimContextPackageJob('missing')).toEqual({
      claimed: false,
      reason: 'not_found',
    });
  });

  it('lease 期限切れの running は再 claim でき新しい attemptToken が付く', async () => {
    const job = await createContextPackageJob(REQUEST);
    const first = await claimContextPackageJob(job.jobId);
    expect(first.claimed).toBe(true);
    if (!first.claimed) throw new Error('expected claim');
    const token1 = first.attemptToken;

    const path = jobPath(job.jobId);
    const stored = fakeDb.store.get(path)!;
    fakeDb.store.set(path, {
      ...stored,
      leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const second = await claimContextPackageJob(job.jobId);
    expect(second.claimed).toBe(true);
    if (!second.claimed) throw new Error('expected reclaim');
    expect(second.attemptToken).not.toBe(token1);
  });

  it('terminal 状態の claim は terminal を返す', async () => {
    const job = await createContextPackageJob(REQUEST);
    const claim = await claimContextPackageJob(job.jobId);
    expect(claim.claimed).toBe(true);
    if (!claim.claimed) throw new Error('expected claim');

    await completeContextPackageJob(job.jobId, claim.attemptToken, { ok: true });

    expect(await claimContextPackageJob(job.jobId)).toEqual({
      claimed: false,
      reason: 'terminal',
    });
  });

  it('complete は succeeded + result を書き込み attemptToken を消す', async () => {
    const job = await createContextPackageJob(REQUEST);
    await claimContextPackageJob(job.jobId);
    const token = storedAttemptToken(job.jobId);

    const ok = await completeContextPackageJob(
      job.jobId,
      token,
      { markdown: '# ok', counts: { included: 1 } },
      { sourceDocumentsReviewed: 3, safeChunks: 1, budgetDroppedChunks: 0 },
    );

    expect(ok).toBe(true);
    const stored = await getContextPackageJob(job.jobId);
    expect(stored?.status).toBe('succeeded');
    expect(stored?.result).toMatchObject({ markdown: '# ok' });
    expect(stored?.leaseExpiresAt).toBeUndefined();
    expect(fakeDb.store.get(jobPath(job.jobId))?.attemptToken).toBeUndefined();
  });

  it('fail は running + attemptToken 一致時のみ failed にする', async () => {
    const job = await createContextPackageJob(REQUEST);
    await claimContextPackageJob(job.jobId);
    const token = storedAttemptToken(job.jobId);

    const ok = await failContextPackageJob(
      job.jobId,
      { code: 'no_inventory_documents', message: 'none' },
      { attemptToken: token },
    );

    expect(ok).toBe(true);
    const stored = await getContextPackageJob(job.jobId);
    expect(stored?.status).toBe('failed');
    expect(stored?.error).toEqual({
      code: 'no_inventory_documents',
      message: 'none',
    });
  });

  it('queued のまま fail できる（enqueue 失敗経路、attemptToken 不要）', async () => {
    const job = await createContextPackageJob(REQUEST);

    const ok = await failContextPackageJob(job.jobId, {
      code: 'enqueue_failed',
      message: 'queue down',
    });

    expect(ok).toBe(true);
    expect((await getContextPackageJob(job.jobId))?.status).toBe('failed');
  });

  it('stale worker の complete は新 worker の running を上書きしない', async () => {
    const job = await createContextPackageJob(REQUEST);
    const first = await claimContextPackageJob(job.jobId);
    expect(first.claimed).toBe(true);
    if (!first.claimed) throw new Error('expected claim');
    const staleToken = first.attemptToken;

    const path = jobPath(job.jobId);
    fakeDb.store.set(path, {
      ...fakeDb.store.get(path)!,
      leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const second = await claimContextPackageJob(job.jobId);
    expect(second.claimed).toBe(true);
    if (!second.claimed) throw new Error('expected reclaim');

    const staleComplete = await completeContextPackageJob(job.jobId, staleToken, {
      markdown: 'stale',
    });
    expect(staleComplete).toBe(false);

    const freshComplete = await completeContextPackageJob(
      job.jobId,
      second.attemptToken,
      { markdown: 'fresh' },
    );
    expect(freshComplete).toBe(true);

    const stored = await getContextPackageJob(job.jobId);
    expect(stored?.result).toMatchObject({ markdown: 'fresh' });
  });

  it('stale worker の fail は新 worker の状態を上書きしない', async () => {
    const job = await createContextPackageJob(REQUEST);
    const first = await claimContextPackageJob(job.jobId);
    expect(first.claimed).toBe(true);
    if (!first.claimed) throw new Error('expected claim');

    const path = jobPath(job.jobId);
    fakeDb.store.set(path, {
      ...fakeDb.store.get(path)!,
      leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const second = await claimContextPackageJob(job.jobId);
    expect(second.claimed).toBe(true);
    if (!second.claimed) throw new Error('expected reclaim');

    const staleFail = await failContextPackageJob(
      job.jobId,
      { code: 'upstream_failure', message: 'stale' },
      { attemptToken: first.attemptToken },
    );
    expect(staleFail).toBe(false);

    const freshFail = await failContextPackageJob(
      job.jobId,
      { code: 'no_inventory_documents', message: 'fresh' },
      { attemptToken: second.attemptToken },
    );
    expect(freshFail).toBe(true);

    expect((await getContextPackageJob(job.jobId))?.error?.message).toBe('fresh');
  });

  it('transient 失敗 → lease 解放 → 再 claim → 最終成功', async () => {
    const job = await createContextPackageJob(REQUEST);
    const first = await claimContextPackageJob(job.jobId);
    expect(first.claimed).toBe(true);
    if (!first.claimed) throw new Error('expected claim');

    const released = await releaseContextPackageJobLease(
      job.jobId,
      first.attemptToken,
    );
    expect(released).toBe(true);

    const redelivery = await claimContextPackageJob(job.jobId);
    expect(redelivery.claimed).toBe(true);
    if (!redelivery.claimed) throw new Error('expected reclaim');

    const ok = await completeContextPackageJob(
      job.jobId,
      redelivery.attemptToken,
      { markdown: '# recovered' },
    );
    expect(ok).toBe(true);
    expect((await getContextPackageJob(job.jobId))?.status).toBe('succeeded');
  });

  it('release は attemptToken 不一致では lease を解放しない', async () => {
    const job = await createContextPackageJob(REQUEST);
    await claimContextPackageJob(job.jobId);

    expect(
      await releaseContextPackageJobLease(job.jobId, 'wrong-token'),
    ).toBe(false);
    expect(fakeDb.store.get(jobPath(job.jobId))?.leaseExpiresAt).toBeTruthy();
  });

  it('getContextPackageJob は存在しない場合 null', async () => {
    expect(await getContextPackageJob('nope')).toBeNull();
  });
});

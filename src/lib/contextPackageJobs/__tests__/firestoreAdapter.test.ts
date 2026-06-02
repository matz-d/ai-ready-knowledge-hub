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
} from '../firestoreAdapter';
import { CONTEXT_PACKAGE_JOBS_COLLECTION } from '../schema';

const REQUEST = {
  purpose: 'テスト用途',
  limit: 50,
  tenantId: 'tenant-1',
  actor: { userId: 'u1', ipAddress: '', userAgent: '' },
};

beforeEach(() => {
  fakeDb.store.clear();
});

describe('contextPackageJobs firestoreAdapter', () => {
  it('createContextPackageJob は queued doc を作り jobId を返す', async () => {
    const job = await createContextPackageJob(REQUEST);

    expect(job.status).toBe('queued');
    expect(job.jobId).toBeTruthy();
    const stored = fakeDb.store.get(
      `${CONTEXT_PACKAGE_JOBS_COLLECTION}/${job.jobId}`,
    );
    expect(stored?.status).toBe('queued');
    expect(stored?.request).toEqual(REQUEST);
  });

  it('claim は queued を一度だけ running に昇格し、二度目は false（冪等ガード）', async () => {
    const job = await createContextPackageJob(REQUEST);

    const first = await claimContextPackageJob(job.jobId);
    const second = await claimContextPackageJob(job.jobId);

    expect(first).toBe(true);
    expect(second).toBe(false);
    const stored = await getContextPackageJob(job.jobId);
    expect(stored?.status).toBe('running');
  });

  it('存在しない jobId の claim は false', async () => {
    expect(await claimContextPackageJob('missing')).toBe(false);
  });

  it('lease 期限切れの running は再 claim できる（worker クラッシュ復旧）', async () => {
    const job = await createContextPackageJob(REQUEST);
    await claimContextPackageJob(job.jobId);

    // lease を過去に書き換えて「持ち主が落ちた」状態を再現する。
    const path = `${CONTEXT_PACKAGE_JOBS_COLLECTION}/${job.jobId}`;
    const stored = fakeDb.store.get(path)!;
    fakeDb.store.set(path, {
      ...stored,
      leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    expect(await claimContextPackageJob(job.jobId)).toBe(true);
  });

  it('lease 有効な running は再 claim を拒否する', async () => {
    const job = await createContextPackageJob(REQUEST);
    await claimContextPackageJob(job.jobId);

    // 直後（lease 有効）の再 claim は false。
    expect(await claimContextPackageJob(job.jobId)).toBe(false);
  });

  it('complete は succeeded + result + progress を書き込む', async () => {
    const job = await createContextPackageJob(REQUEST);
    await claimContextPackageJob(job.jobId);

    await completeContextPackageJob(
      job.jobId,
      { markdown: '# ok', counts: { included: 1 } },
      { sourceDocumentsReviewed: 3, safeChunks: 1, budgetDroppedChunks: 0 },
    );

    const stored = await getContextPackageJob(job.jobId);
    expect(stored?.status).toBe('succeeded');
    expect(stored?.result).toMatchObject({ markdown: '# ok' });
    expect(stored?.progress).toEqual({
      sourceDocumentsReviewed: 3,
      safeChunks: 1,
      budgetDroppedChunks: 0,
    });
    // terminal なので lease は消える。
    expect(stored?.leaseExpiresAt).toBeUndefined();
  });

  it('fail は failed + error を書き込む', async () => {
    const job = await createContextPackageJob(REQUEST);
    await claimContextPackageJob(job.jobId);

    await failContextPackageJob(job.jobId, {
      code: 'no_inventory_documents',
      message: 'none',
    });

    const stored = await getContextPackageJob(job.jobId);
    expect(stored?.status).toBe('failed');
    expect(stored?.error).toEqual({
      code: 'no_inventory_documents',
      message: 'none',
    });
  });

  it('getContextPackageJob は存在しない場合 null', async () => {
    expect(await getContextPackageJob('nope')).toBeNull();
  });
});

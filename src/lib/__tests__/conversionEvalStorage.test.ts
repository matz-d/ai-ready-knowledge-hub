import type { Firestore } from '@google-cloud/firestore';
import { describe, expect, it } from 'vitest';
import {
  createEmptyConversionEvalResult,
  type ConversionEvalResult,
} from '../../eval/conversion/conversionEvalResult';
import { DOCUMENTS_COLLECTION } from '../documents';
import {
  buildConversionEvalId,
  CONVERSION_EVAL_COLLECTION,
  ConversionEvalAlreadyExistsError,
  ConversionEvalParentDocumentNotFoundError,
  createConversionEvalStorage,
  parseConversionEvalId,
} from '../conversionEvalStorage';

// ─── Minimal in-memory Firestore simulator ───────────────────────────────────
//
// Simulates only the Firestore surface used by conversionEvalStorage:
//   runTransaction(t => t.get(ref) / t.set(ref, data, { merge }) / t.update(ref, data))
//   collection(c).where(f, op, v).orderBy(f, dir).limit(n).get()

type RawData = Record<string, unknown>;
type SetOptions = { merge?: boolean };

function normalizeFirestoreWriteValue(value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    'methodName' in value &&
    (value as { methodName: string }).methodName === 'FieldValue.serverTimestamp'
  ) {
    return new Date().toISOString();
  }
  return value;
}

function normalizeFirestorePayload(data: RawData): RawData {
  const normalized: RawData = {};
  for (const [key, value] of Object.entries(data)) {
    normalized[key] = normalizeFirestoreWriteValue(value);
  }
  return normalized;
}

class FakeDocumentReference {
  constructor(
    private readonly store: Map<string, RawData>,
    readonly path: string,
    readonly id: string
  ) {}

  async get(): Promise<{
    id: string;
    exists: boolean;
    data: () => RawData | undefined;
  }> {
    const data = this.store.get(this.path);
    return {
      id: this.id,
      exists: data !== undefined,
      data: () => data,
    };
  }

  async set(data: RawData, options?: SetOptions): Promise<void> {
    const normalized = normalizeFirestorePayload(data);
    if (options?.merge) {
      const existing = this.store.get(this.path) ?? {};
      this.store.set(this.path, { ...existing, ...normalized });
      return;
    }
    this.store.set(this.path, normalized);
  }

  async update(data: RawData): Promise<void> {
    const existing = this.store.get(this.path);
    if (!existing) {
      throw new Error(`Document not found: ${this.path}`);
    }
    this.store.set(this.path, {
      ...existing,
      ...normalizeFirestorePayload(data),
    });
  }
}

class FakeQuery {
  private filters: Array<{ field: string; value: unknown }> = [];
  private orderField: string | null = null;
  private orderDirection: 'asc' | 'desc' = 'asc';
  private maxResults: number | null = null;

  constructor(
    private readonly store: Map<string, RawData>,
    private readonly collPath: string
  ) {}

  where(field: string, _op: '==', value: unknown): this {
    this.filters.push({ field, value });
    return this;
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.orderField = field;
    this.orderDirection = direction;
    return this;
  }

  limit(count: number): this {
    this.maxResults = count;
    return this;
  }

  async get(): Promise<{
    empty: boolean;
    docs: Array<{ id: string; data: () => RawData }>;
  }> {
    const prefix = `${this.collPath}/`;
    const matches: Array<{ id: string; path: string; data: RawData }> = [];

    for (const [path, data] of this.store.entries()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest.includes('/')) continue;

      const passes = this.filters.every(({ field, value }) => data[field] === value);
      if (!passes) continue;

      matches.push({ id: rest, path, data });
    }

    if (this.orderField) {
      const field = this.orderField;
      const direction = this.orderDirection;
      matches.sort((left, right) => {
        const leftValue = left.data[field];
        const rightValue = right.data[field];
        const leftTime = toSortableTime(leftValue);
        const rightTime = toSortableTime(rightValue);
        if (leftTime === rightTime) return 0;
        return direction === 'desc'
          ? rightTime - leftTime
          : leftTime - rightTime;
      });
    }

    const limited =
      this.maxResults == null ? matches : matches.slice(0, this.maxResults);

    return {
      empty: limited.length === 0,
      docs: limited.map((entry) => ({
        id: entry.id,
        data: () => entry.data,
      })),
    };
  }
}

function toSortableTime(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return 0;
}

class FakeCollectionReference {
  constructor(
    private readonly store: Map<string, RawData>,
    private readonly collPath: string
  ) {}

  doc(id: string): FakeDocumentReference {
    return new FakeDocumentReference(this.store, `${this.collPath}/${id}`, id);
  }

  where(field: string, op: '==', value: unknown): FakeQuery {
    return new FakeQuery(this.store, this.collPath).where(field, op, value);
  }
}

class FakeTransaction {
  async get(ref: FakeDocumentReference): ReturnType<FakeDocumentReference['get']> {
    return ref.get();
  }

  set(ref: FakeDocumentReference, data: RawData, options?: SetOptions): void {
    void ref.set(data, options);
  }

  update(ref: FakeDocumentReference, data: RawData): void {
    void ref.update(data);
  }
}

class FakeFirestore {
  private readonly store = new Map<string, RawData>();

  _seed(path: string, data: RawData): void {
    this.store.set(path, data);
  }

  _dump(): Map<string, RawData> {
    return new Map(this.store);
  }

  collection(name: string): FakeCollectionReference {
    return new FakeCollectionReference(this.store, name);
  }

  async runTransaction<T>(
    updateFunction: (transaction: FakeTransaction) => Promise<T>
  ): Promise<T> {
    return updateFunction(new FakeTransaction());
  }
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

const DOC_ID = 'doc-eval-001';
const REVISION_A = 'rev-a';
const REVISION_B = 'rev-b';

function seedParentDoc(fakeDb: FakeFirestore): void {
  fakeDb._seed(`${DOCUMENTS_COLLECTION}/${DOC_ID}`, {
    id: DOC_ID,
    schemaVersion: 2,
    status: 'curated',
  });
}

function sampleHealthResult(): ConversionEvalResult {
  return createEmptyConversionEvalResult();
}

// ─── Pure helpers ───────────────────────────────────────────────────────────────

describe('conversionEvalStorage helpers', () => {
  it('builds evalId as docId:revisionId', () => {
    expect(buildConversionEvalId(DOC_ID, REVISION_A)).toBe(`${DOC_ID}:${REVISION_A}`);
  });

  it('parses evalId on the last colon', () => {
    expect(parseConversionEvalId('doc:with:colons:rev-1')).toEqual({
      docId: 'doc:with:colons',
      revisionId: 'rev-1',
    });
  });
});

// ─── Adapter (fake Firestore) ───────────────────────────────────────────────────

describe('conversionEvalStorage (fake Firestore)', () => {
  it('append → getLatestForDocument round-trips health eval', async () => {
    const fakeDb = new FakeFirestore();
    seedParentDoc(fakeDb);
    const adapter = createConversionEvalStorage(fakeDb as unknown as Firestore);

    const written = await adapter.appendConversionEval({
      docId: DOC_ID,
      revisionId: REVISION_A,
      stage: 'health',
      result: sampleHealthResult(),
    });

    expect(written.evalId).toBe(buildConversionEvalId(DOC_ID, REVISION_A));
    expect(written.docId).toBe(DOC_ID);
    expect(written.revisionId).toBe(REVISION_A);
    expect(written.stage).toBe('health');
    expect(written.result.overall.status).toBe('pass');

    const latest = await adapter.getLatestForDocument(DOC_ID);
    expect(latest?.evalId).toBe(written.evalId);
    expect(latest?.result).toEqual(written.result);
  });

  it('sets documents/{docId}.latestConversionEvalId reverse pointer', async () => {
    const fakeDb = new FakeFirestore();
    seedParentDoc(fakeDb);
    const adapter = createConversionEvalStorage(fakeDb as unknown as Firestore);
    const evalId = buildConversionEvalId(DOC_ID, REVISION_A);

    await adapter.appendConversionEval({
      docId: DOC_ID,
      revisionId: REVISION_A,
      stage: 'health',
      result: sampleHealthResult(),
    });

    const parent = fakeDb._dump().get(`${DOCUMENTS_COLLECTION}/${DOC_ID}`);
    expect(parent?.latestConversionEvalId).toBe(evalId);
  });

  it('rejects append when eval doc already exists (append-only)', async () => {
    const fakeDb = new FakeFirestore();
    seedParentDoc(fakeDb);
    const adapter = createConversionEvalStorage(fakeDb as unknown as Firestore);
    const input = {
      docId: DOC_ID,
      revisionId: REVISION_A,
      stage: 'health' as const,
      result: sampleHealthResult(),
    };

    await adapter.appendConversionEval(input);
    await expect(adapter.appendConversionEval(input)).rejects.toBeInstanceOf(
      ConversionEvalAlreadyExistsError
    );

    const dump = fakeDb._dump();
    const evalPaths = [...dump.keys()].filter((path) =>
      path.startsWith(`${CONVERSION_EVAL_COLLECTION}/`)
    );
    expect(evalPaths).toHaveLength(1);
  });

  it('throws when parent document is missing', async () => {
    const fakeDb = new FakeFirestore();
    const adapter = createConversionEvalStorage(fakeDb as unknown as Firestore);

    await expect(
      adapter.appendConversionEval({
        docId: 'missing-doc',
        revisionId: REVISION_A,
        stage: 'health',
        result: sampleHealthResult(),
      })
    ).rejects.toBeInstanceOf(ConversionEvalParentDocumentNotFoundError);
  });

  it('getLatestForDocument returns the newest createdAt row', async () => {
    const fakeDb = new FakeFirestore();
    seedParentDoc(fakeDb);
    const adapter = createConversionEvalStorage(fakeDb as unknown as Firestore);

    await adapter.appendConversionEval({
      docId: DOC_ID,
      revisionId: REVISION_A,
      stage: 'health',
      result: sampleHealthResult(),
    });

    const evalIdB = buildConversionEvalId(DOC_ID, REVISION_B);
    fakeDb._seed(`${CONVERSION_EVAL_COLLECTION}/${evalIdB}`, {
      evalId: evalIdB,
      docId: DOC_ID,
      revisionId: REVISION_B,
      stage: 'health',
      result: sampleHealthResult(),
      createdAt: '2026-05-20T12:00:00.000Z',
    });
    fakeDb._seed(`${CONVERSION_EVAL_COLLECTION}/${buildConversionEvalId(DOC_ID, REVISION_A)}`, {
      evalId: buildConversionEvalId(DOC_ID, REVISION_A),
      docId: DOC_ID,
      revisionId: REVISION_A,
      stage: 'health',
      result: sampleHealthResult(),
      createdAt: '2026-05-19T12:00:00.000Z',
    });

    const latest = await adapter.getLatestForDocument(DOC_ID);
    expect(latest?.revisionId).toBe(REVISION_B);
  });

  it('getLatestForDocument returns null when no eval exists', async () => {
    const fakeDb = new FakeFirestore();
    const adapter = createConversionEvalStorage(fakeDb as unknown as Firestore);

    await expect(adapter.getLatestForDocument('doc-empty')).resolves.toBeNull();
  });
});

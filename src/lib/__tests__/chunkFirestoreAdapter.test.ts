import type { Firestore } from '@google-cloud/firestore';
import { describe, expect, it } from 'vitest';
import {
  adaptStoredChunkToKnowledgeChunk,
  createChunkFirestoreAdapter,
  type ChunkReplaceContext,
} from '../chunkFirestoreAdapter';
import {
  computeChunkSourceHash,
  KnowledgeChunkSchema,
  type KnowledgeChunk,
  type KnowledgeChunkLocator,
} from '../knowledgeChunkSchema';

// ─── Minimal in-memory Firestore simulator ───────────────────────────────────
//
// Simulates only the Firestore surface used by chunkFirestoreAdapter:
//   collection(c).doc(id).collection(c).get()   → list subcollection
//   collection(c).doc(id).get()                 → fetch single document
//   batch().delete(ref) / batch().set(ref, data) / batch().commit()

type RawData = Record<string, unknown>;
type BatchOp =
  | { type: 'set'; path: string; data: RawData }
  | { type: 'delete'; path: string };

class FakeDocumentReference {
  constructor(
    private readonly store: Map<string, RawData>,
    readonly path: string,
    readonly id: string
  ) {}

  collection(name: string): FakeCollectionReference {
    return new FakeCollectionReference(this.store, `${this.path}/${name}`);
  }

  async get(): Promise<{
    id: string;
    data: () => RawData | undefined;
    exists: boolean;
  }> {
    const data = this.store.get(this.path);
    return { id: this.id, data: () => data, exists: data !== undefined };
  }
}

class FakeCollectionReference {
  constructor(
    private readonly store: Map<string, RawData>,
    private readonly collPath: string
  ) {}

  doc(id: string): FakeDocumentReference {
    return new FakeDocumentReference(
      this.store,
      `${this.collPath}/${id}`,
      id
    );
  }

  async get(): Promise<{
    docs: Array<{
      id: string;
      data: () => RawData;
      ref: FakeDocumentReference;
    }>;
  }> {
    const prefix = `${this.collPath}/`;
    const docs: Array<{
      id: string;
      data: () => RawData;
      ref: FakeDocumentReference;
    }> = [];

    for (const [path, data] of this.store.entries()) {
      if (path.startsWith(prefix)) {
        const rest = path.slice(prefix.length);
        // Only direct children — no further slashes (not deeply nested docs)
        if (!rest.includes('/')) {
          const ref = new FakeDocumentReference(this.store, path, rest);
          docs.push({ id: rest, data: () => data, ref });
        }
      }
    }

    return { docs };
  }
}

class FakeBatch {
  private ops: BatchOp[] = [];
  constructor(private readonly store: Map<string, RawData>) {}

  set(ref: FakeDocumentReference, data: RawData): this {
    this.ops.push({ type: 'set', path: ref.path, data });
    return this;
  }

  delete(ref: FakeDocumentReference): this {
    this.ops.push({ type: 'delete', path: ref.path });
    return this;
  }

  async commit(): Promise<void> {
    for (const op of this.ops) {
      if (op.type === 'set') {
        this.store.set(op.path, op.data);
      } else {
        this.store.delete(op.path);
      }
    }
    this.ops = [];
  }
}

class FakeFirestore {
  private readonly store = new Map<string, RawData>();

  /** Seed a document at an arbitrary Firestore path (slash-separated). */
  _seed(path: string, data: RawData): void {
    this.store.set(path, data);
  }

  /** Returns a snapshot of the current store keyed by path — for assertions. */
  _dump(): Map<string, RawData> {
    return new Map(this.store);
  }

  collection(name: string): FakeCollectionReference {
    return new FakeCollectionReference(this.store, name);
  }

  batch(): FakeBatch {
    return new FakeBatch(this.store);
  }
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

const EXTRACTOR_INPUT = 'name,email\nAlice,alice@example.com';
const DOC_ID = 'doc-test-001';

function seedParentDoc(fakeDb: FakeFirestore, status = 'curated'): void {
  fakeDb._seed(`documents/${DOC_ID}`, {
    id: DOC_ID,
    status,
    schemaVersion: 1,
  });
}

function locatorFor(
  sheetName = 'Sheet1',
  range = 'A1:B10'
): KnowledgeChunkLocator {
  return { kind: 'spreadsheet', sheetName, range };
}

function makeChunk(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  const locator = overrides.locator ?? locatorFor();
  const sourceHash = computeChunkSourceHash({
    extractorInput: EXTRACTOR_INPUT,
    locator,
  });
  const base = {
    id: 'chunk-1',
    docId: DOC_ID,
    schemaVersion: 1 as const,
    sourceType: 'spreadsheet' as const,
    structureType: 'cellRange' as const,
    locator,
    text: 'Alice,alice@example.com',
    sensitivity: 'Internal' as const,
    aiUsePolicy: 'direct' as const,
    sensitivitySource: 'inherited' as const,
    extractionProvider: 'csv' as const,
    sourceHash,
    createdAt: '2026-05-11T00:00:00.000Z',
    updatedAt: '2026-05-11T00:00:00.000Z',
  };
  return KnowledgeChunkSchema.parse({ ...base, ...overrides });
}

// ─── adaptStoredChunkToKnowledgeChunk (pure unit) ────────────────────────────

describe('adaptStoredChunkToKnowledgeChunk', () => {
  it('normalises Firestore Timestamp objects to ISO strings', () => {
    const fakeTimestamp = { toDate: () => new Date('2026-05-11T10:00:00.000Z') };
    const locator = locatorFor();
    const chunk = adaptStoredChunkToKnowledgeChunk('snap-id', {
      id: 'chunk-ts',
      docId: DOC_ID,
      schemaVersion: 1,
      sourceType: 'spreadsheet',
      structureType: 'cellRange',
      locator,
      text: 'value',
      sensitivity: 'Internal',
      aiUsePolicy: 'direct',
      sensitivitySource: 'inherited',
      extractionProvider: 'csv',
      sourceHash: computeChunkSourceHash({ extractorInput: EXTRACTOR_INPUT, locator }),
      createdAt: fakeTimestamp,
      updatedAt: fakeTimestamp,
    });

    expect(chunk.createdAt).toBe('2026-05-11T10:00:00.000Z');
    expect(chunk.updatedAt).toBe('2026-05-11T10:00:00.000Z');
    expect(chunk.id).toBe('chunk-ts');
  });

  it('falls back to snapshot id when the stored document has no id field', () => {
    const locator = locatorFor();
    const chunk = adaptStoredChunkToKnowledgeChunk('snap-fallback', {
      // no `id` field
      docId: DOC_ID,
      schemaVersion: 1,
      sourceType: 'spreadsheet',
      structureType: 'cellRange',
      locator,
      text: 'val',
      sensitivity: 'Internal',
      aiUsePolicy: 'direct',
      sensitivitySource: 'inherited',
      extractionProvider: 'csv',
      sourceHash: computeChunkSourceHash({ extractorInput: EXTRACTOR_INPUT, locator }),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(chunk.id).toBe('snap-fallback');
  });
});

// ─── createChunkFirestoreAdapter (integration with fake Firestore) ───────────

describe('chunkFirestoreAdapter (fake Firestore)', () => {
  it('write → read round-trips the same chunk with ISO timestamps', async () => {
    const fakeDb = new FakeFirestore();
    seedParentDoc(fakeDb);
    const adapter = createChunkFirestoreAdapter(fakeDb as unknown as Firestore);
    const ctx: ChunkReplaceContext = { extractorInput: EXTRACTOR_INPUT };

    const chunk = makeChunk();
    await adapter.replaceChunksForDocument(DOC_ID, [chunk], ctx);

    const result = await adapter.listChunksForDocument(DOC_ID);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'chunk-1',
      docId: DOC_ID,
      sourceType: 'spreadsheet',
      structureType: 'cellRange',
      text: 'Alice,alice@example.com',
      sensitivity: 'Internal',
      aiUsePolicy: 'direct',
      sensitivitySource: 'inherited',
    });
    // Timestamps must survive the Timestamp.fromDate → toDate().toISOString() round-trip
    expect(result[0].createdAt).toBe('2026-05-11T00:00:00.000Z');
    expect(result[0].updatedAt).toBe('2026-05-11T00:00:00.000Z');
  });

  it('write → read preserves all optional fields (maskedText, title, ruleHits)', async () => {
    const fakeDb = new FakeFirestore();
    seedParentDoc(fakeDb);
    const adapter = createChunkFirestoreAdapter(fakeDb as unknown as Firestore);
    const ctx: ChunkReplaceContext = { extractorInput: EXTRACTOR_INPUT };

    const chunk = makeChunk({
      id: 'chunk-full',
      title: '料金表ヘッダ',
      sensitivity: 'Confidential',
      aiUsePolicy: 'requires_masking',
      maskedText: '[MASKED_EMAIL]',
      maskedSpansCount: 1,
      ruleHits: { email: 1 },
      extractionWarnings: ['empty cell at B3'],
    });
    await adapter.replaceChunksForDocument(DOC_ID, [chunk], ctx);

    const [result] = await adapter.listChunksForDocument(DOC_ID);
    expect(result.title).toBe('料金表ヘッダ');
    expect(result.maskedText).toBe('[MASKED_EMAIL]');
    expect(result.maskedSpansCount).toBe(1);
    expect(result.ruleHits).toEqual({ email: 1 });
    expect(result.extractionWarnings).toEqual(['empty cell at B3']);
  });

  it('replaceChunksForDocument (2nd call) deletes old chunks — delete-then-write', async () => {
    const fakeDb = new FakeFirestore();
    seedParentDoc(fakeDb);
    const adapter = createChunkFirestoreAdapter(fakeDb as unknown as Firestore);
    const ctx: ChunkReplaceContext = { extractorInput: EXTRACTOR_INPUT };

    // ── First write: chunk-old ────────────────────────────────────────────────
    const oldLocator = locatorFor('Sheet1', 'A1:C10');
    await adapter.replaceChunksForDocument(
      DOC_ID,
      [makeChunk({ id: 'chunk-old', locator: oldLocator })],
      ctx
    );
    expect(
      (await adapter.listChunksForDocument(DOC_ID)).map((c) => c.id)
    ).toEqual(['chunk-old']);

    // ── Second write: chunk-new replaces chunk-old ────────────────────────────
    const newLocator = locatorFor('Sheet2', 'A1:B5');
    await adapter.replaceChunksForDocument(
      DOC_ID,
      [makeChunk({ id: 'chunk-new', locator: newLocator })],
      ctx
    );

    const result = await adapter.listChunksForDocument(DOC_ID);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('chunk-new');
  });

  it('replaceChunksForDocument with empty array clears all existing chunks', async () => {
    const fakeDb = new FakeFirestore();
    seedParentDoc(fakeDb);
    const adapter = createChunkFirestoreAdapter(fakeDb as unknown as Firestore);
    const ctx: ChunkReplaceContext = { extractorInput: EXTRACTOR_INPUT };

    await adapter.replaceChunksForDocument(DOC_ID, [makeChunk()], ctx);
    expect(await adapter.listChunksForDocument(DOC_ID)).toHaveLength(1);

    await adapter.replaceChunksForDocument(DOC_ID, [], ctx);
    expect(await adapter.listChunksForDocument(DOC_ID)).toHaveLength(0);
  });

  it('listChunksForDocument returns [] for a document with no chunks', async () => {
    const fakeDb = new FakeFirestore();
    const adapter = createChunkFirestoreAdapter(fakeDb as unknown as Firestore);

    const result = await adapter.listChunksForDocument('doc-empty');
    expect(result).toEqual([]);
  });

  it('replaceChunksForDocument throws when the parent document does not exist', async () => {
    const fakeDb = new FakeFirestore();
    const adapter = createChunkFirestoreAdapter(fakeDb as unknown as Firestore);
    const ctx: ChunkReplaceContext = { extractorInput: EXTRACTOR_INPUT };

    await expect(
      adapter.replaceChunksForDocument('missing-doc-id', [makeChunk()], ctx)
    ).rejects.toThrow(
      'Parent document not found: documents/missing-doc-id'
    );
  });

  // ── Invariant violation ────────────────────────────────────────────────────

  it('throws on invariant violation: Restricted sensitivity requires aiUsePolicy blocked', async () => {
    const fakeDb = new FakeFirestore();
    seedParentDoc(fakeDb);
    const adapter = createChunkFirestoreAdapter(fakeDb as unknown as Firestore);
    const ctx: ChunkReplaceContext = { extractorInput: EXTRACTOR_INPUT };

    // Rule 2: sensitivity Restricted → aiUsePolicy must be 'blocked'
    const badChunk: KnowledgeChunk = {
      ...makeChunk(),
      sensitivity: 'Restricted',
      aiUsePolicy: 'direct', // ← violation
    };

    await expect(
      adapter.replaceChunksForDocument(DOC_ID, [badChunk], ctx)
    ).rejects.toThrow(/Knowledge chunk invariant violations/);
  });

  it('throws on invariant violation: requires_masking without maskedText', async () => {
    const fakeDb = new FakeFirestore();
    seedParentDoc(fakeDb);
    const adapter = createChunkFirestoreAdapter(fakeDb as unknown as Firestore);
    const ctx: ChunkReplaceContext = { extractorInput: EXTRACTOR_INPUT };

    // Rule 4: aiUsePolicy requires_masking → maskedText must be present
    const badChunk: KnowledgeChunk = {
      ...makeChunk(),
      sensitivity: 'Internal',
      aiUsePolicy: 'requires_masking',
      maskedText: undefined,
    };

    await expect(
      adapter.replaceChunksForDocument(DOC_ID, [badChunk], ctx)
    ).rejects.toThrow(/Knowledge chunk invariant violations/);
  });

  it('does not write any chunks to Firestore when an invariant violation is detected', async () => {
    const fakeDb = new FakeFirestore();
    seedParentDoc(fakeDb);
    const adapter = createChunkFirestoreAdapter(fakeDb as unknown as Firestore);
    const ctx: ChunkReplaceContext = { extractorInput: EXTRACTOR_INPUT };

    const badChunk: KnowledgeChunk = {
      ...makeChunk({ id: 'chunk-should-not-appear' }),
      sensitivity: 'Restricted',
      aiUsePolicy: 'direct',
    };

    await expect(
      adapter.replaceChunksForDocument(DOC_ID, [badChunk], ctx)
    ).rejects.toThrow();

    // Subcollection must remain empty — no partial writes
    expect(await adapter.listChunksForDocument(DOC_ID)).toHaveLength(0);
  });
});

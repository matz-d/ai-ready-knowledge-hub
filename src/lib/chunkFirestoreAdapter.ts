import { Firestore, Timestamp } from '@google-cloud/firestore';
import type { FirestoreDocumentStatus } from './firestoreSchema';
import { DOCUMENTS_COLLECTION } from './documents';
import { getFirestoreClient } from './firestore';
import {
  assertKnowledgeChunkInvariants,
  KnowledgeChunkSchema,
  type KnowledgeChunk,
  type KnowledgeChunkInvariantContext,
} from './knowledgeChunkSchema';

export const CHUNKS_SUBCOLLECTION = 'chunks';

/** Firestore write batch limit (500 operations per batch). */
const FIRESTORE_BATCH_LIMIT = 500;

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Context required to validate chunk invariants before writing to Firestore.
 * The parent document status is fetched internally; the caller must supply
 * `extractorInput` so that `sourceHash` (invariant rule 6) can be verified.
 */
export type ChunkReplaceContext = {
  /**
   * Raw extractor input string (e.g. raw CSV bytes) used to deterministically
   * compute `chunk.sourceHash`. Required for invariant rule 6.
   */
  extractorInput: string;
};

export interface ChunkFirestoreAdapter {
  /**
   * Returns all chunks in `documents/{docId}/chunks` as `KnowledgeChunk[]`.
   * Malformed Firestore documents are silently skipped.
   */
  listChunksForDocument(docId: string): Promise<KnowledgeChunk[]>;

  /**
   * Atomically replaces all chunks for a document:
   * 1. Asserts invariants on every incoming chunk (throws on any violation).
   * 2. Deletes the entire existing subcollection in batches.
   * 3. Writes all new chunks in batches.
   *
   * Idempotency is guaranteed by full delete + re-write (design §1 rule 7,
   * §2 D-P2-4) — NOT by de-duplication.
   */
  replaceChunksForDocument(
    docId: string,
    chunks: KnowledgeChunk[],
    context: ChunkReplaceContext
  ): Promise<void>;
}

// ─── Timestamp helpers ────────────────────────────────────────────────────────

type TimestampLike =
  | Timestamp
  | { toDate(): Date }
  | Date
  | string
  | null
  | undefined;

function timestampToIso(value: TimestampLike): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return value.toDate().toISOString();
}

// ─── Serialisation ────────────────────────────────────────────────────────────

/**
 * Converts a raw Firestore snapshot (with native Timestamps) into a
 * fully-parsed `KnowledgeChunk`. Returns the Zod-parsed value so that
 * any schema drift is caught at read time.
 */
export function adaptStoredChunkToKnowledgeChunk(
  snapshotId: string,
  data: Record<string, unknown>
): KnowledgeChunk {
  return KnowledgeChunkSchema.parse({
    ...data,
    id: (data['id'] as string | undefined) ?? snapshotId,
    createdAt:
      timestampToIso(data['createdAt'] as TimestampLike) ??
      new Date(0).toISOString(),
    updatedAt:
      timestampToIso(data['updatedAt'] as TimestampLike) ??
      new Date(0).toISOString(),
  });
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a `ChunkFirestoreAdapter` with optional Firestore client injection.
 *
 * - Production: omit `db` → uses the singleton from `getFirestoreClient()`.
 * - Tests: pass a fake/emulator Firestore instance for isolation.
 */
export function createChunkFirestoreAdapter(db?: Firestore): ChunkFirestoreAdapter {
  const firestore = db ?? getFirestoreClient();

  function chunksRef(docId: string) {
    return firestore
      .collection(DOCUMENTS_COLLECTION)
      .doc(docId)
      .collection(CHUNKS_SUBCOLLECTION);
  }

  async function listChunksForDocument(docId: string): Promise<KnowledgeChunk[]> {
    const snapshot = await chunksRef(docId).get();
    return snapshot.docs.flatMap((docSnapshot) => {
      try {
        return [
          adaptStoredChunkToKnowledgeChunk(
            docSnapshot.id,
            docSnapshot.data() as Record<string, unknown>
          ),
        ];
      } catch {
        return [];
      }
    });
  }

  async function replaceChunksForDocument(
    docId: string,
    chunks: KnowledgeChunk[],
    context: ChunkReplaceContext
  ): Promise<void> {
    // ── 1. Build invariant context (fetch parent doc for rule 1) ────────────
    const parentSnapshot = await firestore
      .collection(DOCUMENTS_COLLECTION)
      .doc(docId)
      .get();

    if (!parentSnapshot.exists) {
      throw new Error(
        `Parent document not found: ${DOCUMENTS_COLLECTION}/${docId}`
      );
    }

    const parentData = parentSnapshot.data() as
      | { id?: string; status?: string }
      | undefined;

    const invariantContext: KnowledgeChunkInvariantContext = {
      parentDocument: {
        id: docId,
        status: (parentData?.status ?? 'unknown') as FirestoreDocumentStatus,
      },
      extractorInput: context.extractorInput,
    };

    // ── 2. Assert invariants on ALL chunks before touching Firestore ─────────
    for (const chunk of chunks) {
      assertKnowledgeChunkInvariants(chunk, invariantContext);
    }

    // ── 3. Delete existing subcollection in batches ──────────────────────────
    const existingSnapshot = await chunksRef(docId).get();
    const existingDocs = existingSnapshot.docs;

    for (let i = 0; i < existingDocs.length; i += FIRESTORE_BATCH_LIMIT) {
      const deleteBatch = firestore.batch();
      for (const doc of existingDocs.slice(i, i + FIRESTORE_BATCH_LIMIT)) {
        deleteBatch.delete(doc.ref);
      }
      await deleteBatch.commit();
    }

    // ── 4. Write new chunks in batches ───────────────────────────────────────
    for (let i = 0; i < chunks.length; i += FIRESTORE_BATCH_LIMIT) {
      const writeBatch = firestore.batch();
      for (const chunk of chunks.slice(i, i + FIRESTORE_BATCH_LIMIT)) {
        const docRef = chunksRef(docId).doc(chunk.id);
        writeBatch.set(docRef, {
          ...chunk,
          createdAt: Timestamp.fromDate(new Date(chunk.createdAt)),
          updatedAt: Timestamp.fromDate(new Date(chunk.updatedAt)),
        });
      }
      await writeBatch.commit();
    }
  }

  return { listChunksForDocument, replaceChunksForDocument };
}

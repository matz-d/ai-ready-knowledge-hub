import path from 'node:path';
import { TextDecoder } from 'node:util';
import { Timestamp } from '@google-cloud/firestore';
import type { DocumentReference } from '@google-cloud/firestore';
import { ZodError } from 'zod';
import { maskKnowledgeChunk } from '../agents/masker/maskKnowledgeChunk';
import type { MaskingProvider } from '../agents/masker/maskingSchema';
import { resolveMaskingProvider } from '../agents/masker/provider';
import { DOCUMENTS_COLLECTION } from './documents';
import { extractCsv } from './extractors/csvExtractor';
import { extractXlsx } from './extractors/xlsxExtractor';
import { getFirestoreClient } from './firestore';
import type { FirestoreDocumentStatus } from './firestoreSchema';
import { adaptFirestoreDocumentToInventory } from './inventoryFirestoreAdapter';
import {
  assertKnowledgeChunkInvariants,
  type KnowledgeChunk,
} from './knowledgeChunkSchema';
import { parseFirestoreDocumentSnapshot } from './parseFirestoreDocumentData';
import { readRawObject } from './storage';

const TERMINAL_CHUNK_ELIGIBLE_STATUSES = new Set<FirestoreDocumentStatus>([
  'curated',
  'ai_safe',
  'restricted',
  'blocked',
]);

const CHUNKS_SUBCOLLECTION = 'chunks';
const FIRESTORE_BATCH_LIMIT = 500;

type ExtractorResult = {
  extractorName: 'csv' | 'xlsx';
  extractorInput: string;
  chunks: ReturnType<typeof extractCsv>['chunks'];
};

type StoredChunkSnapshot = {
  id: string;
  data: Record<string, unknown>;
};

export type RegenerateChunksOptions = {
  dryRun?: boolean;
  provider?: MaskingProvider;
};

export type RegenerateChunksResult = {
  extractorName: 'csv' | 'xlsx';
  maskedChunkCount: number;
  maskingProvider: MaskingProvider;
};

async function loadDocument(docId: string): Promise<{
  inventoryDocument: NonNullable<ReturnType<typeof adaptFirestoreDocumentToInventory>>;
  status: FirestoreDocumentStatus;
}> {
  const snapshot = await getFirestoreClient()
    .collection(DOCUMENTS_COLLECTION)
    .doc(docId)
    .get();

  if (!snapshot.exists) {
    throw new Error(`Document not found: ${docId}`);
  }

  let firestoreDocument;
  try {
    firestoreDocument = parseFirestoreDocumentSnapshot(snapshot);
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      throw new Error(
        `Firestore document ${docId} does not match the expected schema. ` +
          `Fix the document or the parser if this is a legitimate shape.`,
        { cause: err }
      );
    }
    throw err;
  }
  if (!TERMINAL_CHUNK_ELIGIBLE_STATUSES.has(firestoreDocument.status)) {
    throw new Error(
      `Document status "${firestoreDocument.status}" is not chunk-eligible. ` +
        'Only curated/ai_safe/restricted/blocked can own chunks.'
    );
  }

  const inventoryDocument = adaptFirestoreDocumentToInventory(
    snapshot.id,
    firestoreDocument
  );
  if (!inventoryDocument) {
    throw new Error(
      `Document ${docId} is terminal but missing effective fields required for chunk generation.`
    );
  }

  return { inventoryDocument, status: firestoreDocument.status };
}

async function extractChunks(args: {
  docId: string;
  fileName: string;
  content: Buffer;
  documentSensitivity: NonNullable<
    ReturnType<typeof adaptFirestoreDocumentToInventory>
  >['sensitivity'];
  documentAiUsePolicy: NonNullable<
    ReturnType<typeof adaptFirestoreDocumentToInventory>
  >['aiUsePolicy'];
}): Promise<ExtractorResult> {
  const extension = path.extname(args.fileName).toLowerCase();

  if (extension === '.csv') {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(args.content);
    } catch (cause: unknown) {
      throw new Error(
        'CSV object bytes are not valid UTF-8. Re-export the file as UTF-8 or remove invalid sequences.',
        { cause }
      );
    }
    const extracted = extractCsv({
      docId: args.docId,
      fileName: args.fileName,
      content: text,
      documentSensitivity: args.documentSensitivity,
      documentAiUsePolicy: args.documentAiUsePolicy,
    });
    return {
      extractorName: 'csv',
      extractorInput: text,
      chunks: extracted.chunks,
    };
  }

  if (extension === '.xlsx') {
    const extracted = await extractXlsx({
      docId: args.docId,
      fileName: args.fileName,
      content: args.content,
      documentSensitivity: args.documentSensitivity,
      documentAiUsePolicy: args.documentAiUsePolicy,
    });
    return {
      extractorName: 'xlsx',
      extractorInput: args.content.toString('base64'),
      chunks: extracted.chunks,
    };
  }

  throw new Error(`Unsupported file extension for chunk regeneration: ${extension}`);
}

function chunksRef(docId: string) {
  return getFirestoreClient()
    .collection(DOCUMENTS_COLLECTION)
    .doc(docId)
    .collection(CHUNKS_SUBCOLLECTION);
}

async function deleteRefsInBatches(refs: DocumentReference[]): Promise<void> {
  const firestore = getFirestoreClient();
  for (let i = 0; i < refs.length; i += FIRESTORE_BATCH_LIMIT) {
    const batch = firestore.batch();
    for (const ref of refs.slice(i, i + FIRESTORE_BATCH_LIMIT)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
}

async function writeMaskedChunksInBatches(
  docId: string,
  chunks: KnowledgeChunk[]
): Promise<void> {
  const firestore = getFirestoreClient();
  const chunkCollection = chunksRef(docId);
  for (let i = 0; i < chunks.length; i += FIRESTORE_BATCH_LIMIT) {
    const batch = firestore.batch();
    for (const chunk of chunks.slice(i, i + FIRESTORE_BATCH_LIMIT)) {
      batch.set(chunkCollection.doc(chunk.id), {
        ...chunk,
        createdAt: Timestamp.fromDate(new Date(chunk.createdAt)),
        updatedAt: Timestamp.fromDate(new Date(chunk.updatedAt)),
      });
    }
    await batch.commit();
  }
}

async function writeStoredChunksInBatches(
  docId: string,
  chunks: StoredChunkSnapshot[]
): Promise<void> {
  const firestore = getFirestoreClient();
  const chunkCollection = chunksRef(docId);
  for (let i = 0; i < chunks.length; i += FIRESTORE_BATCH_LIMIT) {
    const batch = firestore.batch();
    for (const chunk of chunks.slice(i, i + FIRESTORE_BATCH_LIMIT)) {
      batch.set(chunkCollection.doc(chunk.id), chunk.data);
    }
    await batch.commit();
  }
}

async function bestEffortDeleteByChunkIds(
  docId: string,
  chunkIds: string[]
): Promise<void> {
  const firestore = getFirestoreClient();
  const chunkCollection = chunksRef(docId);
  try {
    for (let i = 0; i < chunkIds.length; i += FIRESTORE_BATCH_LIMIT) {
      const batch = firestore.batch();
      for (const chunkId of chunkIds.slice(i, i + FIRESTORE_BATCH_LIMIT)) {
        batch.delete(chunkCollection.doc(chunkId));
      }
      await batch.commit();
    }
  } catch (error) {
    console.error(
      `[chunkRegenerator] best-effort delete failed for docId=${docId}`,
      error
    );
  }
}

async function replaceChunkSubcollection(args: {
  docId: string;
  parentStatus: FirestoreDocumentStatus;
  extractorInput: string;
  chunks: KnowledgeChunk[];
}): Promise<void> {
  for (const chunk of args.chunks) {
    assertKnowledgeChunkInvariants(chunk, {
      parentDocument: { id: args.docId, status: args.parentStatus },
      extractorInput: args.extractorInput,
    });
  }

  const existingSnapshot = await chunksRef(args.docId).get();
  const existingChunkRefs = existingSnapshot.docs.map((doc) => doc.ref);
  const existingChunks: StoredChunkSnapshot[] = existingSnapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() as Record<string, unknown>,
  }));

  try {
    await deleteRefsInBatches(existingChunkRefs);
    await writeMaskedChunksInBatches(args.docId, args.chunks);
  } catch (replaceError) {
    await bestEffortDeleteByChunkIds(
      args.docId,
      args.chunks.map((chunk) => chunk.id)
    );
    try {
      await writeStoredChunksInBatches(args.docId, existingChunks);
    } catch (restoreError) {
      throw new AggregateError(
        [replaceError, restoreError],
        `Chunk replacement failed and recovery failed for docId=${args.docId}`
      );
    }
    throw replaceError;
  }
}

export async function regenerateChunksForDoc(
  docId: string,
  options: RegenerateChunksOptions = {}
): Promise<RegenerateChunksResult> {
  const { inventoryDocument, status } = await loadDocument(docId);
  const storagePath = inventoryDocument.storagePath;
  if (!storagePath) {
    throw new Error(`Document ${docId} has no storagePath.`);
  }

  const rawContent = await readRawObject(storagePath);
  const extracted = await extractChunks({
    docId,
    fileName: inventoryDocument.fileName,
    content: rawContent,
    documentSensitivity: inventoryDocument.sensitivity,
    documentAiUsePolicy: inventoryDocument.aiUsePolicy,
  });

  const maskingProvider = resolveMaskingProvider(options.provider);
  const maskedChunks: KnowledgeChunk[] = [];
  for (const chunk of extracted.chunks) {
    maskedChunks.push(
      await maskKnowledgeChunk(chunk, { provider: maskingProvider })
    );
  }

  if (!options.dryRun) {
    await replaceChunkSubcollection({
      docId,
      parentStatus: status,
      extractorInput: extracted.extractorInput,
      chunks: maskedChunks,
    });
  }

  return {
    extractorName: extracted.extractorName,
    maskedChunkCount: maskedChunks.length,
    maskingProvider,
  };
}

export async function replaceChunksForDoc(docId: string): Promise<void> {
  await regenerateChunksForDoc(docId);
}

export async function clearChunksForDoc(docId: string): Promise<void> {
  const existingSnapshot = await chunksRef(docId).get();
  await deleteRefsInBatches(existingSnapshot.docs.map((doc) => doc.ref));
}

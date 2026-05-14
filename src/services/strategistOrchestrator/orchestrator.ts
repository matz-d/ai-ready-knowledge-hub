import { strategistFlow } from '../../agents/strategist/flow';
import { runSafetyGate } from '../../agents/strategist/safetyGate';
import type {
  ExcludedChunkRef,
  StrategistChunkInput,
  StrategistOutput,
} from '../../agents/strategist/schema';
import { createChunkFirestoreAdapter } from '../../lib/chunkFirestoreAdapter';
import { listInventoryDocumentsFromFirestore } from '../../lib/inventoryFirestoreAdapter';
import type { InventoryDocument } from '../../lib/inventory';
import type { KnowledgeChunk } from '../../lib/knowledgeChunkSchema';
import type {
  SafetyExcludedChunk,
  StrategistChunkSelection,
  StrategistOrchestratorParent,
  StrategistOrchestratorResult,
} from './types';

const DEFAULT_LIMIT = 100;

const TERMINAL_STATUSES = new Set<InventoryDocument['status']>([
  'curated',
  'blocked',
  'ai_safe',
  'restricted',
]);

export class NoInventoryDocumentsError extends Error {
  constructor(message = 'No terminal inventory documents found.') {
    super(message);
    this.name = 'NoInventoryDocumentsError';
  }
}

export class NoKnowledgeChunksError extends Error {
  constructor(message = 'No knowledge chunks found for terminal inventory documents.') {
    super(message);
    this.name = 'NoKnowledgeChunksError';
  }
}

export type RunStrategistOrchestratorInput = {
  purpose: string;
  limit?: number;
};

export type RunStrategistOrchestratorDeps = {
  listInventoryDocuments?: () => Promise<InventoryDocument[]>;
  listChunks?: (documentId: string) => Promise<KnowledgeChunk[]>;
  strategistFlow?: typeof strategistFlow;
  safetyGate?: typeof runSafetyGate;
};

type JoinedChunk = {
  chunk: KnowledgeChunk;
  parent: StrategistOrchestratorParent;
};

export async function runStrategistOrchestrator(
  input: RunStrategistOrchestratorInput,
  deps: RunStrategistOrchestratorDeps = {},
): Promise<StrategistOrchestratorResult> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const listInventoryDocuments =
    deps.listInventoryDocuments ??
    (() => listInventoryDocumentsFromFirestore(limit));
  const listChunks =
    deps.listChunks ??
    createChunkFirestoreAdapter().listChunksForDocument;
  const activeSafetyGate = deps.safetyGate ?? runSafetyGate;
  const activeStrategistFlow = deps.strategistFlow ?? strategistFlow;

  const documents = (await listInventoryDocuments()).filter((doc) =>
    TERMINAL_STATUSES.has(doc.status),
  );
  if (documents.length === 0) {
    throw new NoInventoryDocumentsError();
  }

  const joinedChunks = await collectJoinedChunks(documents, listChunks);
  if (joinedChunks.length === 0) {
    throw new NoKnowledgeChunksError();
  }

  const joinedByKey = new Map(
    joinedChunks.map((row) => [chunkKey(row.chunk.docId, row.chunk.id), row]),
  );
  const safetyResult = activeSafetyGate(
    joinedChunks.map((row) => row.chunk),
    { purpose: input.purpose },
  );
  const safetyExcluded = safetyResult.excluded.map((ref) =>
    safetyExcludedSelectionForRef(ref, joinedByKey),
  );

  if (safetyResult.safe.length === 0) {
    return {
      purpose: input.purpose,
      generatedAt: new Date().toISOString(),
      sourceDocumentsReviewed: documents.length,
      included: [],
      excluded: [],
      safetyExcluded,
      missing: [],
      humanReviewQuestions: [],
    };
  }

  const safeInputs = safetyResult.safe.map((chunk) =>
    strategistInputForSafeChunk(chunk, joinedByKey),
  );
  const strategistResult = await activeStrategistFlow({
    purpose: input.purpose,
    chunkInputs: safeInputs,
    safetyExcludedCount: safetyExcluded.length,
  });
  const safeJoinedByKey = new Map(
    safetyResult.safe.map((chunk) => {
      const key = chunkKey(chunk.docId, chunk.id);
      const joined = joinedByKey.get(key);
      if (!joined) {
        throw new Error(
          `Safety gate returned unknown safe chunk: ${chunk.docId}/${chunk.id}`,
        );
      }
      return [key, joined] as const;
    }),
  );

  return buildResult({
    purpose: input.purpose,
    sourceDocumentsReviewed: documents.length,
    strategistResult,
    safeJoinedByKey,
    safetyExcluded,
  });
}

async function collectJoinedChunks(
  documents: InventoryDocument[],
  listChunks: (documentId: string) => Promise<KnowledgeChunk[]>,
): Promise<JoinedChunk[]> {
  const chunkGroups = await Promise.all(
    documents.map(async (document) => ({
      document,
      chunks: await listChunks(document.id),
    })),
  );

  return chunkGroups.flatMap(({ document, chunks }) =>
    chunks.map((chunk) => ({
      chunk,
      parent: parentMetadataForDocument(document),
    })),
  );
}

function parentMetadataForDocument(
  document: InventoryDocument,
): StrategistOrchestratorParent {
  return {
    id: document.id,
    fileName: document.fileName,
    documentType: document.documentType,
    businessDomain: document.businessDomain,
    freshness: document.freshness,
    isAuthoritativeCandidate: document.isAuthoritativeCandidate,
    updatedAt: document.updatedAt,
  };
}

function strategistParentForDocument(
  parent: StrategistOrchestratorParent,
): StrategistChunkInput['parent'] {
  return {
    docId: parent.id,
    fileName: parent.fileName,
    documentType: parent.documentType,
    businessDomain: parent.businessDomain,
    freshness: parent.freshness,
    isAuthoritativeCandidate: parent.isAuthoritativeCandidate,
    updatedAt: parent.updatedAt ?? new Date(0).toISOString(),
  };
}

function strategistInputForSafeChunk(
  chunk: KnowledgeChunk,
  joinedByKey: Map<string, JoinedChunk>,
): StrategistChunkInput {
  const joined = joinedByKey.get(chunkKey(chunk.docId, chunk.id));
  if (!joined) {
    throw new Error(
      `Safety gate returned unknown safe chunk: ${chunk.docId}/${chunk.id}`,
    );
  }

  return {
    chunk,
    parent: strategistParentForDocument(joined.parent),
  };
}

function buildResult(params: {
  purpose: string;
  sourceDocumentsReviewed: number;
  strategistResult: StrategistOutput;
  safeJoinedByKey: Map<string, JoinedChunk>;
  safetyExcluded: SafetyExcludedChunk[];
}): StrategistOrchestratorResult {
  return {
    purpose: params.purpose,
    generatedAt: new Date().toISOString(),
    sourceDocumentsReviewed: params.sourceDocumentsReviewed,
    included: params.strategistResult.included.map((ref) =>
      includedSelectionForRef(ref, params.safeJoinedByKey),
    ),
    excluded: params.strategistResult.excluded.map((ref) =>
      excludedSelectionForRef(ref, params.safeJoinedByKey),
    ),
    safetyExcluded: params.safetyExcluded,
    missing: params.strategistResult.missing.map((row) => row.topic),
    humanReviewQuestions: params.strategistResult.humanReviewQuestions.map(
      (row) => row.question,
    ),
  };
}

function includedSelectionForRef(
  ref: StrategistOutput['included'][number],
  joinedByKey: Map<string, JoinedChunk>,
): StrategistChunkSelection {
  const joined = requireJoinedChunk(ref.docId, ref.chunkId, joinedByKey);
  return {
    docId: ref.docId,
    chunkId: ref.chunkId,
    rationale: ref.rationale,
    confidence: ref.confidence,
    chunk: joined.chunk,
    parent: joined.parent,
  };
}

function excludedSelectionForRef(
  ref: StrategistOutput['excluded'][number],
  joinedByKey: Map<string, JoinedChunk>,
): StrategistChunkSelection {
  const joined = requireJoinedChunk(ref.docId, ref.chunkId, joinedByKey);
  return {
    docId: ref.docId,
    chunkId: ref.chunkId,
    rationale: ref.rationale,
    reason: ref.reason,
    chunk: joined.chunk,
    parent: joined.parent,
  };
}

function safetyExcludedSelectionForRef(
  ref: ExcludedChunkRef,
  joinedByKey: Map<string, JoinedChunk>,
): SafetyExcludedChunk {
  const joined = requireJoinedChunk(ref.docId, ref.chunkId, joinedByKey);
  return {
    docId: ref.docId,
    chunkId: ref.chunkId,
    rationale: ref.rationale,
    reason: ref.reason,
    chunk: joined.chunk,
    parent: joined.parent,
  };
}

function requireJoinedChunk(
  docId: string,
  chunkId: string,
  joinedByKey: Map<string, JoinedChunk>,
): JoinedChunk {
  const joined = joinedByKey.get(chunkKey(docId, chunkId));
  if (!joined) {
    throw new Error(`Strategist returned unknown chunk ref: ${docId}/${chunkId}`);
  }
  return joined;
}

function chunkKey(docId: string, chunkId: string): string {
  return `${docId}\u0000${chunkId}`;
}

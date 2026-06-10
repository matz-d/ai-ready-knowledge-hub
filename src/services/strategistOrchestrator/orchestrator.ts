import { strategistFlow } from '../../agents/strategist/flow';
import { runSafetyGate } from '../../agents/strategist/safetyGate';
import type {
  ExcludedChunkRef,
  StrategistChunkInput,
  StrategistOutput,
} from '../../agents/strategist/schema';
import { createChunkFirestoreAdapter } from '../../lib/chunkFirestoreAdapter';
import {
  listInventoryDocumentsFromFirestore,
  resolveInventoryDocumentsByIds,
  type ResolvedInventoryDocument,
} from '../../lib/inventoryFirestoreAdapter';
import type { InventoryDocument } from '../../lib/inventory';
import type { KnowledgeChunk } from '../../lib/knowledgeChunkSchema';
import type {
  SafetyExcludedChunk,
  StrategistChunkSelection,
  StrategistCoverageMode,
  StrategistOrchestratorParent,
  StrategistOrchestratorResult,
} from './types';
import { partitionStrategistBatches } from './batching';
import {
  applyStrategistInputBudget,
  DEFAULT_STRATEGIST_INPUT_BUDGET,
  type BudgetCandidate,
  type BudgetDroppedDocument,
  type StrategistInputBudgetConfig,
  type StrategistInputBudgetReport,
} from './budget';
import {
  consolidateMissingAndQuestions,
  type IncludedSummaryForReduce,
  type ConsolidateGapsInput,
  type ConsolidatedStrategistGaps,
} from './consolidateGaps';

const DEFAULT_LIMIT = 100;

function emptyBudgetReport(
  config: StrategistInputBudgetConfig,
): StrategistInputBudgetReport {
  return {
    config,
    totalCandidates: 0,
    keptChunks: 0,
    droppedChunks: 0,
    keptDocuments: 0,
    estimatedPromptChars: 0,
    estimatedPromptTokens: 0,
  };
}

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

/**
 * docIds が strict resolution に失敗したときに投げる（route 側で 400 にマップ）。
 *
 * `unknownDocIds`: Firestore に存在しなかった docId。
 * `nonTerminalDocIds`: 存在するが terminal status でない（または破損して使えない）docId
 *   と、その時点の status。監査説明のため呼び出し側へ status をそのまま渡す。
 */
export class UnresolvedDocIdsError extends Error {
  readonly unknownDocIds: string[];
  readonly nonTerminalDocIds: { docId: string; status: string }[];

  constructor(params: {
    unknownDocIds: string[];
    nonTerminalDocIds: { docId: string; status: string }[];
  }) {
    super('One or more requested docIds could not be resolved to terminal inventory documents.');
    this.name = 'UnresolvedDocIdsError';
    this.unknownDocIds = params.unknownDocIds;
    this.nonTerminalDocIds = params.nonTerminalDocIds;
  }
}

export const STRATEGIST_SYNC_TARGET_SECONDS = 20;
const STRATEGIST_SYNC_ESTIMATE_BASE_SECONDS = 2.5;
const STRATEGIST_SYNC_ESTIMATE_PER_CHUNK_SECONDS = 0.1;
const STRATEGIST_SYNC_ESTIMATE_PER_TOKEN_SECONDS = 0.00035;

export class StrategistFullCoverageRequiresAsyncError extends Error {
  constructor(
    message = 'coverage:"full" requires enforceSyncBudget:false (async job path only).',
  ) {
    super(message);
    this.name = 'StrategistFullCoverageRequiresAsyncError';
  }
}

export class StrategistFullCoverageLeaseLostError extends Error {
  constructor(message = 'full coverage job lease was lost during batch progress update.') {
    super(message);
    this.name = 'StrategistFullCoverageLeaseLostError';
  }
}

export class StrategistSyncBudgetExceededError extends Error {
  readonly estimatedSeconds: number;
  readonly targetSeconds: number;
  readonly budget: StrategistInputBudgetReport;
  readonly suggestedDocIds: string[];

  constructor(params: {
    estimatedSeconds: number;
    targetSeconds: number;
    budget: StrategistInputBudgetReport;
    suggestedDocIds: string[];
  }) {
    super('Estimated sync duration exceeds the target budget for /api/context-package.');
    this.name = 'StrategistSyncBudgetExceededError';
    this.estimatedSeconds = params.estimatedSeconds;
    this.targetSeconds = params.targetSeconds;
    this.budget = params.budget;
    this.suggestedDocIds = params.suggestedDocIds;
  }
}

export type RunStrategistOrchestratorInput = {
  purpose: string;
  /** Inventory から読む document 数の上限（LLM 投入上限とは別物） */
  limit?: number;
  /** 対象を明示的に絞る docId フィルタ（未指定なら terminal docs から選定） */
  docIds?: string[];
  /** pre-LLM input budget（未指定なら {@link DEFAULT_STRATEGIST_INPUT_BUDGET}） */
  inputBudget?: StrategistInputBudgetConfig;
  /**
   * 同期 20 秒ゲートを強制するか（既定 true）。非同期 job 経路では false にして、
   * 20 秒超の見込みでも実行を続ける。pre-LLM budget（Vertex token 上限の絞り込み）は
   * budget モードでのみ適用する。full モードではバッチ分割へ置き換える。
   */
  enforceSyncBudget?: boolean;
  /**
   * `budget`（既定）: 現行の pre-LLM budget 絞り込み + 単発 strategistFlow。
   * `full`: 全 safe chunk をバッチ分割して逐次 strategistFlow（async 専用）。
   */
  coverage?: StrategistCoverageMode;
};

export type RunStrategistOrchestratorDeps = {
  listInventoryDocuments?: () => Promise<InventoryDocument[]>;
  resolveInventoryDocumentsByIds?: (
    docIds: string[],
  ) => Promise<ResolvedInventoryDocument[]>;
  listChunks?: (documentId: string) => Promise<KnowledgeChunk[]>;
  strategistFlow?: typeof strategistFlow;
  safetyGate?: typeof runSafetyGate;
  /** full coverage バッチ進捗（job progress 用。失敗しても job を落とさない） */
  onBatchProgress?: (progress: {
    batchesCompleted: number;
    batchesTotal: number;
  }) => boolean | void | Promise<boolean | void>;
  consolidateGaps?: (
    input: ConsolidateGapsInput,
  ) => Promise<ConsolidatedStrategistGaps>;
};

type JoinedChunk = {
  chunk: KnowledgeChunk;
  parent: StrategistOrchestratorParent;
};

function normalizeDocIds(docIds: readonly string[] | undefined): string[] {
  if (!docIds) {
    return [];
  }
  const normalized = docIds
    .map((docId) => docId.trim())
    .filter((docId) => docId.length > 0);
  return Array.from(new Set(normalized));
}

/**
 * docIds 未指定時の経路: 最近の inventory を読み terminal だけ残す。
 * 1 件も無ければ従来どおり {@link NoInventoryDocumentsError}（route で 409）。
 */
async function loadTerminalInventory(
  listInventoryDocuments: () => Promise<InventoryDocument[]>,
): Promise<InventoryDocument[]> {
  const documents = (await listInventoryDocuments()).filter((doc) =>
    TERMINAL_STATUSES.has(doc.status),
  );
  if (documents.length === 0) {
    throw new NoInventoryDocumentsError();
  }
  return documents;
}

/**
 * docIds 指定時の経路: 指定された docId を 1 件ずつ terminal 解決する。
 * unknown / non-terminal が 1 件でもあれば {@link UnresolvedDocIdsError}（route で 400）。
 * 全件 terminal なら、その document だけを対象として返す。
 */
async function resolveRequestedDocuments(
  docIds: string[],
  resolveByIds: (
    docIds: string[],
  ) => Promise<ResolvedInventoryDocument[]>,
): Promise<InventoryDocument[]> {
  const resolutions = await resolveByIds(docIds);

  const unknownDocIds: string[] = [];
  const nonTerminalDocIds: { docId: string; status: string }[] = [];
  const documents: InventoryDocument[] = [];
  for (const resolution of resolutions) {
    if (resolution.outcome === 'unknown') {
      unknownDocIds.push(resolution.docId);
    } else if (resolution.outcome === 'non_terminal') {
      nonTerminalDocIds.push({
        docId: resolution.docId,
        status: resolution.status,
      });
    } else {
      documents.push(resolution.document);
    }
  }

  if (unknownDocIds.length > 0 || nonTerminalDocIds.length > 0) {
    throw new UnresolvedDocIdsError({ unknownDocIds, nonTerminalDocIds });
  }

  return documents;
}

function estimateStrategistSyncSeconds(report: StrategistInputBudgetReport): number {
  const rawEstimate =
    STRATEGIST_SYNC_ESTIMATE_BASE_SECONDS +
    report.keptChunks * STRATEGIST_SYNC_ESTIMATE_PER_CHUNK_SECONDS +
    report.estimatedPromptTokens * STRATEGIST_SYNC_ESTIMATE_PER_TOKEN_SECONDS;
  return Number(rawEstimate.toFixed(1));
}

function suggestedDocIdsFromSafeChunks(chunks: readonly KnowledgeChunk[]): string[] {
  const suggested: string[] = [];
  for (const chunk of chunks) {
    if (!suggested.includes(chunk.docId)) {
      suggested.push(chunk.docId);
    }
    if (suggested.length >= 3) {
      break;
    }
  }
  return suggested;
}

export async function runStrategistOrchestrator(
  input: RunStrategistOrchestratorInput,
  deps: RunStrategistOrchestratorDeps = {},
): Promise<StrategistOrchestratorResult> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const requestedDocIds = normalizeDocIds(input.docIds);
  const usesDocIdFilter = requestedDocIds.length > 0;
  const listInventoryDocuments =
    deps.listInventoryDocuments ??
    (() => listInventoryDocumentsFromFirestore(limit));
  const resolveByIds =
    deps.resolveInventoryDocumentsByIds ?? resolveInventoryDocumentsByIds;
  const listChunks =
    deps.listChunks ??
    createChunkFirestoreAdapter().listChunksForDocument;
  const activeSafetyGate = deps.safetyGate ?? runSafetyGate;
  const activeStrategistFlow = deps.strategistFlow ?? strategistFlow;
  const onBatchProgress = deps.onBatchProgress;
  const consolidateGaps = deps.consolidateGaps ?? consolidateMissingAndQuestions;
  const budgetConfig = input.inputBudget ?? DEFAULT_STRATEGIST_INPUT_BUDGET;
  const coverage = input.coverage ?? 'budget';
  const enforceSyncBudget = input.enforceSyncBudget ?? true;

  if (coverage === 'full' && enforceSyncBudget) {
    throw new StrategistFullCoverageRequiresAsyncError();
  }

  // docIds 指定時は strict resolution（unknown / non-terminal が 1 件でもあれば throw）。
  // 未指定時だけ従来の inventory limit fallback / NoInventoryDocumentsError を維持する。
  const documents = usesDocIdFilter
    ? await resolveRequestedDocuments(requestedDocIds, resolveByIds)
    : await loadTerminalInventory(listInventoryDocuments);

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
      budget: emptyBudgetReport(budgetConfig),
      budgetDroppedDocuments: [],
      syncEstimateSeconds: 0,
      coverage:
        coverage === 'full'
          ? { mode: 'full', batches: 0, missingConsolidation: 'deterministic' }
          : { mode: 'budget' },
    };
  }

  const safeCandidates: BudgetCandidate[] = safetyResult.safe.map((chunk) => {
    const joined = requireSafeJoinedChunk(chunk, joinedByKey);
    return { chunk, parent: joined.parent };
  });

  if (coverage === 'full') {
    return runFullCoverageStrategist({
      purpose: input.purpose,
      safeCandidates,
      joinedByKey,
      safetyExcluded,
      budgetConfig,
      activeStrategistFlow,
      onBatchProgress,
      consolidateGaps,
      sourceDocumentsReviewed: documents.length,
    });
  }

  // pre-LLM budget: safety gate を通った chunk を Strategist 呼び出し前に
  // 関連度で並べ、Vertex token 上限を超えないサイズへ決定論的に絞り込む。
  const budgetResult = applyStrategistInputBudget(
    safeCandidates,
    input.purpose,
    budgetConfig,
  );
  if (budgetResult.report.droppedChunks > 0) {
    console.warn(
      `[strategistOrchestrator] pre-LLM budget dropped ${budgetResult.report.droppedChunks} of ` +
        `${budgetResult.report.totalCandidates} safe chunks ` +
        `(kept ${budgetResult.report.keptChunks} chunks across ${budgetResult.report.keptDocuments} docs, ` +
        `~${budgetResult.report.estimatedPromptTokens} prompt tokens).`,
    );
  }

  const syncEstimateSeconds = estimateStrategistSyncSeconds(budgetResult.report);
  if (enforceSyncBudget && syncEstimateSeconds > STRATEGIST_SYNC_TARGET_SECONDS) {
    throw new StrategistSyncBudgetExceededError({
      estimatedSeconds: syncEstimateSeconds,
      targetSeconds: STRATEGIST_SYNC_TARGET_SECONDS,
      budget: budgetResult.report,
      suggestedDocIds: suggestedDocIdsFromSafeChunks(budgetResult.kept),
    });
  }

  const safeInputs = budgetResult.kept.map((chunk) =>
    strategistInputForSafeChunk(chunk, joinedByKey),
  );
  const strategistResult = await activeStrategistFlow({
    purpose: input.purpose,
    chunkInputs: safeInputs,
    safetyExcludedCount: safetyExcluded.length,
  });
  const safeJoinedByKey = new Map(
    budgetResult.kept.map((chunk) => {
      const key = chunkKey(chunk.docId, chunk.id);
      return [key, requireSafeJoinedChunk(chunk, joinedByKey)] as const;
    }),
  );

  return buildResult({
    purpose: input.purpose,
    sourceDocumentsReviewed: documents.length,
    strategistResult,
    safeJoinedByKey,
    safetyExcluded,
    budget: budgetResult.report,
    budgetDroppedDocuments: budgetResult.droppedDocuments,
    syncEstimateSeconds,
    coverage: { mode: 'budget' },
  });
}

async function runFullCoverageStrategist(params: {
  purpose: string;
  safeCandidates: BudgetCandidate[];
  joinedByKey: Map<string, JoinedChunk>;
  safetyExcluded: SafetyExcludedChunk[];
  budgetConfig: StrategistInputBudgetConfig;
  activeStrategistFlow: NonNullable<RunStrategistOrchestratorDeps['strategistFlow']>;
  onBatchProgress?: RunStrategistOrchestratorDeps['onBatchProgress'];
  consolidateGaps: NonNullable<RunStrategistOrchestratorDeps['consolidateGaps']>;
  sourceDocumentsReviewed: number;
}): Promise<StrategistOrchestratorResult> {
  const partition = partitionStrategistBatches(
    params.safeCandidates,
    params.purpose,
    params.budgetConfig,
  );
  const batchesTotal = partition.batches.length;
  const batchOutputs: StrategistOutput[] = [];
  const reviewedDocIds = new Set<string>();

  for (const [batchIndex, batch] of partition.batches.entries()) {
    for (const candidate of batch) {
      reviewedDocIds.add(candidate.chunk.docId);
    }
    const safeInputs = batch.map((candidate) =>
      strategistInputForSafeChunk(candidate.chunk, params.joinedByKey),
    );
    const batchDocIds = new Set(batch.map((candidate) => candidate.chunk.docId));
    const batchResult = await params.activeStrategistFlow({
      purpose: params.purpose,
      chunkInputs: safeInputs,
      safetyExcludedCount: params.safetyExcluded.filter((row) =>
        batchDocIds.has(row.docId),
      ).length,
    });
    batchOutputs.push(batchResult);

    if (params.onBatchProgress) {
      try {
        const progressAccepted = await params.onBatchProgress({
          batchesCompleted: batchIndex + 1,
          batchesTotal,
        });
        if (progressAccepted === false) {
          throw new StrategistFullCoverageLeaseLostError();
        }
      } catch (progressError) {
        if (progressError instanceof StrategistFullCoverageLeaseLostError) {
          throw progressError;
        }
        console.warn(
          '[strategistOrchestrator] onBatchProgress failed (ignored)',
          progressError,
        );
      }
    }
  }

  const strategistResult = mergeStrategistBatchOutputs(batchOutputs);
  const consolidated = await params.consolidateGaps({
    purpose: params.purpose,
    includedSummary: strategistResult.included.map((ref) => {
      const joined = requireJoinedChunk(
        ref.docId,
        ref.chunkId,
        params.joinedByKey,
      );
      return {
        docId: ref.docId,
        fileName: joined.parent.fileName,
        chunkId: ref.chunkId,
        rationale: ref.rationale,
      } satisfies IncludedSummaryForReduce;
    }),
    batchOutputs,
  });
  strategistResult.missing = consolidated.missing;
  strategistResult.humanReviewQuestions = consolidated.humanReviewQuestions;

  const safeJoinedByKey = new Map(
    params.safeCandidates.map((candidate) => {
      const key = chunkKey(candidate.chunk.docId, candidate.chunk.id);
      return [key, requireSafeJoinedChunk(candidate.chunk, params.joinedByKey)] as const;
    }),
  );

  const distinctSafeDocuments = reviewedDocIds.size;
  const fullBudgetReport: StrategistInputBudgetReport = {
    config: params.budgetConfig,
    totalCandidates: partition.stats.totalCandidates,
    keptChunks: partition.stats.totalCandidates,
    droppedChunks: 0,
    keptDocuments: distinctSafeDocuments,
    estimatedPromptChars: partition.stats.totalEstimatedPromptChars,
    estimatedPromptTokens: partition.stats.totalEstimatedPromptTokens,
  };

  return buildResult({
    purpose: params.purpose,
    sourceDocumentsReviewed: params.sourceDocumentsReviewed,
    strategistResult,
    safeJoinedByKey,
    safetyExcluded: params.safetyExcluded,
    budget: fullBudgetReport,
    budgetDroppedDocuments: [],
    syncEstimateSeconds: estimateStrategistSyncSeconds(fullBudgetReport),
    coverage: {
      mode: 'full',
      batches: batchesTotal,
      missingConsolidation: consolidated.consolidation,
    },
  });
}

function mergeStrategistBatchOutputs(
  batchOutputs: StrategistOutput[],
): StrategistOutput {
  const included = new Map<string, StrategistOutput['included'][number]>();
  const excluded = new Map<string, StrategistOutput['excluded'][number]>();

  for (const output of batchOutputs) {
    for (const ref of output.included) {
      const key = chunkKey(ref.docId, ref.chunkId);
      if (included.has(key) || excluded.has(key)) {
        throw new Error(`Duplicate strategist included ref across batches: ${key}`);
      }
      included.set(key, ref);
    }
    for (const ref of output.excluded) {
      const key = chunkKey(ref.docId, ref.chunkId);
      if (included.has(key) || excluded.has(key)) {
        throw new Error(`Duplicate strategist excluded ref across batches: ${key}`);
      }
      excluded.set(key, ref);
    }
  }

  return {
    included: Array.from(included.values()),
    excluded: Array.from(excluded.values()),
    missing: [],
    humanReviewQuestions: [],
  };
}

function requireSafeJoinedChunk(
  chunk: KnowledgeChunk,
  joinedByKey: Map<string, JoinedChunk>,
): JoinedChunk {
  const joined = joinedByKey.get(chunkKey(chunk.docId, chunk.id));
  if (!joined) {
    throw new Error(
      `Safety gate returned unknown safe chunk: ${chunk.docId}/${chunk.id}`,
    );
  }
  return joined;
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
  budget: StrategistInputBudgetReport;
  budgetDroppedDocuments: BudgetDroppedDocument[];
  syncEstimateSeconds: number;
  coverage?: StrategistOrchestratorResult['coverage'];
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
    budget: params.budget,
    budgetDroppedDocuments: params.budgetDroppedDocuments,
    syncEstimateSeconds: params.syncEstimateSeconds,
    coverage: params.coverage,
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

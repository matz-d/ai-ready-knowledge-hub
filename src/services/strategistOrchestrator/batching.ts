import type { KnowledgeChunk } from '../../lib/knowledgeChunkSchema';
import {
  DEFAULT_STRATEGIST_INPUT_BUDGET,
  admitChunkToBudget,
  batchSatisfiesBudgetContract,
  chunkAdmitsToBudget,
  chunksAdmitToBudget,
  emptyBudgetAdmissionAccumulator,
  estimatePromptCharsForChunk,
  estimateTokensFromChars,
  purposeTerms,
  scoreCandidateForPurpose,
  type BudgetAdmissionAccumulator,
  type BudgetCandidate,
  type StrategistInputBudgetConfig,
} from './budget';

export type StrategistBatchPartitionStats = {
  totalCandidates: number;
  batchCount: number;
  totalEstimatedPromptChars: number;
  totalEstimatedPromptTokens: number;
};

export type StrategistBatchPartitionResult = {
  batches: BudgetCandidate[][];
  stats: StrategistBatchPartitionStats;
};

type BatchAccumulator = {
  candidates: BudgetCandidate[];
  admission: BudgetAdmissionAccumulator;
};

function emptyBatch(): BatchAccumulator {
  return { candidates: [], admission: emptyBudgetAdmissionAccumulator() };
}

function chunkFitsBatch(
  batch: BatchAccumulator,
  candidate: BudgetCandidate,
  config: StrategistInputBudgetConfig,
): boolean {
  return chunkAdmitsToBudget(batch.admission, candidate, config);
}

function addToBatch(
  batch: BatchAccumulator,
  candidate: BudgetCandidate,
  config: StrategistInputBudgetConfig,
): void {
  batch.candidates.push(candidate);
  admitChunkToBudget(batch.admission, candidate, config);
}

const STRICT_DOCUMENT_ADMISSION = {
  allowFirstChunkCharOverflow: false,
} as const;

function documentFitsEmptyBatch(
  chunks: readonly BudgetCandidate[],
  config: StrategistInputBudgetConfig,
): boolean {
  return chunksAdmitToBudget(
    emptyBudgetAdmissionAccumulator(),
    chunks,
    config,
    STRICT_DOCUMENT_ADMISSION,
  );
}

function documentFitsCurrentBatch(
  batch: BatchAccumulator,
  chunks: readonly BudgetCandidate[],
  config: StrategistInputBudgetConfig,
): boolean {
  return chunksAdmitToBudget(
    batch.admission,
    chunks,
    config,
    STRICT_DOCUMENT_ADMISSION,
  );
}

function groupCandidatesByDocument(
  candidates: BudgetCandidate[],
): { docId: string; chunks: BudgetCandidate[]; firstIndex: number }[] {
  const order: string[] = [];
  const chunksByDoc = new Map<string, BudgetCandidate[]>();
  const firstIndexByDoc = new Map<string, number>();

  candidates.forEach((candidate, index) => {
    const docId = candidate.chunk.docId;
    if (!chunksByDoc.has(docId)) {
      order.push(docId);
      chunksByDoc.set(docId, []);
      firstIndexByDoc.set(docId, index);
    }
    chunksByDoc.get(docId)!.push(candidate);
  });

  return order.map((docId) => ({
    docId,
    chunks: chunksByDoc.get(docId)!,
    firstIndex: firstIndexByDoc.get(docId)!,
  }));
}

function orderDocumentsByRelevance(
  grouped: { docId: string; chunks: BudgetCandidate[]; firstIndex: number }[],
  purpose: string,
  now: number,
): { docId: string; chunks: BudgetCandidate[] }[] {
  const terms = purposeTerms(purpose);
  return grouped
    .map((row) => {
      const maxScore = row.chunks.reduce(
        (max, candidate) =>
          Math.max(max, scoreCandidateForPurpose(candidate, terms, now)),
        0,
      );
      return { ...row, maxScore };
    })
    .sort(
      (left, right) =>
        right.maxScore - left.maxScore || left.firstIndex - right.firstIndex,
    )
    .map(({ docId, chunks }) => ({ docId, chunks }));
}

/**
 * safety gate 通過済み候補を Strategist バッチへ分割する（full coverage 用）。
 *
 * - 全 candidate をちょうど 1 バッチに割り当てる（disjoint + full coverage）
 * - 文書単位の関連度（chunk score の max）降順で詰め、文書内 chunk 順は入力順を保持
 * - 1 文書が maxChunks / maxTotalPromptChars を超える場合は連続バッチへ分割
 * - 各バッチは {@link StrategistInputBudgetConfig} の上限を満たす
 */
export function partitionStrategistBatches(
  candidates: BudgetCandidate[],
  purpose: string,
  config: StrategistInputBudgetConfig = DEFAULT_STRATEGIST_INPUT_BUDGET,
): StrategistBatchPartitionResult {
  if (candidates.length === 0) {
    return {
      batches: [],
      stats: {
        totalCandidates: 0,
        batchCount: 0,
        totalEstimatedPromptChars: 0,
        totalEstimatedPromptTokens: 0,
      },
    };
  }

  const now = Date.now();
  const orderedDocuments = orderDocumentsByRelevance(
    groupCandidatesByDocument(candidates),
    purpose,
    now,
  );

  const batches: BudgetCandidate[][] = [];
  let current = emptyBatch();

  const finalizeCurrent = (): void => {
    if (current.candidates.length > 0) {
      batches.push(current.candidates);
      current = emptyBatch();
    }
  };

  for (const document of orderedDocuments) {
    if (documentFitsEmptyBatch(document.chunks, config)) {
      if (!documentFitsCurrentBatch(current, document.chunks, config)) {
        finalizeCurrent();
      }
      for (const chunk of document.chunks) {
        addToBatch(current, chunk, config);
      }
      continue;
    }

    // 巨大文書は文書単体でも 1 batch に収まらないため、文書内順序を保ったまま
    // 連続 batch に分割する。小さな文書は上の分岐で丸ごと保持される。
    finalizeCurrent();
    let chunkIndex = 0;
    while (chunkIndex < document.chunks.length) {
      if (!chunkFitsBatch(current, document.chunks[chunkIndex]!, config)) {
        finalizeCurrent();
      }

      while (
        chunkIndex < document.chunks.length &&
        chunkFitsBatch(current, document.chunks[chunkIndex]!, config)
      ) {
        addToBatch(current, document.chunks[chunkIndex]!, config);
        chunkIndex += 1;
      }

      if (chunkIndex < document.chunks.length) {
        finalizeCurrent();
        if (current.candidates.length === 0) {
          addToBatch(current, document.chunks[chunkIndex]!, config);
          chunkIndex += 1;
        }
      }
    }
  }

  finalizeCurrent();

  const totalEstimatedPromptChars = batches.reduce(
    (sum, batch) =>
      sum +
      batch.reduce(
        (batchSum, candidate) =>
          batchSum +
          estimatePromptCharsForChunk(candidate.chunk, config.maxCharsPerChunk),
        0,
      ),
    0,
  );

  return {
    batches,
    stats: {
      totalCandidates: candidates.length,
      batchCount: batches.length,
      totalEstimatedPromptChars,
      totalEstimatedPromptTokens: estimateTokensFromChars(totalEstimatedPromptChars),
    },
  };
}

/** テスト・検証用: バッチが budget 制約を満たすか */
export function batchSatisfiesBudget(
  batch: readonly BudgetCandidate[],
  config: StrategistInputBudgetConfig,
): boolean {
  return batchSatisfiesBudgetContract(batch, config);
}

/** テスト・検証用: chunk が元の document 内で順序を保っているか */
export function preservesChunkOrderWithinDocuments(
  batches: readonly (readonly BudgetCandidate[])[],
  original: readonly BudgetCandidate[],
): boolean {
  const originalOrder = new Map<string, KnowledgeChunk[]>();
  for (const candidate of original) {
    const key = candidate.chunk.docId;
    if (!originalOrder.has(key)) {
      originalOrder.set(key, []);
    }
    originalOrder.get(key)!.push(candidate.chunk);
  }

  const batchedOrder = new Map<string, KnowledgeChunk[]>();
  for (const batch of batches) {
    for (const candidate of batch) {
      const key = candidate.chunk.docId;
      if (!batchedOrder.has(key)) {
        batchedOrder.set(key, []);
      }
      batchedOrder.get(key)!.push(candidate.chunk);
    }
  }

  for (const [docId, chunks] of originalOrder) {
    const batched = batchedOrder.get(docId) ?? [];
    if (batched.length !== chunks.length) {
      return false;
    }
    for (let index = 0; index < chunks.length; index += 1) {
      if (batched[index]?.id !== chunks[index]?.id) {
        return false;
      }
    }
  }
  return true;
}

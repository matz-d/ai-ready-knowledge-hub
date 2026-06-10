import type {
  HumanReviewQuestion,
  MissingInfo,
  StrategistOutput,
} from '../../agents/strategist/schema';
import {
  strategistReduceFlow,
  type StrategistReduceInput,
  type StrategistReduceOutput,
} from '../../agents/strategist/reduceFlow';

export type MissingConsolidationMode = 'deterministic' | 'llm' | 'deterministic_fallback';

export type ConsolidatedStrategistGaps = {
  missing: MissingInfo[];
  humanReviewQuestions: HumanReviewQuestion[];
  consolidation: MissingConsolidationMode;
};

/** included サマリ（reduce LLM 入力用。chunk 本文は渡さない） */
export type IncludedSummaryForReduce = {
  docId: string;
  fileName: string;
  chunkId: string;
  rationale: string;
};

export type ConsolidateGapsInput = {
  purpose: string;
  includedSummary: IncludedSummaryForReduce[];
  batchOutputs: Pick<StrategistOutput, 'missing' | 'humanReviewQuestions'>[];
  allowedChunkIds: string[];
  reduceFlow?: (input: StrategistReduceInput) => Promise<StrategistReduceOutput>;
};

function normalizeDedupeKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * バッチごとの missing / humanReviewQuestions を決定論的に dedupe する。
 * reduce LLM 未接続時の第一パス実装。
 */
export function consolidateMissingAndQuestionsDeterministic(
  batchOutputs: Pick<StrategistOutput, 'missing' | 'humanReviewQuestions'>[],
): ConsolidatedStrategistGaps {
  const missingByTopic = new Map<string, MissingInfo>();
  for (const output of batchOutputs) {
    for (const item of output.missing) {
      const key = normalizeDedupeKey(item.topic);
      if (!missingByTopic.has(key)) {
        missingByTopic.set(key, item);
      }
    }
  }

  const questionsByText = new Map<string, HumanReviewQuestion>();
  for (const output of batchOutputs) {
    for (const item of output.humanReviewQuestions) {
      const key = normalizeDedupeKey(item.question);
      const existing = questionsByText.get(key);
      if (!existing) {
        questionsByText.set(key, { ...item });
        continue;
      }
      const mergedIds = new Set([
        ...(existing.relatedChunkIds ?? []),
        ...(item.relatedChunkIds ?? []),
      ]);
      questionsByText.set(key, {
        ...existing,
        relatedChunkIds:
          mergedIds.size > 0 ? Array.from(mergedIds).sort() : undefined,
      });
    }
  }

  return {
    missing: Array.from(missingByTopic.values()),
    humanReviewQuestions: Array.from(questionsByText.values()),
    consolidation: 'deterministic',
  };
}

/**
 * missing / humanReviewQuestions の統合 seam。
 */
export async function consolidateMissingAndQuestions(
  input: ConsolidateGapsInput,
): Promise<ConsolidatedStrategistGaps> {
  const deterministic = consolidateMissingAndQuestionsDeterministic(
    input.batchOutputs,
  );
  if (
    deterministic.missing.length === 0 &&
    deterministic.humanReviewQuestions.length === 0
  ) {
    return deterministic;
  }

  try {
    const reduce = input.reduceFlow ?? strategistReduceFlow;
    const reduced = await reduce({
      purpose: input.purpose,
      includedSummary: input.includedSummary,
      missingCandidates: deterministic.missing,
      humanReviewQuestionCandidates: deterministic.humanReviewQuestions,
      allowedChunkIds: input.allowedChunkIds,
    });
    return {
      ...reduced,
      consolidation: 'llm',
    };
  } catch (error) {
    console.warn(
      '[strategistOrchestrator] missing/questions reduce failed; using deterministic fallback',
      error,
    );
    return {
      ...deterministic,
      consolidation: 'deterministic_fallback',
    };
  }
}

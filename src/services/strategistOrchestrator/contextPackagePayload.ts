/**
 * Context Package のレスポンス payload を 1 か所で組み立てる。
 *
 * 同期経路 `POST /api/context-package` と、非同期 worker（job runner）が
 * 同一形状の payload を返すための共有ビルダー。raw chunk.text を境界外へ出さない
 * projection（responseView）はここを必ず通す。
 */
import { buildStrategistContextPackage } from './toContextPackage';
import {
  toExcludedChunkView,
  toIncludedChunkView,
  toSafetyExcludedChunkView,
} from './responseView';
import type { StrategistOrchestratorResult } from './types';

export function buildContextPackageResponsePayload(
  result: StrategistOrchestratorResult,
): Record<string, unknown> {
  const { markdown } = buildStrategistContextPackage(result);

  return {
    purpose: result.purpose,
    generatedAt: result.generatedAt,
    sourceDocumentsReviewed: result.sourceDocumentsReviewed,
    // raw chunk.text を境界外へ出さないため metadata + AI-safe 本文のみへ projection する。
    included: result.included.map(toIncludedChunkView),
    excluded: result.excluded.map(toExcludedChunkView),
    safetyExcluded: result.safetyExcluded.map(toSafetyExcludedChunkView),
    missing: result.missing,
    humanReviewQuestions: result.humanReviewQuestions,
    syncEstimateSeconds: result.syncEstimateSeconds,
    markdown,
    counts: {
      included: result.included.length,
      excluded: result.excluded.length,
      safetyExcluded: result.safetyExcluded.length,
      missing: result.missing.length,
      humanReviewQuestions: result.humanReviewQuestions.length,
    },
    budget: {
      ...result.budget,
      // 観測用の明示エイリアス（report の droppedChunks と同値）
      budgetDroppedCount: result.budget.droppedChunks,
    },
    // budget で落とした safe chunk の文書別内訳。空でなければ package は不完全。
    budgetDroppedDocuments: result.budgetDroppedDocuments,
  };
}

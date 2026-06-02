import type {
  ExclusionReason,
  StrategistExclusionReason,
} from '../../agents/strategist/schema';
import type { InventoryDocument } from '../../lib/inventory';
import type { KnowledgeChunk } from '../../lib/knowledgeChunkSchema';
import type { StrategistInputBudgetReport } from './budget';

export type StrategistOrchestratorParent = Pick<
  InventoryDocument,
  | 'id'
  | 'fileName'
  | 'documentType'
  | 'businessDomain'
  | 'freshness'
  | 'isAuthoritativeCandidate'
  | 'updatedAt'
>;

export type StrategistChunkSelection = {
  docId: string;
  chunkId: string;
  rationale: string;
  chunk: KnowledgeChunk;
  parent: StrategistOrchestratorParent;
  confidence?: number;
  reason?: StrategistExclusionReason;
};

export type SafetyExcludedChunk = {
  docId: string;
  chunkId: string;
  rationale: string;
  reason: ExclusionReason;
  chunk: KnowledgeChunk;
  parent: StrategistOrchestratorParent;
};

export type StrategistOrchestratorResult = {
  purpose: string;
  generatedAt: string;
  sourceDocumentsReviewed: number;
  included: StrategistChunkSelection[];
  excluded: StrategistChunkSelection[];
  safetyExcluded: SafetyExcludedChunk[];
  missing: string[];
  humanReviewQuestions: string[];
  /** pre-LLM input budget の適用結果（落とした件数などの観測用メタデータ） */
  budget: StrategistInputBudgetReport;
  /** 同期実行の所要時間推定（秒）。20秒超え見込みは API 側で 422 を返して同期実行しない。 */
  syncEstimateSeconds: number;
};

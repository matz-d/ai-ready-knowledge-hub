import type {
  ExclusionReason,
  StrategistExclusionReason,
} from '../../agents/strategist/schema';
import type { InventoryDocument } from '../../lib/inventory';
import type { KnowledgeChunk } from '../../lib/knowledgeChunkSchema';

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
};

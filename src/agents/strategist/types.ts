// TODO(Phase 3): implement strategistFlow. Phase 2 では型予約のみ。

import type { InventoryDocument } from '../../lib/inventory';

// TODO(Phase 2): import `KnowledgeChunk` from `../../lib/knowledgeChunkSchema` (docs/phase-2-design.md §3).
type KnowledgeChunk = {
  id: string;
  docId: string;
};

export type ChunkRef = {
  docId: string;
  chunkId: string;
  reason: string;
};

export type StrategistInput = {
  purpose: string;
  documents: InventoryDocument[];
  chunks: KnowledgeChunk[];
};

export type StrategistOutput = {
  included: ChunkRef[];
  excluded: ChunkRef[];
  missing: string[];
  humanReviewQuestions: string[];
};

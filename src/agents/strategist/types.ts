// TODO(Phase 3): implement strategistFlow. Phase 2 では型予約のみ。

import type { InventoryDocument } from '../../lib/inventory';
import type { KnowledgeChunk } from '../../lib/knowledgeChunkSchema';

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

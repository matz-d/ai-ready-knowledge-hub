import type { AiUsePolicy, Sensitivity } from '../../agents/curator/schema';
import {
  computeChunkSourceHash,
  KNOWLEDGE_CHUNK_SCHEMA_VERSION,
  type KnowledgeChunk,
} from '../knowledgeChunkSchema';

const PARAGRAPH_LOCATOR = { kind: 'paragraph' as const };

function stableChunkId(docId: string): string {
  return `${docId}:text:paragraph`;
}

/**
 * One UTF-8 document body → at most one paragraph chunk (PoC; no markdown parsing).
 */
export function extractPlainTextDocument(input: {
  docId: string;
  fileName: string;
  content: string;
  documentSensitivity: Sensitivity;
  documentAiUsePolicy: AiUsePolicy;
}): { chunks: KnowledgeChunk[] } {
  const trimmed = input.content.trim();
  if (trimmed.length === 0) {
    return { chunks: [] };
  }

  const now = new Date().toISOString();
  const locator = PARAGRAPH_LOCATOR;

  const chunk: KnowledgeChunk = {
    id: stableChunkId(input.docId),
    docId: input.docId,
    schemaVersion: KNOWLEDGE_CHUNK_SCHEMA_VERSION,
    sourceType: 'text',
    structureType: 'paragraph',
    locator,
    title: input.fileName,
    text: trimmed,
    sensitivity: input.documentSensitivity,
    aiUsePolicy: input.documentAiUsePolicy,
    sensitivitySource: 'inherited',
    extractionProvider: 'text',
    sourceHash: computeChunkSourceHash({
      extractorInput: input.content,
      locator,
    }),
    createdAt: now,
    updatedAt: now,
  };

  return { chunks: [chunk] };
}

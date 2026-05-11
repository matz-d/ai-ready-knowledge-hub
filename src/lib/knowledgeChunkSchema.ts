import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  AiUsePolicyEnum,
  SensitivityEnum,
} from '../agents/curator/schema';
import type { FirestoreDocument, FirestoreDocumentStatus } from './firestoreSchema';

export const KNOWLEDGE_CHUNK_SCHEMA_VERSION = 1 as const;

const SourceTypeSchema = z.enum(['text', 'pdf', 'image', 'spreadsheet', 'slide']);

const StructureTypeSchema = z.enum([
  'paragraph',
  'table',
  'list',
  'cellRange',
  'imageText',
]);

export const KnowledgeChunkLocatorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('spreadsheet'),
    sheetName: z.string(),
    range: z.string(),
  }),
  z.object({
    kind: z.literal('pdf'),
    page: z.number().int().min(1),
    paragraphId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('slide'),
    slide: z.number().int().min(1),
  }),
  z.object({ kind: z.literal('imageText') }),
  z.object({ kind: z.literal('paragraph') }),
]);

export type KnowledgeChunkLocator = z.infer<typeof KnowledgeChunkLocatorSchema>;

const ExtractionProviderSchema = z.enum([
  'csv',
  'xlsx',
  'pdf',
  'slides',
  'image',
]);

const SensitivitySourceSchema = z.enum(['inherited', 'columnRule']);

export const KnowledgeChunkSchema = z.object({
  id: z.string(),
  docId: z.string(),
  schemaVersion: z.literal(KNOWLEDGE_CHUNK_SCHEMA_VERSION),

  sourceType: SourceTypeSchema,
  structureType: StructureTypeSchema,
  locator: KnowledgeChunkLocatorSchema,

  title: z.string().optional(),
  text: z.string(),
  maskedText: z.string().optional(),

  sensitivity: SensitivityEnum,
  aiUsePolicy: AiUsePolicyEnum,

  sensitivityReason: z.string().optional(),
  sensitivitySource: SensitivitySourceSchema,

  extractionProvider: ExtractionProviderSchema,
  extractionWarnings: z.array(z.string()).optional(),
  maskedSpansCount: z.number().int().nonnegative().optional(),
  ruleHits: z.record(z.number()).optional(),

  sourceHash: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type KnowledgeChunk = z.infer<typeof KnowledgeChunkSchema>;

const CHUNK_PARENT_TERMINAL_STATUSES = new Set<FirestoreDocumentStatus>([
  'curated',
  'ai_safe',
  'restricted',
  'blocked',
]);

export type KnowledgeChunkInvariantContext = {
  /** Parent Firestore document; `id` must match `chunk.docId` for rule 1. */
  parentDocument: Pick<FirestoreDocument, 'id' | 'status'>;
  /**
   * Same extractor input bytes/string used when the chunk was produced.
   * Required for rule 6 (`sourceHash` vs {@link computeChunkSourceHash}).
   */
  extractorInput: string;
};

function canonicalLocatorString(locator: KnowledgeChunkLocator): string {
  switch (locator.kind) {
    case 'spreadsheet':
      return `spreadsheet:${locator.sheetName}:${locator.range}`;
    case 'pdf': {
      const paragraph = locator.paragraphId ?? '';
      return `pdf:${locator.page}:${paragraph}`;
    }
    case 'slide':
      return `slide:${locator.slide}`;
    case 'imageText':
      return 'imageText';
    case 'paragraph':
      return 'paragraph';
    default: {
      const _exhaustive: never = locator;
      return _exhaustive;
    }
  }
}

export type ChunkSourceHashInput = {
  extractorInput: string;
  locator: KnowledgeChunkLocator;
};

/**
 * Deterministic sha256 over extractor input + locator (design §4 rule 6).
 */
export function computeChunkSourceHash(input: ChunkSourceHashInput): string {
  const payload = [
    'KNOWLEDGE_CHUNK_SOURCE_HASH_V1',
    canonicalLocatorString(input.locator),
    input.extractorInput,
  ].join('\0');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function validateKnowledgeChunkInvariants(
  chunk: KnowledgeChunk,
  context: KnowledgeChunkInvariantContext
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (context.parentDocument.id !== chunk.docId) {
    errors.push(
      'parentDocument.id must match chunk.docId for chunk parent binding.'
    );
  }

  if (!CHUNK_PARENT_TERMINAL_STATUSES.has(context.parentDocument.status)) {
    errors.push(
      'parentDocument.status must be one of curated, ai_safe, restricted, or blocked.'
    );
  }

  if (
    chunk.sensitivity === 'Restricted' &&
    chunk.aiUsePolicy !== 'blocked'
  ) {
    errors.push(
      'When sensitivity is Restricted, aiUsePolicy must be blocked.'
    );
  }

  if (
    chunk.sensitivity === 'Confidential' &&
    chunk.aiUsePolicy !== 'requires_masking'
  ) {
    errors.push(
      'When sensitivity is Confidential, aiUsePolicy must be requires_masking.'
    );
  }

  if (
    chunk.aiUsePolicy === 'requires_masking' &&
    (chunk.maskedText === undefined || chunk.maskedText === '')
  ) {
    errors.push(
      'When aiUsePolicy is requires_masking, maskedText must be present and non-empty.'
    );
  }

  if (
    chunk.sensitivitySource === 'columnRule' &&
    (chunk.sensitivityReason === undefined ||
      chunk.sensitivityReason.trim() === '')
  ) {
    errors.push(
      'When sensitivitySource is columnRule, sensitivityReason must be non-empty.'
    );
  }

  const expectedHash = computeChunkSourceHash({
    extractorInput: context.extractorInput,
    locator: chunk.locator,
  });
  if (chunk.sourceHash !== expectedHash) {
    errors.push(
      `sourceHash must equal computeChunkSourceHash(extractorInput, locator); expected ${expectedHash}, got ${chunk.sourceHash}.`
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}

export function assertKnowledgeChunkInvariants(
  chunk: KnowledgeChunk,
  context: KnowledgeChunkInvariantContext
): void {
  const result = validateKnowledgeChunkInvariants(chunk, context);
  if (!result.ok) {
    throw new Error(
      `Knowledge chunk invariant violations: ${result.errors.join('; ')}`
    );
  }
}

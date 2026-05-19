import { z } from 'zod';
import type { KnowledgeChunk } from '../../lib/knowledgeChunkSchema';

/**
 * PoC intermediate representation (Phase 3-H §5).
 * Not the production Firestore document schema; adapters map into {@link KnowledgeChunk}.
 */
export const DOCUMENT_IR_SCHEMA_VERSION = 1 as const;

export const DocumentSourceSubtypeSchema = z.enum([
  'official-doc-pdf',
  'slide-pdf',
  'scan-pdf',
  'office-native',
]);

export type DocumentSourceSubtype = z.infer<typeof DocumentSourceSubtypeSchema>;

export const DocumentBlockKindSchema = z.enum([
  'paragraph',
  'heading',
  'table',
  'image_text',
  'note',
]);

export type DocumentBlockKind = z.infer<typeof DocumentBlockKindSchema>;

export const DocumentSourceKindSchema = z.enum([
  'upload',
  'google-workspace',
  'poc',
]);

export type DocumentSourceKind = z.infer<typeof DocumentSourceKindSchema>;

export const DocumentIrLocatorSchema = z.object({
  pageNumber: z.number().int().min(1).optional(),
  slideNumber: z.number().int().min(1).optional(),
  tableIndex: z.number().int().nonnegative().optional(),
  rowIndex: z.number().int().nonnegative().optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});

export type DocumentIrLocator = z.infer<typeof DocumentIrLocatorSchema>;

export const DocumentIrBlockSchema = z.object({
  blockId: z.string().min(1),
  kind: DocumentBlockKindSchema,
  text: z.string(),
  locator: DocumentIrLocatorSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type DocumentIrBlock = z.infer<typeof DocumentIrBlockSchema>;

export const DocumentIrPageSchema = z.object({
  pageNumber: z.number().int().min(1),
  blocks: z.array(DocumentIrBlockSchema),
});

export type DocumentIrPage = z.infer<typeof DocumentIrPageSchema>;

export const DocumentIrSourceSchema = z.object({
  fileName: z.string().min(1),
  mediaType: z.string().min(1),
  sourceKind: DocumentSourceKindSchema,
  sourceSubtype: DocumentSourceSubtypeSchema,
});

export const DocumentIrSchema = z.object({
  schemaVersion: z.literal(DOCUMENT_IR_SCHEMA_VERSION),
  source: DocumentIrSourceSchema,
  pages: z.array(DocumentIrPageSchema),
});

export type DocumentIr = z.infer<typeof DocumentIrSchema>;

/** Alias used in docs (Phase 3-H §5). */
export type DocumentIR = DocumentIr;

/**
 * Maps DocumentIR `sourceSubtype` to {@link KnowledgeChunk} `sourceType`.
 * Block-level `structureType` / locator mapping is adapter-specific (§5 table).
 */
export function documentSourceSubtypeToKnowledgeChunkSourceType(
  subtype: DocumentSourceSubtype
): KnowledgeChunk['sourceType'] {
  switch (subtype) {
    case 'official-doc-pdf':
    case 'scan-pdf':
      return 'pdf';
    case 'slide-pdf':
      return 'slide';
    case 'office-native':
      return 'text';
    default: {
      const _exhaustive: never = subtype;
      return _exhaustive;
    }
  }
}

/**
 * Block kinds that map to a KnowledgeChunk `structureType` in subtype-1 adapter (§5).
 * `note` is intentionally omitted until slide-pdf mapping is defined.
 */
export const DOCUMENT_IR_BLOCK_KINDS_WITH_CHUNK_MAPPING: readonly DocumentBlockKind[] =
  ['paragraph', 'heading', 'table', 'image_text'];

export function parseDocumentIr(input: unknown): DocumentIr {
  return DocumentIrSchema.parse(input);
}

export function safeParseDocumentIr(
  input: unknown
): z.SafeParseReturnType<unknown, DocumentIr> {
  return DocumentIrSchema.safeParse(input);
}

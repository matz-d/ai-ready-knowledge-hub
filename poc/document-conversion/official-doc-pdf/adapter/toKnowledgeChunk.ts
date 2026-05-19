import type { KnowledgeChunk } from '../../../../src/lib/knowledgeChunkSchema';
import type { DocumentIr, DocumentIrBlock } from '../../shared/documentIr';

/**
 * Phase 3-H §5 lossy mapping for official-doc-pdf (scaffold).
 * Heading → paragraph + metadata.headingLevel; table 1 block → 1 chunk.
 */
export function documentIrBlockToStructureType(
  kind: DocumentIrBlock['kind']
): KnowledgeChunk['structureType'] | null {
  switch (kind) {
    case 'paragraph':
      return 'paragraph';
    case 'heading':
      return 'paragraph';
    case 'table':
      return 'table';
    case 'image_text':
      return 'imageText';
    case 'note':
      return null;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function buildPdfParagraphId(block: DocumentIrBlock): string | undefined {
  const locator = block.locator;
  if (locator?.tableIndex !== undefined && locator.rowIndex !== undefined) {
    return `table-${locator.tableIndex}-row-${locator.rowIndex}`;
  }
  return block.blockId;
}

export type DocumentIrToKnowledgeChunkDraft = Pick<
  KnowledgeChunk,
  'structureType' | 'text' | 'locator' | 'extractionWarnings'
> & {
  metadata?: Record<string, unknown>;
};

export function mapDocumentIrBlockToChunkDraft(
  block: DocumentIrBlock,
  pageNumber: number
): DocumentIrToKnowledgeChunkDraft | null {
  const structureType = documentIrBlockToStructureType(block.kind);
  if (structureType === null) {
    return null;
  }

  const extractionWarnings: string[] = [];
  if (block.locator?.bbox) {
    extractionWarnings.push(
      `bbox stored in metadata; locator uses pdf page + paragraphId only`
    );
  }

  const metadata: Record<string, unknown> = { ...block.metadata };
  if (block.kind === 'heading') {
    metadata.headingLevel = metadata.headingLevel ?? 1;
  }
  if (block.locator?.bbox) {
    metadata.bbox = block.locator.bbox;
  }

  return {
    structureType,
    text: block.text,
    locator: {
      kind: 'pdf',
      page: pageNumber,
      paragraphId: buildPdfParagraphId(block),
    },
    extractionWarnings:
      extractionWarnings.length > 0 ? extractionWarnings : undefined,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

export function mapDocumentIrToChunkDrafts(
  documentIr: DocumentIr
): DocumentIrToKnowledgeChunkDraft[] {
  const drafts: DocumentIrToKnowledgeChunkDraft[] = [];
  for (const page of documentIr.pages) {
    for (const block of page.blocks) {
      const draft = mapDocumentIrBlockToChunkDraft(block, page.pageNumber);
      if (draft) {
        drafts.push(draft);
      }
    }
  }
  return drafts;
}

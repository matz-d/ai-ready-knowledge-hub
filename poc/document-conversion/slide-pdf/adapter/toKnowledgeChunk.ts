import type { KnowledgeChunk } from '../../../../src/lib/knowledgeChunkSchema';
import type { DocumentIr, DocumentIrBlock } from '../../shared/documentIr';

export type SlidePdfKnowledgeChunkDraft = Pick<
  KnowledgeChunk,
  'structureType' | 'text' | 'locator' | 'extractionWarnings'
> & {
  metadata?: Record<string, unknown>;
};

function structureTypeForBlock(
  kind: DocumentIrBlock['kind']
): KnowledgeChunk['structureType'] | null {
  switch (kind) {
    case 'paragraph':
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

export function mapSlidePdfBlockToChunkDraft(
  block: DocumentIrBlock,
  pageNumber: number
): SlidePdfKnowledgeChunkDraft | null {
  const structureType = structureTypeForBlock(block.kind);
  if (structureType === null) return null;

  const slide = block.locator?.slideNumber ?? block.locator?.pageNumber ?? pageNumber;
  const metadata: Record<string, unknown> = { ...block.metadata };
  if (block.kind === 'heading') {
    metadata.headingLevel = metadata.headingLevel ?? 1;
  }
  if (block.locator?.tableIndex !== undefined) {
    metadata.tableIndex = block.locator.tableIndex;
  }
  if (block.locator?.rowIndex !== undefined) {
    metadata.rowIndex = block.locator.rowIndex;
  }

  return {
    structureType,
    text: block.text,
    locator: { kind: 'slide', slide },
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

export function mapSlidePdfDocumentIrToChunkDrafts(
  documentIr: DocumentIr
): SlidePdfKnowledgeChunkDraft[] {
  const drafts: SlidePdfKnowledgeChunkDraft[] = [];
  for (const page of documentIr.pages) {
    for (const block of page.blocks) {
      const draft = mapSlidePdfBlockToChunkDraft(block, page.pageNumber);
      if (draft) drafts.push(draft);
    }
  }
  return drafts;
}

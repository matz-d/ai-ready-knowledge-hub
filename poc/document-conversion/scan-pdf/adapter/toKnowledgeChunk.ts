import type { KnowledgeChunk } from '../../../../src/lib/knowledgeChunkSchema';
import type { DocumentIr, DocumentIrBlock } from '../../shared/documentIr';
import { buildPdfParagraphId, documentIrBlockToStructureType } from '../../official-doc-pdf/adapter/toKnowledgeChunk';

export type ScanPdfKnowledgeChunkDraft = Pick<
  KnowledgeChunk,
  'structureType' | 'text' | 'locator' | 'extractionWarnings'
> & {
  metadata?: Record<string, unknown>;
};

export function mapScanPdfBlockToChunkDraft(
  block: DocumentIrBlock,
  pageNumber: number
): ScanPdfKnowledgeChunkDraft | null {
  const structureType = documentIrBlockToStructureType(block.kind);
  if (structureType === null) return null;

  const extractionWarnings: string[] = [];
  const metadata: Record<string, unknown> = { ...block.metadata };

  if (block.kind === 'image_text') {
    extractionWarnings.push(
      'scan-pdf OCR text mapped as imageText; downstream masking should preserve original page evidence'
    );
  }
  if (block.locator?.bbox) {
    metadata.bbox = block.locator.bbox;
    extractionWarnings.push(
      'bbox stored in metadata; KnowledgeChunk locator uses pdf page + paragraphId only'
    );
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

export function mapScanPdfDocumentIrToChunkDrafts(
  documentIr: DocumentIr
): ScanPdfKnowledgeChunkDraft[] {
  const drafts: ScanPdfKnowledgeChunkDraft[] = [];
  for (const page of documentIr.pages) {
    for (const block of page.blocks) {
      const draft = mapScanPdfBlockToChunkDraft(block, page.pageNumber);
      if (draft) drafts.push(draft);
    }
  }
  return drafts;
}

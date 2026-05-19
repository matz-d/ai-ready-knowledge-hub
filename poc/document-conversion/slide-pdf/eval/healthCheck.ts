import { runOfficialDocPdfHealthCheck } from '../../official-doc-pdf/eval/healthCheck';
import type { DocumentIr } from '../../shared/documentIr';
import type { SlidePdfKnowledgeChunkDraft } from '../adapter/toKnowledgeChunk';

/**
 * Reuses the existing conversion health-check path for the slide-pdf PoC.
 * The shared runner is still subtype-1 gated, so this wrapper intentionally
 * keeps the compatibility shim local to PoC code.
 */
export function runSlidePdfHealthCheck(
  documentIr: DocumentIr,
  chunkDrafts: SlidePdfKnowledgeChunkDraft[],
  schemaPassed: boolean,
  schemaErrors: string[] = []
): ReturnType<typeof runOfficialDocPdfHealthCheck> {
  const result = runOfficialDocPdfHealthCheck(
    chunkDrafts,
    schemaPassed,
    schemaErrors
  );
  const pagesWithText = documentIr.pages.filter((page) =>
    page.blocks.some((block) => block.text.trim().length > 0)
  ).length;
  const pageCoverage =
    documentIr.pages.length === 0 ? 0 : pagesWithText / documentIr.pages.length;
  const tableBlocks = documentIr.pages.flatMap((page) =>
    page.blocks.filter((block) => block.kind === 'table')
  );
  const hasTableLocators =
    tableBlocks.length > 0 &&
    tableBlocks.every(
      (block) =>
        block.locator?.tableIndex !== undefined &&
        block.locator.rowIndex !== undefined
    );

  return {
    ...result,
    coverage: {
      pageCoverage,
      textDensityWarnings: documentIr.pages
        .filter(
          (page) =>
            page.blocks.reduce(
              (sum, block) => sum + block.text.trim().length,
              0
            ) < 20
        )
        .map((page) => `slide ${page.pageNumber} has low extracted text density`),
      tableCandidates: tableBlocks.length,
    },
    locatorQuality: {
      hasPageLocators:
        chunkDrafts.length > 0 &&
        chunkDrafts.every((chunk) => chunk.locator.kind === 'slide'),
      hasTableLocators,
    },
  };
}

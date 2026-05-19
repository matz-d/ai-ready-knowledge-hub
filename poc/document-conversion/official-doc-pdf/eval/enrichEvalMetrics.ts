import type { ConversionEvalResult } from '../../../../src/eval/conversion';
import type { DocumentIr } from '../../shared/documentIr';

/**
 * Fills coverage / locator_quality from a DocumentIR artifact so pdf-parse and
 * MarkItDown runs are comparable on the same {@link ConversionEvalResult} shape.
 */
export function enrichOfficialDocPdfEvalMetrics(
  result: ConversionEvalResult,
  documentIr: DocumentIr,
  options?: { totalPages?: number }
): ConversionEvalResult {
  const pages = documentIr.pages;
  const pagesWithBlocks = pages.filter((page) =>
    page.blocks.some((block) => block.text.trim().length > 0)
  ).length;
  const totalPages = options?.totalPages ?? pages.length;
  const tableCandidates = pages.reduce(
    (sum, page) =>
      sum + page.blocks.filter((block) => block.kind === 'table').length,
    0
  );
  const hasPageLocators = pages.some((page) =>
    page.blocks.some((block) => block.locator?.pageNumber !== undefined)
  );
  const hasTableLocators = pages.some((page) =>
    page.blocks.some((block) => block.locator?.tableIndex !== undefined)
  );

  return {
    ...result,
    coverage: {
      ...result.coverage,
      pageCoverage: totalPages > 0 ? pagesWithBlocks / totalPages : 0,
      tableCandidates,
    },
    locatorQuality: {
      hasPageLocators,
      hasTableLocators,
    },
  };
}

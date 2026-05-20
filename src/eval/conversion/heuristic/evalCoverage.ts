/**
 * Heuristic stage: `coverage` axis (Phase 3-H-2 §6.2).
 *
 * Surfaces three metrics from a DocumentIR:
 *  - `pageCoverage`: fraction of pages with at least one non-empty block.
 *    Initial thresholds (D-P3-H-5): `>= 1.0` pass / `>= 0.75` warn / `< 0.75` fail.
 *    This function only produces the metric; rollup applies the threshold.
 *  - `tableCandidates`: count of `kind === 'table'` blocks across the doc.
 *    Threshold-less (observation-only per §6.2).
 *  - `textDensityWarnings`: human-readable strings flagging pages that *had*
 *    blocks but whose combined text is suspiciously short, plus a top-level
 *    warning when `pageCoverage === 0` despite having pages. Used as an
 *    anomaly channel (§6.2: "textDensityWarnings で異常を拾う").
 *
 * Intentional carry-over from `enrichOfficialDocPdfEvalMetrics`:
 *   the PoC counted any page with at least one *non-empty* block as covered.
 *   We keep that definition so M2 distributions remain comparable across the
 *   PoC → mainline split.
 */
import type { ConversionEvalResult } from '../conversionEvalResult';
import type { DocumentIrPage } from '../documentIr';
import type { HeuristicEvalChunk, HeuristicEvalInput } from './types';

/**
 * Pages whose total non-whitespace text is shorter than this threshold but
 * still have at least one block are flagged via `textDensityWarnings`. The
 * 50-char value is an initial heuristic (M3 will retune from observed
 * distributions); it deliberately fires on near-empty pages so reviewers see
 * "this page produced a block but barely any content" without polluting the
 * signal on real low-text pages such as section dividers.
 */
export const LOW_DENSITY_PAGE_CHAR_THRESHOLD = 50;
export const COVERAGE_PAGE_COVERAGE_PASS_THRESHOLD = 1.0;
export const COVERAGE_PAGE_COVERAGE_WARN_THRESHOLD = 0.75;

function pageTextLength(page: DocumentIrPage): number {
  return page.blocks.reduce(
    (sum, block) => sum + block.text.trim().length,
    0
  );
}

function pageHasNonEmptyBlock(page: DocumentIrPage): boolean {
  return page.blocks.some((block) => block.text.trim().length > 0);
}

export function evalCoverage<TChunk extends HeuristicEvalChunk>(
  input: HeuristicEvalInput<TChunk>
): Pick<ConversionEvalResult, 'coverage'> {
  const { documentIr } = input;
  const pages = documentIr.pages;
  const totalPages = pages.length;

  const pagesWithBlocks = pages.filter(pageHasNonEmptyBlock).length;
  const pageCoverage = totalPages > 0 ? pagesWithBlocks / totalPages : 0;

  const tableCandidates = pages.reduce(
    (sum, page) =>
      sum + page.blocks.filter((block) => block.kind === 'table').length,
    0
  );

  const textDensityWarnings: string[] = [];
  for (const page of pages) {
    if (page.blocks.length === 0) continue;
    const length = pageTextLength(page);
    if (length === 0) {
      textDensityWarnings.push(
        `page ${page.pageNumber}: all blocks are empty after trim`
      );
      continue;
    }
    if (length < LOW_DENSITY_PAGE_CHAR_THRESHOLD) {
      textDensityWarnings.push(
        `page ${page.pageNumber}: low text density (${length} chars across ${page.blocks.length} block(s); threshold=${LOW_DENSITY_PAGE_CHAR_THRESHOLD})`
      );
    }
  }
  if (totalPages > 0 && pagesWithBlocks === 0) {
    textDensityWarnings.push(
      `document has ${totalPages} page(s) but no page produced a non-empty block (pageCoverage=0)`
    );
  }

  return {
    coverage: {
      pageCoverage,
      textDensityWarnings,
      tableCandidates,
    },
  };
}

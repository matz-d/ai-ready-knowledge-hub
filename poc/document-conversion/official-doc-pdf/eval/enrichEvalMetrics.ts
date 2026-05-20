/**
 * PoC entry point for coverage / locator_quality enrichment.
 *
 * The actual heuristic implementation lives in
 * {@link ../../../../src/eval/conversion/heuristic} (Phase 3-H-2 §6).
 * This file now only:
 *  1. re-exports the canonical heuristic functions so PoC callers can use
 *     them directly, and
 *  2. keeps `enrichOfficialDocPdfEvalMetrics` as a thin wrapper that maps the
 *     PoC's `(result, documentIr, options)` shape onto the new
 *     `({ documentIr, chunks }) => Partial<ConversionEvalResult>` contract
 *     so existing PoC pipelines (`runPipeline.ts`, `runCompare.ts`) keep
 *     working without churn.
 *
 * The `options.totalPages` override is intentionally honoured here even
 * though the canonical `evalCoverage` derives totalPages from
 * `documentIr.pages.length`. It is used by the MarkItDown PoC path to feed
 * the page count from the source PDF (which MarkItDown does not preserve).
 */
import type { ConversionEvalResult } from '../../../../src/eval/conversion';
import {
  evalCoverage,
  evalLocatorQuality,
} from '../../../../src/eval/conversion/heuristic';
import type { DocumentIr } from '../../shared/documentIr';

export {
  evalCoverage,
  evalContextPackageReadiness as evalContextPackageReadinessHeuristic,
  evalLocatorQuality,
  LOW_DENSITY_PAGE_CHAR_THRESHOLD,
} from '../../../../src/eval/conversion/heuristic';

/**
 * Fills coverage / locator_quality from a DocumentIR artifact so pdf-parse and
 * MarkItDown runs are comparable on the same {@link ConversionEvalResult}
 * shape. Backwards-compatible wrapper around the canonical heuristic
 * functions.
 */
export function enrichOfficialDocPdfEvalMetrics(
  result: ConversionEvalResult,
  documentIr: DocumentIr,
  options?: { totalPages?: number }
): ConversionEvalResult {
  const { coverage } = evalCoverage({ documentIr, chunks: [] });
  const { locatorQuality } = evalLocatorQuality({ documentIr, chunks: [] });

  const totalPagesOverride = options?.totalPages;
  const adjustedCoverage =
    totalPagesOverride !== undefined && totalPagesOverride > 0
      ? {
          ...coverage,
          // Re-derive pageCoverage against the override so MarkItDown (which
          // loses original page count) is comparable to pdf-parse.
          pageCoverage: Math.min(
            1,
            documentIr.pages.filter((page) =>
              page.blocks.some((block) => block.text.trim().length > 0)
            ).length / totalPagesOverride
          ),
        }
      : coverage;

  return {
    ...result,
    coverage: {
      ...result.coverage,
      ...adjustedCoverage,
    },
    locatorQuality,
  };
}

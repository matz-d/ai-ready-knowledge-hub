/**
 * Heuristic stage: `locator_quality` axis (Phase 3-H-2 §6.2).
 *
 * Two booleans summarised from DocumentIR block locators:
 *  - `hasPageLocators`: required (`=== true` is the M3 threshold).
 *  - `hasTableLocators`: warning only — absence is acceptable for documents
 *    without tabular content.
 *
 * Rationale: KnowledgeChunk → audit / human review (Phase 3-E §10.3) hinges
 * on being able to point a reviewer at the source page. Without page
 * locators the Context Package cannot back its citations, which is why
 * `hasPageLocators` is promoted from observation to threshold in M3.
 * Status mapping: {@link evalLocatorQualityAxisStatus}.
 */
import type { ConversionEvalResult } from '../conversionEvalResult';
import {
  isAxisMeasuredAtStage,
  type ConversionEvalStage,
} from '../conversionEvalStage';
import type { AxisRollupStatus } from '../evalSafetyReadiness';
import type { HeuristicEvalChunk, HeuristicEvalInput } from './types';

export function evalLocatorQuality<TChunk extends HeuristicEvalChunk>(
  input: HeuristicEvalInput<TChunk>
): Pick<ConversionEvalResult, 'locatorQuality'> {
  const pages = input.documentIr.pages;

  const hasPageLocators = pages.some((page) =>
    page.blocks.some((block) => block.locator?.pageNumber !== undefined)
  );
  const hasTableLocators = pages.some((page) =>
    page.blocks.some((block) => block.locator?.tableIndex !== undefined)
  );

  return {
    locatorQuality: {
      hasPageLocators,
      hasTableLocators,
    },
  };
}

/**
 * Canonical locator_quality axis status (Phase 3-H-2 M3).
 * `hasTableLocators` is warning-only: missing table locators never fail the axis alone.
 */
export function evalLocatorQualityAxisStatus(
  result: Pick<ConversionEvalResult, 'locatorQuality'>,
  stage: ConversionEvalStage
): AxisRollupStatus {
  if (!isAxisMeasuredAtStage('locator_quality', stage)) {
    return 'pass';
  }

  const { hasPageLocators, hasTableLocators } = result.locatorQuality;
  if (!hasPageLocators) {
    return 'fail';
  }
  if (!hasTableLocators) {
    return 'warn';
  }
  return 'pass';
}

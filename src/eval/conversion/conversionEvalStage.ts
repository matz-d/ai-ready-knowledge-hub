import { z } from 'zod';

/**
 * Evaluator maturity (Phase 3-E §10.5, Phase 3-H §7.2).
 * Passed to axis rollup functions; not stored on {@link ConversionEvalResult}.
 */
export const ConversionEvalStageSchema = z.enum([
  'health',
  'heuristic',
  'golden',
]);

export type ConversionEvalStage = z.infer<typeof ConversionEvalStageSchema>;

/** Snake_case axis ids used in rollup `reasons` (Phase 3-E §10.6). */
export const ConversionEvalAxisIdSchema = z.enum([
  'schema_validity',
  'coverage',
  'locator_quality',
  'semantic_retention',
  'safety_readiness',
  'context_package_readiness',
]);

export type ConversionEvalAxisId = z.infer<typeof ConversionEvalAxisIdSchema>;

/** Blocker axes for overall.status rollup (Phase 3-E §10.6 案B). */
export const CONVERSION_EVAL_BLOCKER_AXES = [
  'schema_validity',
  'safety_readiness',
] as const satisfies readonly ConversionEvalAxisId[];

export type ConversionEvalBlockerAxis =
  (typeof CONVERSION_EVAL_BLOCKER_AXES)[number];

/**
 * Axes whose metrics are produced at each maturity stage.
 * `safety_readiness` is measured from heuristic onward but rollup stays `pass` at health
 * (Phase 3-H §7.3).
 */
export const CONVERSION_EVAL_AXES_MEASURED_BY_STAGE: Record<
  ConversionEvalStage,
  readonly ConversionEvalAxisId[]
> = {
  health: ['schema_validity', 'context_package_readiness'],
  heuristic: [
    'schema_validity',
    'context_package_readiness',
    'coverage',
    'locator_quality',
    'safety_readiness',
  ],
  golden: [
    'schema_validity',
    'context_package_readiness',
    'coverage',
    'locator_quality',
    'safety_readiness',
    'semantic_retention',
  ],
};

/** Golden-stage-only metric fields on {@link ConversionEvalResult} (Phase 3-E §10.4). */
export const CONVERSION_EVAL_GOLDEN_ONLY_PATHS = [
  'locatorQuality.locatorAccuracy',
  'semanticRetention.keyFieldRecall',
  'safetyReadiness.piiDetectionRecall',
] as const;

export function isAxisMeasuredAtStage(
  axis: ConversionEvalAxisId,
  stage: ConversionEvalStage
): boolean {
  return CONVERSION_EVAL_AXES_MEASURED_BY_STAGE[stage].includes(axis);
}

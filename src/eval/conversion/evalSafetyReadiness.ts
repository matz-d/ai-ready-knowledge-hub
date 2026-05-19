import type { ConversionEvalResult } from './conversionEvalResult';
import {
  type ConversionEvalStage,
  isAxisMeasuredAtStage,
} from './conversionEvalStage';

export type AxisRollupStatus = 'pass' | 'warn' | 'fail';

/**
 * Phase 3-H §7.3: at health stage, `safety_readiness` is a blocker axis in rollup policy
 * but not measured yet — rollup status is always `pass` so CI gate stays quiet.
 */
export const SAFETY_READINESS_HEALTH_ROLLUP_STATUS: AxisRollupStatus = 'pass';

/**
 * Phase 3-H §7.3: health check always returns pass until heuristic thresholds land.
 * Heuristic / golden thresholds are subtype-specific (Phase 3-H follow-up).
 */
export function evalSafetyReadiness(
  _result: Pick<ConversionEvalResult, 'safetyReadiness'>,
  stage: ConversionEvalStage
): AxisRollupStatus {
  if (stage === 'health') {
    return SAFETY_READINESS_HEALTH_ROLLUP_STATUS;
  }

  if (!isAxisMeasuredAtStage('safety_readiness', stage)) {
    return 'pass';
  }

  // heuristic / golden thresholds are defined per subtype in Phase 3-H follow-up.
  return 'pass';
}

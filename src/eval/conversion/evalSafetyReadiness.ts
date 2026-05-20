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
export const SAFETY_READINESS_MAX_UNMASKABLE_PII_FINDINGS = 0;
export const SAFETY_READINESS_MIN_MASKABLE_CHUNK_RATE = 0;

/**
 * Phase 3-H §7.3: health check always returns pass until heuristic thresholds land.
 * Heuristic / golden thresholds are subtype-specific (Phase 3-H follow-up).
 */
export function evalSafetyReadiness(
  result: Pick<ConversionEvalResult, 'safetyReadiness'>,
  stage: ConversionEvalStage
): AxisRollupStatus {
  if (stage === 'health') {
    return SAFETY_READINESS_HEALTH_ROLLUP_STATUS;
  }

  if (!isAxisMeasuredAtStage('safety_readiness', stage)) {
    return 'pass';
  }

  if (
    result.safetyReadiness.unmaskablePiiFindings >
    SAFETY_READINESS_MAX_UNMASKABLE_PII_FINDINGS
  ) {
    return 'fail';
  }
  if (
    result.safetyReadiness.maskableChunkRate <
    SAFETY_READINESS_MIN_MASKABLE_CHUNK_RATE
  ) {
    return 'warn';
  }

  return 'pass';
}

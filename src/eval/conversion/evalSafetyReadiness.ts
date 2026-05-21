import type { ConversionEvalResult } from './conversionEvalResult';
import {
  type ConversionEvalStage,
  isAxisMeasuredAtStage,
} from './conversionEvalStage';
import type { DocumentSourceSubtype } from './documentIr';

export type AxisRollupStatus = 'pass' | 'warn' | 'fail';

/**
 * Phase 3-H §7.3: at health stage, `safety_readiness` is a blocker axis in rollup policy
 * but not measured yet — rollup status is always `pass` so CI gate stays quiet.
 */
export const SAFETY_READINESS_HEALTH_ROLLUP_STATUS: AxisRollupStatus = 'pass';
export const SAFETY_READINESS_MAX_UNMASKABLE_PII_FINDINGS = 0;
export const SAFETY_READINESS_MIN_MASKABLE_CHUNK_RATE = 0;

/**
 * Phase 3-H §7.3 / D-P3-H-7 Q2: health always pass; heuristic/golden threshold is subtype-aware.
 *
 * Scan-pdf policy: `unmaskablePiiFindings > 0` downgrades to `warn` rather than `fail`.
 * OCR image artifacts produce DLP findings that cannot be localized to maskable chunks;
 * treating them as upload-blockers would reject every scanned document with embedded images.
 * Official-doc-pdf and slide-pdf retain the original `fail` policy.
 */
export function evalSafetyReadiness(
  result: Pick<ConversionEvalResult, 'safetyReadiness'>,
  stage: ConversionEvalStage,
  sourceSubtype?: DocumentSourceSubtype
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
    return sourceSubtype === 'scan-pdf' ? 'warn' : 'fail';
  }
  if (
    result.safetyReadiness.maskableChunkRate <
    SAFETY_READINESS_MIN_MASKABLE_CHUNK_RATE
  ) {
    return 'warn';
  }

  return 'pass';
}

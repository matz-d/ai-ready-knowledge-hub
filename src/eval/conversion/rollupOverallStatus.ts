import type { ConversionEvalResult } from './conversionEvalResult';
import {
  evalSafetyReadiness,
  type AxisRollupStatus,
} from './evalSafetyReadiness';
import type { ConversionEvalStage } from './conversionEvalStage';

export type ConversionEvalAxisStatuses = {
  schemaValidity: AxisRollupStatus;
  safetyReadiness: AxisRollupStatus;
  coverage: AxisRollupStatus;
  locatorQuality: AxisRollupStatus;
  semanticRetention: AxisRollupStatus;
  contextPackageReadiness: AxisRollupStatus;
};

export function evalSchemaValidity(
  result: Pick<ConversionEvalResult, 'schemaValidity'>
): AxisRollupStatus {
  if (!result.schemaValidity.passed) {
    return 'fail';
  }
  if (result.schemaValidity.errors.length > 0) {
    return 'warn';
  }
  return 'pass';
}

export function evalContextPackageReadiness(
  result: Pick<ConversionEvalResult, 'contextPackageReadiness'>
): AxisRollupStatus {
  const { oversizedChunks, emptyChunks, chunkCount } =
    result.contextPackageReadiness;
  if (oversizedChunks > 0 || emptyChunks > 0) {
    return 'fail';
  }
  if (chunkCount === 0) {
    return 'warn';
  }
  return 'pass';
}

/** Non-blocker axes: stubs return pass until subtype-specific thresholds exist. */
export function collectNonBlockerFails(
  result: ConversionEvalResult
): string[] {
  const fails: string[] = [];
  if (evalContextPackageReadiness(result) === 'fail') {
    fails.push('context_package_readiness');
  }
  return fails;
}

export function deriveAxisStatuses(
  result: ConversionEvalResult,
  stage: ConversionEvalStage
): ConversionEvalAxisStatuses {
  return {
    schemaValidity: evalSchemaValidity(result),
    safetyReadiness: evalSafetyReadiness(result, stage),
    coverage: 'pass',
    locatorQuality: 'pass',
    semanticRetention: 'pass',
    contextPackageReadiness: evalContextPackageReadiness(result),
  };
}

/**
 * Phase 3-E §10.6案B: blocker axes are schema_validity and safety_readiness.
 */
export function rollupOverallStatus(
  result: ConversionEvalResult,
  stage: ConversionEvalStage
): Pick<ConversionEvalResult['overall'], 'status' | 'reasons'> {
  const axes = deriveAxisStatuses(result, stage);
  const schema = axes.schemaValidity;
  const safety = axes.safetyReadiness;
  const nonBlockerFails = collectNonBlockerFails(result);

  const reasons: string[] = [];

  if (schema === 'fail') reasons.push('schema_validity: fail');
  if (safety === 'fail') reasons.push('safety_readiness: fail');
  if (schema === 'fail' || safety === 'fail') {
    return { status: 'fail', reasons };
  }

  if (schema === 'warn') reasons.push('schema_validity: warn');
  if (safety === 'warn') reasons.push('safety_readiness: warn');

  for (const axis of nonBlockerFails) {
    reasons.push(`${axis}: fail (downgraded to warn)`);
  }

  if (reasons.length > 0) {
    return { status: 'warn', reasons };
  }
  return { status: 'pass', reasons: [] };
}

export function attachOverallStatus(
  result: ConversionEvalResult,
  stage: ConversionEvalStage
): ConversionEvalResult {
  return {
    ...result,
    overall: rollupOverallStatus(result, stage),
  };
}

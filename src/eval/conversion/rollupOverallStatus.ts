import type { ConversionEvalResult } from './conversionEvalResult';
import type { ConversionEvalStage } from './conversionEvalStage';
import {
  evalCoverageAxisStatus,
  evalLocatorQualityAxisStatus,
} from './heuristic';
import {
  evalSafetyReadiness,
  type AxisRollupStatus,
} from './evalSafetyReadiness';

export type ConversionEvalAxisStatuses = {
  schemaValidity: AxisRollupStatus;
  safetyReadiness: AxisRollupStatus;
  coverage: AxisRollupStatus;
  locatorQuality: AxisRollupStatus;
  semanticRetention: AxisRollupStatus;
  contextPackageReadiness: AxisRollupStatus;
};

/** CI / PR comment matrix keys (snake_case axis ids). */
export type HeuristicCiAxisStatuses = {
  coverage: AxisRollupStatus;
  locator_quality: AxisRollupStatus;
  safety_readiness: AxisRollupStatus;
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

/** Non-blocker axes that downgrade overall to warn when they fail. */
export function collectNonBlockerFails(
  result: ConversionEvalResult,
  stage: ConversionEvalStage
): string[] {
  const axes = deriveAxisStatuses(result, stage);
  const fails: string[] = [];

  if (axes.contextPackageReadiness === 'fail') {
    fails.push('context_package_readiness');
  }
  if (axes.coverage === 'fail') {
    fails.push('coverage');
  }
  if (axes.locatorQuality === 'fail') {
    fails.push('locator_quality');
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
    coverage: evalCoverageAxisStatus(result, stage),
    locatorQuality: evalLocatorQualityAxisStatus(result, stage),
    semanticRetention: 'pass',
    contextPackageReadiness: evalContextPackageReadiness(result),
  };
}

/**
 * Subset of {@link deriveAxisStatuses} for heuristic-stage CI reports and PR comments.
 */
export function toHeuristicCiAxisStatuses(
  result: ConversionEvalResult
): HeuristicCiAxisStatuses {
  const axes = deriveAxisStatuses(result, 'heuristic');
  return {
    coverage: axes.coverage,
    locator_quality: axes.locatorQuality,
    safety_readiness: axes.safetyReadiness,
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
  const nonBlockerFails = collectNonBlockerFails(result, stage);

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

import { describe, expect, it } from 'vitest';
import { createEmptyConversionEvalResult } from '../../conversionEvalResult';
import {
  COVERAGE_PAGE_COVERAGE_PASS_THRESHOLD,
  COVERAGE_PAGE_COVERAGE_WARN_THRESHOLD,
  evalCoverageAxisStatus,
} from '../evalCoverage';
import { evalLocatorQualityAxisStatus } from '../evalLocatorQuality';
import {
  collectNonBlockerFails,
  deriveAxisStatuses,
  rollupOverallStatus,
  toHeuristicCiAxisStatuses,
} from '../../rollupOverallStatus';

describe('evalCoverageAxisStatus', () => {
  it('returns pass at health stage regardless of pageCoverage', () => {
    const result = createEmptyConversionEvalResult();
    result.coverage.pageCoverage = 0;
    expect(evalCoverageAxisStatus(result, 'health')).toBe('pass');
  });

  it('maps pageCoverage thresholds at heuristic stage', () => {
    const result = createEmptyConversionEvalResult();
    result.coverage.pageCoverage = COVERAGE_PAGE_COVERAGE_PASS_THRESHOLD;
    expect(evalCoverageAxisStatus(result, 'heuristic')).toBe('pass');

    result.coverage.pageCoverage = COVERAGE_PAGE_COVERAGE_WARN_THRESHOLD;
    expect(evalCoverageAxisStatus(result, 'heuristic')).toBe('warn');

    result.coverage.pageCoverage = COVERAGE_PAGE_COVERAGE_WARN_THRESHOLD - 0.01;
    expect(evalCoverageAxisStatus(result, 'heuristic')).toBe('fail');
  });

  it('does not fail when textDensityWarnings are present', () => {
    const result = createEmptyConversionEvalResult();
    result.coverage.pageCoverage = 1;
    result.coverage.textDensityWarnings = ['page 3: low text density'];
    expect(evalCoverageAxisStatus(result, 'heuristic')).toBe('pass');
  });
});

describe('evalLocatorQualityAxisStatus', () => {
  it('returns pass at health stage', () => {
    const result = createEmptyConversionEvalResult();
    result.locatorQuality.hasPageLocators = false;
    expect(evalLocatorQualityAxisStatus(result, 'health')).toBe('pass');
  });

  it('maps page/table locator presence at heuristic stage', () => {
    const result = createEmptyConversionEvalResult();
    result.locatorQuality.hasPageLocators = false;
    result.locatorQuality.hasTableLocators = false;
    expect(evalLocatorQualityAxisStatus(result, 'heuristic')).toBe('fail');

    result.locatorQuality.hasPageLocators = true;
    result.locatorQuality.hasTableLocators = false;
    expect(evalLocatorQualityAxisStatus(result, 'heuristic')).toBe('warn');

    result.locatorQuality.hasTableLocators = true;
    expect(evalLocatorQualityAxisStatus(result, 'heuristic')).toBe('pass');
  });
});

describe('rollup integration (heuristic axes)', () => {
  it('downgrades coverage fail to overall warn', () => {
    const result = createEmptyConversionEvalResult();
    result.coverage.pageCoverage = 0.5;
    result.locatorQuality.hasPageLocators = true;
    result.locatorQuality.hasTableLocators = true;
    result.safetyReadiness.unmaskablePiiFindings = 0;

    expect(deriveAxisStatuses(result, 'heuristic').coverage).toBe('fail');
    expect(collectNonBlockerFails(result, 'heuristic')).toContain('coverage');
    expect(rollupOverallStatus(result, 'heuristic')).toEqual({
      status: 'warn',
      reasons: ['coverage: fail (downgraded to warn)'],
    });
  });

  it('downgrades locator_quality fail to overall warn', () => {
    const result = createEmptyConversionEvalResult();
    result.coverage.pageCoverage = 1;
    result.locatorQuality.hasPageLocators = false;
    result.safetyReadiness.unmaskablePiiFindings = 0;

    expect(rollupOverallStatus(result, 'heuristic')).toEqual({
      status: 'warn',
      reasons: ['locator_quality: fail (downgraded to warn)'],
    });
  });

  it('toHeuristicCiAxisStatuses matches deriveAxisStatuses subset', () => {
    const result = createEmptyConversionEvalResult();
    result.coverage.pageCoverage = COVERAGE_PAGE_COVERAGE_WARN_THRESHOLD;
    result.locatorQuality.hasPageLocators = true;
    result.locatorQuality.hasTableLocators = false;

    const axes = deriveAxisStatuses(result, 'heuristic');
    expect(toHeuristicCiAxisStatuses(result)).toEqual({
      coverage: axes.coverage,
      locator_quality: axes.locatorQuality,
      safety_readiness: axes.safetyReadiness,
    });
  });
});

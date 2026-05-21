/**
 * Phase 3-H-2 §6.3 heuristic stage entry point.
 *
 * These functions encode the M3 thresholds for subtype-1 (`official-doc-pdf`).
 * Metric extractors (`evalCoverage`, `evalLocatorQuality`, …) pair with axis
 * status helpers (`evalCoverageAxisStatus`, `evalLocatorQualityAxisStatus`) used
 * by `rollupOverallStatus` and CI reports.
 */
export {
  evalCoverage,
  evalCoverageAxisStatus,
  COVERAGE_PAGE_COVERAGE_PASS_THRESHOLD,
  COVERAGE_PAGE_COVERAGE_WARN_THRESHOLD,
  LOW_DENSITY_PAGE_CHAR_THRESHOLD,
  type EvalCoverageOptions,
} from './evalCoverage';
export {
  evalLocatorQuality,
  evalLocatorQualityAxisStatus,
} from './evalLocatorQuality';
export { evalContextPackageReadiness } from './evalContextPackageReadiness';
export {
  evalSafetyReadinessHeuristic,
  SAFETY_READINESS_DRY_RUN_RESULT,
  type EvalSafetyReadinessHeuristicOptions,
  type SafetyReadinessEvalChunk,
} from './evalSafetyReadinessHeuristic';
export {
  runConversionEvalHeuristic,
  type ConversionEvalHeuristicInput,
} from './runConversionEvalHeuristic';
export type {
  HeuristicEvalChunk,
  HeuristicEvalInput,
  HeuristicEvalPartial,
} from './types';

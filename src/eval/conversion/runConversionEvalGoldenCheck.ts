import {
  assertConversionEvalResultStageShape,
  createEmptyConversionEvalResult,
  type ConversionEvalResult,
} from './conversionEvalResult';
import type { ConversionEvalStage } from './conversionEvalStage';
import type { DocumentSourceSubtype } from './documentIr';
import { evalSemanticRetention } from './golden/evalSemanticRetention';
import {
  evalContextPackageReadiness,
  evalCoverage,
  evalLocatorQuality,
  evalSafetyReadinessHeuristic,
  type EvalSafetyReadinessHeuristicOptions,
  type HeuristicEvalChunk,
  type SafetyReadinessEvalChunk,
} from './heuristic';
import { attachOverallStatus } from './rollupOverallStatus';

/** Subtype 1 + 2 golden eval (Phase 3-H-2 §7). */
export const GOLDEN_CHECK_SUPPORTED_SUBTYPES = [
  'official-doc-pdf',
  'slide-pdf',
] as const satisfies readonly DocumentSourceSubtype[];

export type GoldenCheckSupportedSubtype =
  (typeof GOLDEN_CHECK_SUPPORTED_SUBTYPES)[number];

export type ConversionEvalGoldenCheckInput<
  TChunk extends SafetyReadinessEvalChunk = SafetyReadinessEvalChunk,
> = {
  sourceSubtype: DocumentSourceSubtype;
  documentIr: Parameters<typeof evalCoverage>[0]['documentIr'];
  chunks: readonly TChunk[];
  expectedFields: readonly string[];
  schemaValidity?: {
    passed?: boolean;
    errors?: readonly string[];
  };
  /**
   * Defaults to `{ dryRun: true }` so golden checks never call Cloud DLP unless
   * a caller explicitly opts in (Phase 3-H-2 M4 scope).
   */
  safetyReadinessOptions?: EvalSafetyReadinessHeuristicOptions;
};

const GOLDEN_CHECK_STAGE = 'golden' satisfies ConversionEvalStage;

function assertGoldenSubtypeSupported(sourceSubtype: DocumentSourceSubtype): void {
  if (
    !(GOLDEN_CHECK_SUPPORTED_SUBTYPES as readonly string[]).includes(
      sourceSubtype
    )
  ) {
    throw new Error(
      `golden check runner supports subtypes ${GOLDEN_CHECK_SUPPORTED_SUBTYPES.join(', ')} only: received "${sourceSubtype}"`
    );
  }
}

/**
 * Golden-stage runner: heuristic metrics + semantic retention recall.
 * Cloud DLP is skipped by default (`safetyReadinessOptions.dryRun === true`).
 */
export async function runConversionEvalGoldenCheck<
  TChunk extends HeuristicEvalChunk & SafetyReadinessEvalChunk,
>(input: ConversionEvalGoldenCheckInput<TChunk>): Promise<ConversionEvalResult> {
  assertGoldenSubtypeSupported(input.sourceSubtype);

  const base = createEmptyConversionEvalResult();
  const shared = { documentIr: input.documentIr, chunks: input.chunks };
  const safetyOptions: EvalSafetyReadinessHeuristicOptions = {
    dryRun: true,
    ...input.safetyReadinessOptions,
  };

  const result: ConversionEvalResult = {
    ...base,
    schemaValidity: {
      passed: input.schemaValidity?.passed ?? true,
      errors: [...(input.schemaValidity?.errors ?? [])],
    },
    ...evalCoverage(shared),
    ...evalLocatorQuality(shared),
    ...evalContextPackageReadiness(shared),
    ...(await evalSafetyReadinessHeuristic(shared, safetyOptions)),
    ...evalSemanticRetention({
      chunks: input.chunks,
      expectedFields: input.expectedFields,
    }),
  };

  assertConversionEvalResultStageShape(result, GOLDEN_CHECK_STAGE);
  return attachOverallStatus(result, GOLDEN_CHECK_STAGE, input.sourceSubtype);
}

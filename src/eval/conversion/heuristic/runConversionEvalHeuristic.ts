import {
  assertConversionEvalResultStageShape,
  createEmptyConversionEvalResult,
  type ConversionEvalResult,
} from '../conversionEvalResult';
import { attachOverallStatus } from '../rollupOverallStatus';
import { evalContextPackageReadiness } from './evalContextPackageReadiness';
import { evalCoverage } from './evalCoverage';
import { evalLocatorQuality } from './evalLocatorQuality';
import {
  evalSafetyReadinessHeuristic,
  type EvalSafetyReadinessHeuristicOptions,
  type SafetyReadinessEvalChunk,
} from './evalSafetyReadinessHeuristic';
import type { HeuristicEvalInput } from './types';

export type ConversionEvalHeuristicInput<
  TChunk extends SafetyReadinessEvalChunk = SafetyReadinessEvalChunk,
> = HeuristicEvalInput<TChunk> & {
  schemaValidity?: {
    passed?: boolean;
    errors?: readonly string[];
  };
  safetyReadinessOptions?: EvalSafetyReadinessHeuristicOptions;
};

export async function runConversionEvalHeuristic<
  TChunk extends SafetyReadinessEvalChunk,
>(input: ConversionEvalHeuristicInput<TChunk>): Promise<ConversionEvalResult> {
  const base = createEmptyConversionEvalResult();
  const shared = { documentIr: input.documentIr, chunks: input.chunks };
  const sourceSubtype = input.documentIr.source.sourceSubtype;
  const result: ConversionEvalResult = {
    ...base,
    schemaValidity: {
      passed: input.schemaValidity?.passed ?? true,
      errors: [...(input.schemaValidity?.errors ?? [])],
    },
    ...evalCoverage(shared),
    ...evalLocatorQuality(shared),
    ...evalContextPackageReadiness(shared),
    ...(await evalSafetyReadinessHeuristic(
      shared,
      input.safetyReadinessOptions
    )),
  };

  assertConversionEvalResultStageShape(result, 'heuristic');
  return attachOverallStatus(result, 'heuristic', sourceSubtype);
}

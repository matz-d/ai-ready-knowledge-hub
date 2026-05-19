import { z } from 'zod';
import {
  ConversionEvalStageSchema,
  type ConversionEvalStage,
} from './conversionEvalStage';

/**
 * Document Conversion Eval result shape (Phase 3-E §10.4).
 * Thresholds and per-axis fail/warn functions are filled in during Phase 3-H.
 */

export const ConversionEvalOverallStatusSchema = z.enum([
  'pass',
  'warn',
  'fail',
]);

export type ConversionEvalOverallStatus = z.infer<
  typeof ConversionEvalOverallStatusSchema
>;

export const SchemaValiditySchema = z.object({
  passed: z.boolean(),
  errors: z.array(z.string()),
});

export const CoverageSchema = z.object({
  pageCoverage: z.number().min(0),
  textDensityWarnings: z.array(z.string()),
  tableCandidates: z.number().int().nonnegative(),
});

export const LocatorQualitySchema = z.object({
  hasPageLocators: z.boolean(),
  hasTableLocators: z.boolean(),
  /** Golden eval only (Phase 3-E §10.3). */
  locatorAccuracy: z.number().min(0).max(1).optional(),
});

export const SemanticRetentionSchema = z.object({
  /** Golden eval only. */
  keyFieldRecall: z.number().min(0).max(1).optional(),
  missingExpectedFields: z.array(z.string()),
});

export const SafetyReadinessSchema = z.object({
  /** Golden eval only: recall of PII spans Masker should catch. */
  piiDetectionRecall: z.number().min(0).max(1).optional(),
  unmaskablePiiFindings: z.number().int().nonnegative(),
  maskableChunkRate: z.number().min(0).max(1),
});

export const ContextPackageReadinessSchema = z.object({
  chunkCount: z.number().int().nonnegative(),
  averageChunkLength: z.number().nonnegative(),
  oversizedChunks: z.number().int().nonnegative(),
  emptyChunks: z.number().int().nonnegative(),
});

export const ConversionEvalOverallSchema = z.object({
  status: ConversionEvalOverallStatusSchema,
  reasons: z.array(z.string()),
});

export const ConversionEvalResultSchema = z.object({
  schemaValidity: SchemaValiditySchema,
  coverage: CoverageSchema,
  locatorQuality: LocatorQualitySchema,
  semanticRetention: SemanticRetentionSchema,
  safetyReadiness: SafetyReadinessSchema,
  contextPackageReadiness: ContextPackageReadinessSchema,
  overall: ConversionEvalOverallSchema,
});

export type ConversionEvalResult = z.infer<typeof ConversionEvalResultSchema>;

/** Health-stage defaults: safety metrics unset; rollup forced to pass (Phase 3-H §7.3). */
export const SAFETY_READINESS_HEALTH_STAGE_DEFAULTS: Pick<
  ConversionEvalResult['safetyReadiness'],
  'unmaskablePiiFindings' | 'maskableChunkRate'
> = {
  unmaskablePiiFindings: 0,
  maskableChunkRate: 1,
};

export function createEmptyConversionEvalResult(): ConversionEvalResult {
  return ConversionEvalResultSchema.parse({
    schemaValidity: { passed: true, errors: [] },
    coverage: {
      pageCoverage: 0,
      textDensityWarnings: [],
      tableCandidates: 0,
    },
    locatorQuality: {
      hasPageLocators: false,
      hasTableLocators: false,
    },
    semanticRetention: {
      missingExpectedFields: [],
    },
    safetyReadiness: {
      ...SAFETY_READINESS_HEALTH_STAGE_DEFAULTS,
    },
    contextPackageReadiness: {
      chunkCount: 0,
      averageChunkLength: 0,
      oversizedChunks: 0,
      emptyChunks: 0,
    },
    overall: { status: 'pass', reasons: [] },
  });
}

export function parseConversionEvalResult(input: unknown): ConversionEvalResult {
  return ConversionEvalResultSchema.parse(input);
}

export function safeParseConversionEvalResult(
  input: unknown
): z.SafeParseReturnType<unknown, ConversionEvalResult> {
  return ConversionEvalResultSchema.safeParse(input);
}

/**
 * Ensures golden-only optional fields are absent before heuristic/health persistence.
 * Does not validate metric thresholds.
 */
export function assertConversionEvalResultStageShape(
  result: ConversionEvalResult,
  stage: ConversionEvalStage
): void {
  ConversionEvalStageSchema.parse(stage);

  if (stage === 'golden') {
    return;
  }

  const violations: string[] = [];
  if (result.locatorQuality.locatorAccuracy !== undefined) {
    violations.push('locatorQuality.locatorAccuracy');
  }
  if (result.semanticRetention.keyFieldRecall !== undefined) {
    violations.push('semanticRetention.keyFieldRecall');
  }
  if (result.safetyReadiness.piiDetectionRecall !== undefined) {
    violations.push('safetyReadiness.piiDetectionRecall');
  }

  if (violations.length > 0) {
    throw new Error(
      `ConversionEvalResult fields reserved for golden eval must be omitted at stage "${stage}": ${violations.join(', ')}`
    );
  }
}

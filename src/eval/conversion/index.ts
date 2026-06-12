export {
  assertConversionEvalResultStageShape,
  ContextPackageReadinessSchema,
  ConversionEvalOverallSchema,
  ConversionEvalOverallStatusSchema,
  ConversionEvalResultSchema,
  CoverageSchema,
  createEmptyConversionEvalResult,
  LocatorQualitySchema,
  parseConversionEvalResult,
  safeParseConversionEvalResult,
  SAFETY_READINESS_HEALTH_STAGE_DEFAULTS,
  SafetyReadinessSchema,
  SchemaValiditySchema,
  SemanticRetentionSchema,
  type ConversionEvalOverallStatus,
  type ConversionEvalResult,
} from './conversionEvalResult';
export {
  CONVERSION_EVAL_AXES_MEASURED_BY_STAGE,
  CONVERSION_EVAL_BLOCKER_AXES,
  CONVERSION_EVAL_GOLDEN_ONLY_PATHS,
  ConversionEvalAxisIdSchema,
  ConversionEvalStageSchema,
  isAxisMeasuredAtStage,
  type ConversionEvalAxisId,
  type ConversionEvalBlockerAxis,
  type ConversionEvalStage,
} from './conversionEvalStage';
export {
  DOCUMENT_IR_BLOCK_KINDS_WITH_CHUNK_MAPPING,
  DOCUMENT_IR_SCHEMA_VERSION,
  DocumentBlockKindSchema,
  DocumentIrBlockSchema,
  DocumentIrLocatorSchema,
  DocumentIrPageSchema,
  DocumentIrSchema,
  DocumentIrSourceSchema,
  DocumentSourceKindSchema,
  DocumentSourceSubtypeSchema,
  documentSourceSubtypeToKnowledgeChunkSourceType,
  parseDocumentIr,
  safeParseDocumentIr,
  type DocumentBlockKind,
  type DocumentIR,
  type DocumentIr,
  type DocumentIrBlock,
  type DocumentIrLocator,
  type DocumentIrPage,
  type DocumentSourceKind,
  type DocumentSourceSubtype,
} from './documentIr';
/**
 * @deprecated Import from `src/lib/conversion/documentIrToKnowledgeChunk` instead.
 */
export {
  buildPdfParagraphId,
  documentIrBlockToStructureType,
  documentIrToKnowledgeChunks,
  type DocumentIrToKnowledgeChunkOptions,
} from '../../lib/conversion/documentIrToKnowledgeChunk';
export {
  evalSafetyReadiness,
  SAFETY_READINESS_HEALTH_ROLLUP_STATUS,
  type AxisRollupStatus,
} from './evalSafetyReadiness';
export {
  attachOverallStatus,
  collectNonBlockerFails,
  deriveAxisStatuses,
  evalContextPackageReadiness,
  evalSchemaValidity,
  rollupOverallStatus,
  toHeuristicCiAxisStatuses,
  type ConversionEvalAxisStatuses,
  type HeuristicCiAxisStatuses,
} from './rollupOverallStatus';
export {
  evalCoverageAxisStatus,
  evalLocatorQualityAxisStatus,
} from './heuristic';
export {
  HEALTH_CHECK_SUPPORTED_SUBTYPE,
  HEALTH_CHECK_SUPPORTED_SUBTYPES,
  type HealthCheckSupportedSubtype,
  runConversionEvalHealthCheck,
  type ConversionEvalHealthCheckChunk,
  type ConversionEvalHealthCheckInput,
} from './runConversionEvalHealthCheck';
export {
  GOLDEN_CHECK_SUPPORTED_SUBTYPES,
  runConversionEvalGoldenCheck,
  type ConversionEvalGoldenCheckInput,
  type GoldenCheckSupportedSubtype,
} from './runConversionEvalGoldenCheck';
export {
  evalSemanticRetention,
  normalizeForSubstringMatch,
  type EvalSemanticRetentionInput,
  type SemanticRetentionEvalChunk,
} from './golden';
export {
  buildP1dQualityReport,
  evaluateP1dFixture,
  listFailedDeterministicZeroChecks,
  P1D_CI_BLOCKER_METRICS,
  P1D_QUALITY_REPORT_SCHEMA_VERSION,
  P1dExpectedFixtureSchema,
  type P1dChunkReadiness,
  type P1dEvalChunk,
  type P1dExpectedFixture,
  type P1dExpectedTableCell,
  type P1dExpectedValue,
  type P1dFixtureInput,
  type P1dFixtureQualityResult,
  type P1dLocatorCoverage,
  type P1dMeasuredRatio,
  type P1dQualityReport,
  type P1dSafetyObservations,
  type P1dSkippedFixture,
} from './p1dQualityGate';
export {
  buildP1dMixedPdfHandoffCases,
  classifyP1dMixedPdfExtraction,
  DEFAULT_P1D_MIXED_PDF_MAX_CHUNKS,
  P1D_MIXED_PDF_CHECK_SCHEMA_VERSION,
  P1dMixedPdfExtractionStatusSchema,
  P1dMixedPdfFailureReasonSchema,
  type P1dMixedPdfClassification,
  type P1dMixedPdfClassificationInput,
  type P1dMixedPdfExtractionStatus,
  type P1dMixedPdfFailureReason,
  type P1dMixedPdfHandoffCase,
} from './p1dMixedPdfCheck';

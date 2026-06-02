import { MAX_FIRESTORE_CHUNK_DOCUMENT_BYTES } from '../../lib/knowledgeChunkSchema';
import {
  createEmptyConversionEvalResult,
  type ConversionEvalResult,
} from './conversionEvalResult';
import type { ConversionEvalStage } from './conversionEvalStage';
import type { DocumentIr, DocumentSourceSubtype } from './documentIr';
import { evalCoverage } from './heuristic/evalCoverage';
import { evalLocatorQuality } from './heuristic/evalLocatorQuality';
import type { HeuristicEvalChunk } from './heuristic/types';
import { attachOverallStatus } from './rollupOverallStatus';

/** Subtype 1+2 (mainline candidates) and subtype 3 (scan-pdf PoC). */
export const HEALTH_CHECK_SUPPORTED_SUBTYPES = [
  'official-doc-pdf',
  'slide-pdf',
  'scan-pdf',
] as const satisfies readonly DocumentSourceSubtype[];

export type HealthCheckSupportedSubtype =
  (typeof HEALTH_CHECK_SUPPORTED_SUBTYPES)[number];

/** @deprecated Prefer {@link HEALTH_CHECK_SUPPORTED_SUBTYPES} or subtype-specific callers. */
export const HEALTH_CHECK_SUPPORTED_SUBTYPE =
  'official-doc-pdf' satisfies HealthCheckSupportedSubtype;

export type ConversionEvalHealthCheckChunk = HeuristicEvalChunk;

export type ConversionEvalHealthCheckInput<
  TChunk extends ConversionEvalHealthCheckChunk = ConversionEvalHealthCheckChunk,
> = {
  sourceSubtype: DocumentSourceSubtype;
  chunkDrafts: readonly TChunk[];
  documentIr?: DocumentIr;
  schemaValidity: {
    passed: boolean;
    errors?: readonly string[];
  };
};

const HEALTH_CHECK_STAGE = 'health' satisfies ConversionEvalStage;

function countEmptyChunks<TChunk extends ConversionEvalHealthCheckChunk>(
  chunkDrafts: readonly TChunk[]
): number {
  return chunkDrafts.filter((chunk) => chunk.text.trim().length === 0).length;
}

function countOversizedChunks<TChunk extends object>(
  chunkDrafts: readonly TChunk[]
): number {
  return chunkDrafts.filter((chunk) => {
    const bytes = Buffer.byteLength(JSON.stringify(chunk), 'utf8');
    return bytes > MAX_FIRESTORE_CHUNK_DOCUMENT_BYTES;
  }).length;
}

function createEmptyHeuristicDocumentIr(
  sourceSubtype: DocumentSourceSubtype
): DocumentIr {
  return {
    schemaVersion: 1,
    source: {
      fileName: 'health-check-input',
      mediaType: 'application/octet-stream',
      sourceKind: 'poc',
      sourceSubtype,
    },
    pages: [],
  };
}

/**
 * Health-check runner for ConversionEvalResult.
 * Phase 3-H: subtype 1/2 (`official-doc-pdf`/`slide-pdf`) and scan-pdf PoC metrics.
 */
export function runConversionEvalHealthCheck<
  TChunk extends ConversionEvalHealthCheckChunk,
>(input: ConversionEvalHealthCheckInput<TChunk>): ConversionEvalResult {
  if (
    !(HEALTH_CHECK_SUPPORTED_SUBTYPES as readonly string[]).includes(
      input.sourceSubtype
    )
  ) {
    throw new Error(
      `health check runner supports subtypes ${HEALTH_CHECK_SUPPORTED_SUBTYPES.join(', ')} only: received "${input.sourceSubtype}"`
    );
  }

  const chunkCount = input.chunkDrafts.length;
  const totalLength = input.chunkDrafts.reduce(
    (sum, chunk) => sum + chunk.text.length,
    0
  );
  const averageChunkLength = chunkCount === 0 ? 0 : totalLength / chunkCount;
  const emptyChunks = countEmptyChunks(input.chunkDrafts);
  const oversizedChunks = countOversizedChunks(input.chunkDrafts);
  const heuristicInput = {
    documentIr: input.documentIr ?? createEmptyHeuristicDocumentIr(input.sourceSubtype),
    chunks: input.chunkDrafts,
  };
  const coverage = evalCoverage(heuristicInput, {
    sourceSubtype: input.sourceSubtype,
  });
  const locatorQuality = evalLocatorQuality(heuristicInput);

  const base = createEmptyConversionEvalResult();
  const result: ConversionEvalResult = {
    ...base,
    ...coverage,
    ...locatorQuality,
    schemaValidity: {
      passed: input.schemaValidity.passed,
      errors: [...(input.schemaValidity.errors ?? [])],
    },
    contextPackageReadiness: {
      chunkCount,
      averageChunkLength,
      oversizedChunks,
      emptyChunks,
    },
  };

  return attachOverallStatus(result, HEALTH_CHECK_STAGE, input.sourceSubtype);
}

import { MAX_FIRESTORE_CHUNK_DOCUMENT_BYTES } from '../../lib/knowledgeChunkSchema';
import {
  createEmptyConversionEvalResult,
  type ConversionEvalResult,
} from './conversionEvalResult';
import type { ConversionEvalStage } from './conversionEvalStage';
import type { DocumentSourceSubtype } from './documentIr';
import { attachOverallStatus } from './rollupOverallStatus';

export const HEALTH_CHECK_SUPPORTED_SUBTYPE = 'official-doc-pdf' as const;

export type ConversionEvalHealthCheckChunk = {
  text: string;
};

export type ConversionEvalHealthCheckInput<
  TChunk extends ConversionEvalHealthCheckChunk = ConversionEvalHealthCheckChunk,
> = {
  sourceSubtype: DocumentSourceSubtype;
  chunkDrafts: readonly TChunk[];
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

/**
 * Health-check runner for ConversionEvalResult.
 * Phase 3-H scope is subtype 1 (`official-doc-pdf`) only.
 */
export function runConversionEvalHealthCheck<
  TChunk extends ConversionEvalHealthCheckChunk,
>(input: ConversionEvalHealthCheckInput<TChunk>): ConversionEvalResult {
  if (input.sourceSubtype !== HEALTH_CHECK_SUPPORTED_SUBTYPE) {
    throw new Error(
      `health check runner supports subtype "${HEALTH_CHECK_SUPPORTED_SUBTYPE}" only: received "${input.sourceSubtype}"`
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

  const base = createEmptyConversionEvalResult();
  const result: ConversionEvalResult = {
    ...base,
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

  return attachOverallStatus(result, HEALTH_CHECK_STAGE);
}

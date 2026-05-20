/**
 * Heuristic stage: `context_package_readiness` axis (Phase 3-H-2 §6.2).
 *
 * Computes the four chunk-level metrics that decide whether the chunks are
 * shippable to Firestore / a Context Package:
 *  - `chunkCount`
 *  - `averageChunkLength` (chars, not bytes — matches health-stage definition)
 *  - `oversizedChunks` — required `=== 0` (M3 threshold).
 *    Sized by `Buffer.byteLength(JSON.stringify(chunk))` against
 *    {@link MAX_FIRESTORE_CHUNK_DOCUMENT_BYTES}, mirroring
 *    {@link runConversionEvalHealthCheck} so health → heuristic stays
 *    apples-to-apples.
 *  - `emptyChunks` — chunks whose `text` is whitespace-only.
 *
 * The signature is `({ documentIr, chunks }) => Partial<ConversionEvalResult>`
 * for consistency with the other heuristic functions, even though
 * `documentIr` is not consumed here: keeping a uniform shape lets the
 * orchestrator chain `evalCoverage` → `evalLocatorQuality` →
 * `evalContextPackageReadiness` without per-call argument shaping.
 */
import { MAX_FIRESTORE_CHUNK_DOCUMENT_BYTES } from '../../../lib/knowledgeChunkSchema';
import type { ConversionEvalResult } from '../conversionEvalResult';
import type { HeuristicEvalChunk, HeuristicEvalInput } from './types';

export function evalContextPackageReadiness<TChunk extends HeuristicEvalChunk>(
  input: HeuristicEvalInput<TChunk>
): Pick<ConversionEvalResult, 'contextPackageReadiness'> {
  const chunks = input.chunks;
  const chunkCount = chunks.length;

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  const averageChunkLength = chunkCount === 0 ? 0 : totalLength / chunkCount;

  const emptyChunks = chunks.filter(
    (chunk) => chunk.text.trim().length === 0
  ).length;

  const oversizedChunks = chunks.filter((chunk) => {
    const bytes = Buffer.byteLength(JSON.stringify(chunk), 'utf8');
    return bytes > MAX_FIRESTORE_CHUNK_DOCUMENT_BYTES;
  }).length;

  return {
    contextPackageReadiness: {
      chunkCount,
      averageChunkLength,
      oversizedChunks,
      emptyChunks,
    },
  };
}

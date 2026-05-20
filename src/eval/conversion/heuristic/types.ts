/**
 * Shared input/output types for `src/eval/conversion/heuristic/` (Phase 3-H-2 §6).
 *
 * Each heuristic eval function has the same signature shape so the orchestrator
 * can pipe DocumentIR + chunks through them and merge the partials onto the
 * base {@link ConversionEvalResult}.
 */
import type { ConversionEvalResult } from '../conversionEvalResult';
import type { DocumentIr } from '../documentIr';

/**
 * Minimum surface required by heuristic eval functions.
 *
 * - `text`: the chunk's body text (used for empty-chunk / length / density checks).
 * - The object itself is JSON-serialised to estimate Firestore byte size — the
 *   structural type is intentionally permissive so PoC drafts
 *   ({@link DocumentIrToKnowledgeChunkDraft}) and mainline
 *   {@link KnowledgeChunk}s both fit.
 */
export type HeuristicEvalChunk = { text: string } & Record<string, unknown>;

export type HeuristicEvalInput<
  TChunk extends HeuristicEvalChunk = HeuristicEvalChunk,
> = {
  documentIr: DocumentIr;
  chunks: readonly TChunk[];
};

/**
 * Heuristic eval functions return only the axis slices they own, so callers
 * can `Object.assign` / shallow-merge them onto a base
 * {@link ConversionEvalResult} without clobbering unrelated axes.
 */
export type HeuristicEvalPartial = Partial<ConversionEvalResult>;

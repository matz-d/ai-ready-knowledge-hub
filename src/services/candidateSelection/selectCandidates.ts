import type { InventoryDocument } from '../../lib/inventory';
import { classifyInventory } from './classify';
import { generateMissingHints } from './missingHints';
import type { CandidateDoc } from './types';

export type SelectCandidatesOptions = {
  /** Max candidates to return (score desc). Hints are still computed over ALL docs. */
  responseLimit?: number;
  /** Injectable clock for deterministic tests. */
  now?: number;
};

export type SelectCandidatesResult = {
  candidates: CandidateDoc[];
  missingHints: string[];
  /** Total documents classified before applying responseLimit. */
  totalClassified: number;
};

/**
 * Single entry point for the candidate-selection advisory layer (S1).
 *
 * Ordering is significant and intentional:
 *   1. classify ALL inventory documents (sorted by score desc)
 *   2. compute missingHints over the FULL classified set
 *   3. only THEN slice candidates to responseLimit
 *
 * Computing hints before slicing prevents a false "missing" hint when a relevant
 * current/authoritative document sits beyond responseLimit. API routes (S2) should
 * call this rather than wiring classifyInventory + generateMissingHints by hand.
 *
 * Metadata-only: never reads body text, aiSafeContent, maskedText, chunks, GCS, or an LLM.
 */
export function selectCandidates(
  purpose: string,
  docs: InventoryDocument[],
  options: SelectCandidatesOptions = {},
): SelectCandidatesResult {
  const now = options.now ?? Date.now();
  const classified = classifyInventory(purpose, docs, now);
  const missingHints = generateMissingHints(purpose, classified);

  const candidates =
    options.responseLimit !== undefined
      ? classified.slice(0, Math.max(0, options.responseLimit))
      : classified;

  return {
    candidates,
    missingHints,
    totalClassified: classified.length,
  };
}

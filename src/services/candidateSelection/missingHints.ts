import { BusinessDomainEnum } from '../../agents/curator/schema';
import { purposeTerms } from '../strategistOrchestrator/budget';
import { expandTermsWithSynonyms } from './synonyms';
import type { CandidateDoc } from './types';

/**
 * Returns human-readable hints about knowledge gaps for the given purpose.
 *
 * Current heuristic (phase-4-ux-direction.md S1):
 *   For each business domain that the purpose appears to require,
 *   emit a hint if there are zero 'include' candidates that are both
 *   current (freshness==='current') AND authoritative (isAuthoritativeCandidate===true).
 *
 * Deliberately simple — no LLM, no embeddings. A domain is "required by purpose"
 * when the canonical domain appears in the expanded purpose terms or inside the
 * raw Japanese purpose token. We intentionally do not match short fragments in
 * the other direction (e.g. "管理" → every "...管理" domain).
 */
export function generateMissingHints(
  purpose: string,
  candidates: CandidateDoc[],
): string[] {
  const terms = expandTermsWithSynonyms(purposeTerms(purpose));
  const hints: string[] = [];

  for (const domain of BusinessDomainEnum.options) {
    const normalizedDomain = domain.toLowerCase();
    const isRequired = terms.some(
      (term) => term === normalizedDomain || term.includes(normalizedDomain),
    );
    if (!isRequired) continue;

    const hasCurrentAuthoritativeInclude = candidates.some(
      (candidate) =>
        candidate.recommendation === 'include' &&
        candidate.businessDomain === domain &&
        candidate.freshness === 'current' &&
        candidate.isAuthoritativeCandidate === true,
    );
    if (!hasCurrentAuthoritativeInclude) {
      hints.push(`「${domain}」に関する現行の正本文書が見つかりません`);
    }
  }

  if (hints.length === 0 && candidates.filter((c) => c.recommendation === 'include').length === 0) {
    hints.push('この目的に関連する文書が見つかりません。文書を追加してください。');
  }

  return hints;
}

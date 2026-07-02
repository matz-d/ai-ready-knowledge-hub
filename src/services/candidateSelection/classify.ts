import type { InventoryDocument } from '../../lib/inventory';
import { isBlockedForAi, needsMaskerEvaluation } from '../../agents/masker/upgrade';
import { ExclusionReasonLabels } from '../../agents/strategist/schema';
import { evaluateDocumentSupersessionPolicy } from '../documentSupersessionPolicy';
import { purposeTerms } from '../strategistOrchestrator/budget';
import { expandTermsWithSynonyms } from './synonyms';
import { scoreDocumentForPurpose } from './ranking';
import type { CandidateDoc } from './types';

/**
 * Minimum score for a curated/ai_safe document to be recommended as 'include'.
 * 0 = include all safe documents regardless of purpose match (ordered by score desc).
 *
 * Deliberately 0 (not an oversight). Product strategy: during early production we
 * want every classification decision to be *visible* — surface all safe documents
 * with their score/scoreBreakdown so operators can see how the deterministic ranking
 * behaves before we hand more judgment to the system. Once classification is observed
 * to be stable, widen the system's autonomy by raising this threshold (and later,
 * the LLM-recommendation phase per D-P4UX-0). Do not raise it to "clean up" the list
 * without that observation period — low-score inclusion is the intended transparency.
 */
export const INCLUDE_SCORE_THRESHOLD = 0;

/**
 * Classifies a single InventoryDocument against expanded purpose terms.
 *
 * Priority order (from phase-4-ux-direction.md S1):
 *   1. exclude        : isBlockedForAi(doc)                    → restricted_sensitivity
 *   2. needs_review   : needsMaskerEvaluation || maskingPending → masking_required_unavailable
 *   3. needs_review   : freshness === 'superseded_candidate'   → superseded_or_stale (unchecked by default)
 *   4. include        : status ∈ {curated, ai_safe} && score ≥ threshold → with matchReason/scoreBreakdown
 *   4b. needs_review  : status ∈ {curated, ai_safe} && score < threshold → purpose_mismatch (unreachable while threshold === 0)
 *   fallback          : any remaining state                    → human_confirmation_required
 *
 * aiSafeContent is never read here — the authoritative body gate lives in the generation path.
 */
export function classifyDocument(
  doc: InventoryDocument,
  terms: string[],
  now: number = Date.now(),
): CandidateDoc {
  const base = {
    docId: doc.id,
    fileName: doc.fileName,
    documentType: doc.documentType,
    businessDomain: doc.businessDomain,
    sensitivity: doc.sensitivity,
    freshness: doc.freshness,
    isAuthoritativeCandidate: doc.isAuthoritativeCandidate,
    status: doc.status,
    updatedAt: doc.updatedAt,
  } as const;

  // Rule 1: Blocked/Restricted → exclude (score irrelevant)
  if (isBlockedForAi(doc)) {
    return {
      ...base,
      score: 0,
      recommendation: 'exclude',
      reasonCode: 'restricted_sensitivity',
      reasonLabel: ExclusionReasonLabels.restricted_sensitivity,
    };
  }

  // Rule 2: Masking required but not yet completed
  if (needsMaskerEvaluation(doc) || doc.maskingPending === true) {
    const { score, scoreBreakdown } = scoreDocumentForPurpose(doc, terms, now);
    return {
      ...base,
      score,
      scoreBreakdown,
      recommendation: 'needs_review',
      reasonCode: 'masking_required_unavailable',
      reasonLabel: ExclusionReasonLabels.masking_required_unavailable,
      reasonDetail: 'マスキング処理が完了していません。処理完了後に再確認してください。',
    };
  }

  // Rule 3: Superseded / stale (unchecked by default in UI per S0 decision)
  if (doc.freshness === 'superseded_candidate') {
    const { score, scoreBreakdown } = scoreDocumentForPurpose(doc, terms, now);
    return {
      ...base,
      score,
      scoreBreakdown,
      recommendation: 'needs_review',
      reasonCode: 'superseded_or_stale',
      reasonLabel: ExclusionReasonLabels.superseded_or_stale,
      reasonDetail: '現行版より古い可能性があります。内容を確認してから使用してください。',
    };
  }

  // Rule 4: Safe document — include when it clears the relevance threshold.
  if (doc.status === 'curated' || doc.status === 'ai_safe') {
    const { score, scoreBreakdown, matchReason } = scoreDocumentForPurpose(doc, terms, now);
    if (score >= INCLUDE_SCORE_THRESHOLD) {
      return {
        ...base,
        score,
        scoreBreakdown,
        recommendation: 'include',
        matchReason,
      };
    }
    // Safe but below the relevance threshold. This is unreachable while
    // INCLUDE_SCORE_THRESHOLD === 0 (scoring weights are non-negative). If the
    // threshold is raised, update the Phase 4-UX candidate API contract and tests
    // with this purpose_mismatch behavior in the same change.
    return {
      ...base,
      score,
      scoreBreakdown,
      recommendation: 'needs_review',
      reasonCode: 'purpose_mismatch',
      reasonLabel: ExclusionReasonLabels.purpose_mismatch,
      reasonDetail: '目的との関連度が低いと判定されました。必要か確認してください。',
    };
  }

  // Fallback: unexpected status (uploading, curating, failed, etc.)
  const { score, scoreBreakdown } = scoreDocumentForPurpose(doc, terms, now);
  return {
    ...base,
    score,
    scoreBreakdown,
    recommendation: 'needs_review',
    reasonCode: 'human_confirmation_required',
    reasonLabel: ExclusionReasonLabels.human_confirmation_required,
    reasonDetail: '文書の処理状態を確認してください。',
  };
}

/**
 * Classifies all inventory documents for a given purpose.
 * Returns candidates sorted by score descending (ties preserve input order).
 */
export function classifyInventory(
  purpose: string,
  docs: InventoryDocument[],
  now: number = Date.now(),
): CandidateDoc[] {
  const baseTerms = purposeTerms(purpose);
  const terms = expandTermsWithSynonyms(baseTerms);

  const candidates = applyCrossDocumentVersionExclusions(
    docs.map((doc) => classifyDocument(doc, terms, now)),
  );

  // Stable sort: score desc, ties keep input order
  return candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.score - a.c.score || a.i - b.i)
    .map(({ c }) => c);
}

function applyCrossDocumentVersionExclusions(
  candidates: CandidateDoc[],
): CandidateDoc[] {
  const policy = evaluateDocumentSupersessionPolicy(
    candidates
      .filter((candidate) => candidate.recommendation !== 'exclude')
      .map((candidate) => ({
        id: candidate.docId,
        fileName: candidate.fileName,
        freshness: candidate.freshness,
        isAuthoritativeCandidate: candidate.isAuthoritativeCandidate,
        updatedAt: candidate.updatedAt,
        eligibleAsCurrent: candidate.recommendation === 'include',
      })),
  );

  if (policy.superseded.length === 0 && policy.ambiguous.length === 0) {
    return candidates;
  }

  const supersededByDocId = new Map(
    policy.groups.flatMap((group) =>
      group.currentRepresentative
        ? group.superseded.map(
            (member) =>
              [member.document.id, group.currentRepresentative!.document.fileName] as const,
          )
        : [],
    ),
  );
  const ambiguousDocIds = new Set(
    policy.ambiguous.map((member) => member.document.id),
  );

  return candidates.map((candidate) => {
    // Safety-critical needs_review reasons must not be relabeled as mere
    // version supersession. A masking-pending document still carries unmasked
    // PII; that must remain the surfaced blocker even when a newer version
    // exists (mirrors the guard already applied on the ambiguous path below).
    if (candidate.reasonCode === 'masking_required_unavailable') {
      return candidate;
    }
    const strongerFileName = supersededByDocId.get(candidate.docId);
    if (strongerFileName) {
      return {
        ...candidate,
        recommendation: 'exclude',
        reasonCode: 'superseded_or_stale',
        reasonLabel: ExclusionReasonLabels.superseded_or_stale,
        reasonDetail: `より新しい同系統の文書「${strongerFileName}」が候補に存在するため、旧版は AI に渡しません。`,
        matchReason: undefined,
      };
    }
    if (!ambiguousDocIds.has(candidate.docId) || candidate.recommendation !== 'include') {
      return candidate;
    }
    return {
      ...candidate,
      recommendation: 'needs_review',
      reasonCode: 'superseded_or_stale',
      reasonLabel: ExclusionReasonLabels.superseded_or_stale,
      reasonDetail: '同系統の複数版候補があります。最新版を人間が確認してください。',
      matchReason: undefined,
    };
  });
}

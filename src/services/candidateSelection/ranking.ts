import type { InventoryDocument } from '../../lib/inventory';

/**
 * Document-level relevance weights for purpose-driven candidate scoring.
 *
 * These operate on metadata only (no chunk body text) — adapted from the
 * chunk-level weights in strategistOrchestrator/budget.ts for doc-level use.
 * businessDomain gets the highest weight since it's the tightest semantic signal
 * at document granularity.
 */
export const DOC_RELEVANCE_WEIGHTS = {
  /** fileName contains a purpose term */
  fileNameTermHit: 3,
  /** businessDomain contains a purpose term (strongest metadata signal) */
  businessDomainTermHit: 4,
  /** documentType contains a purpose term */
  documentTypeTermHit: 2,
  /** freshness === 'current' */
  freshnessCurrent: 3,
  /** isAuthoritativeCandidate === true */
  authoritative: 2,
  /** recency bonus: 0–2 scaled by age within RECENCY_WINDOW_MS */
  recencyMax: 2,
} as const;

const RECENCY_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isAsciiTerm(term: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(term);
}

function termMatchesText(text: string, term: string): boolean {
  if (!isAsciiTerm(term)) {
    return text.includes(term);
  }
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}([^a-z0-9]|$)`, 'i').test(
    text,
  );
}

function termHitCount(text: string | null | undefined, terms: string[]): number {
  if (!text) return 0;
  const haystack = text.toLowerCase();
  let hits = 0;
  for (const term of terms) {
    if (termMatchesText(haystack, term)) hits += 1;
  }
  return hits;
}

function recencyScore(updatedAt: string | undefined, now: number): number {
  if (!updatedAt) return 0;
  const ts = Date.parse(updatedAt);
  if (Number.isNaN(ts)) return 0;
  if (ts > now) return 0;
  const ageMs = now - ts;
  const ratio = Math.max(0, 1 - ageMs / RECENCY_WINDOW_MS);
  return ratio * DOC_RELEVANCE_WEIGHTS.recencyMax;
}

function canonicalMetadataHit(field: string, terms: string[]): number {
  const normalized = field.toLowerCase();
  return terms.some((term) => term === normalized || term.includes(normalized)) ? 1 : 0;
}

export type ScoreResult = {
  score: number;
  scoreBreakdown: Record<string, number>;
  matchReason: string;
};

/**
 * Computes a deterministic relevance score for a document against expanded purpose terms.
 * Pure function — no I/O, no LLM calls.
 * `terms` must already be expanded via expandTermsWithSynonyms before calling.
 */
export function scoreDocumentForPurpose(
  doc: InventoryDocument,
  terms: string[],
  now: number = Date.now(),
): ScoreResult {
  const breakdown: Record<string, number> = {};

  const fileNameScore =
    termHitCount(doc.fileName, terms) * DOC_RELEVANCE_WEIGHTS.fileNameTermHit;
  breakdown.fileName = fileNameScore;

  const domainScore =
    Math.max(termHitCount(doc.businessDomain, terms), canonicalMetadataHit(doc.businessDomain, terms)) *
    DOC_RELEVANCE_WEIGHTS.businessDomainTermHit;
  breakdown.businessDomain = domainScore;

  const typeScore =
    Math.max(termHitCount(doc.documentType, terms), canonicalMetadataHit(doc.documentType, terms)) *
    DOC_RELEVANCE_WEIGHTS.documentTypeTermHit;
  breakdown.documentType = typeScore;

  const freshnessBonus =
    doc.freshness === 'current' ? DOC_RELEVANCE_WEIGHTS.freshnessCurrent : 0;
  breakdown.freshness = freshnessBonus;

  const authoritativeBonus = doc.isAuthoritativeCandidate
    ? DOC_RELEVANCE_WEIGHTS.authoritative
    : 0;
  breakdown.authoritative = authoritativeBonus;

  const recency = recencyScore(doc.updatedAt, now);
  breakdown.recency = recency;

  const score =
    fileNameScore + domainScore + typeScore + freshnessBonus + authoritativeBonus + recency;

  const reasons: string[] = [];
  if (domainScore > 0) reasons.push(`業務領域「${doc.businessDomain}」が目的に一致`);
  if (fileNameScore > 0) reasons.push('ファイル名に目的キーワードを含む');
  if (doc.isAuthoritativeCandidate) reasons.push('正本候補として登録済み');
  if (doc.freshness === 'current') reasons.push('現行版');

  return {
    score,
    scoreBreakdown: breakdown,
    matchReason: reasons.length > 0 ? reasons.join('、') : '候補として一致',
  };
}

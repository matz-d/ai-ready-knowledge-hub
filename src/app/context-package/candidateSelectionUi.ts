import type { CandidateRecommendation } from '../../services/candidateSelection';
import { MAX_CONTEXT_PACKAGE_DOC_IDS } from '../../lib/contextPackageLimits';

/** Row shape returned by `POST /api/context-package/candidates` (metadata-only). */
export type CandidateRow = {
  docId: string;
  fileName: string;
  documentType: string;
  businessDomain: string;
  sensitivity: string;
  freshness: string;
  isAuthoritativeCandidate: boolean;
  status: string;
  updatedAt?: string;
  score: number;
  recommendation: CandidateRecommendation;
  reasonCode?: string;
  reasonLabel?: string;
  reasonDetail?: string;
  matchReason?: string;
  scoreBreakdown?: Record<string, number>;
};

export type CandidatesApiResponse = {
  candidates: CandidateRow[];
  missingHints: string[];
  inventoryScanned: number;
};

export const RECOMMENDATION_LABEL: Record<CandidateRecommendation, string> = {
  include: '推奨',
  exclude: '除外',
  needs_review: '要確認',
};

/** docIds pre-selected when candidates are loaded (`include` only). */
export function defaultSelectedDocIds(
  candidates: Pick<CandidateRow, 'docId' | 'recommendation'>[],
  maxDocIds = MAX_CONTEXT_PACKAGE_DOC_IDS,
): string[] {
  return candidates
    .filter((c) => c.recommendation === 'include')
    .slice(0, maxDocIds)
    .map((c) => c.docId);
}

/**
 * Advanced manual docIds override checkbox selection when non-empty.
 */
export function resolveDocIdsForGeneration(
  advancedRaw: string,
  selected: ReadonlySet<string>,
  parse: (raw: string) => string[],
): string[] {
  const advanced = parse(advancedRaw);
  if (advanced.length > 0) return advanced;
  return [...selected];
}

export type GroupedCandidates = {
  include: CandidateRow[];
  exclude: CandidateRow[];
  needs_review: CandidateRow[];
};

export function groupCandidatesByRecommendation(
  candidates: CandidateRow[],
): GroupedCandidates {
  const groups: GroupedCandidates = {
    include: [],
    exclude: [],
    needs_review: [],
  };
  for (const candidate of candidates) {
    groups[candidate.recommendation].push(candidate);
  }
  return groups;
}

/** Display reason for safety review / selection UI (metadata-only, no body). */
export function candidateDisplayReason(candidate: CandidateRow): string | undefined {
  if (candidate.recommendation === 'include') {
    return candidate.matchReason;
  }
  return candidate.reasonLabel ?? candidate.reasonDetail;
}

export function isCandidatesStale(
  purpose: string,
  fetchedForPurpose: string | null,
): boolean {
  if (fetchedForPurpose === null) return false;
  return purpose.trim() !== fetchedForPurpose;
}

export function canGenerateContextPackage(params: {
  purpose: string;
  candidatesReady: boolean;
  candidatesStale: boolean;
  isBusy: boolean;
  isFetchingCandidates: boolean;
  docIds: string[];
}): boolean {
  if (params.isBusy || params.isFetchingCandidates) return false;
  if (params.purpose.trim().length === 0) return false;
  // Defense-in-depth for future callers: ContextPackageForm invalidates stale
  // candidates on edit, but generation must still refuse mismatched purpose/candidates.
  if (!params.candidatesReady || params.candidatesStale) return false;
  return (
    params.docIds.length > 0 &&
    params.docIds.length <= MAX_CONTEXT_PACKAGE_DOC_IDS
  );
}

export { MAX_CONTEXT_PACKAGE_DOC_IDS };

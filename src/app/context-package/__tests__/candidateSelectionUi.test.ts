import { describe, expect, it } from 'vitest';
import {
  canGenerateContextPackage,
  candidateDisplayReason,
  defaultSelectedDocIds,
  groupCandidatesByRecommendation,
  isCandidatesStale,
  resolveDocIdsForGeneration,
  type CandidateRow,
} from '../candidateSelectionUi';
import { parseDocIds } from '../ContextPackageForm';

const rows: CandidateRow[] = [
  {
    docId: 'a',
    fileName: 'a',
    documentType: '表',
    businessDomain: '給与計算',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    status: 'curated',
    score: 1,
    recommendation: 'include',
  },
  {
    docId: 'b',
    fileName: 'b',
    documentType: '表',
    businessDomain: '給与計算',
    sensitivity: 'Restricted',
    freshness: 'current',
    isAuthoritativeCandidate: false,
    status: 'restricted',
    score: 0,
    recommendation: 'exclude',
  },
  {
    docId: 'c',
    fileName: 'c',
    documentType: '表',
    businessDomain: '給与計算',
    sensitivity: 'Internal',
    freshness: 'superseded_candidate',
    isAuthoritativeCandidate: false,
    status: 'curated',
    score: 0.5,
    recommendation: 'needs_review',
  },
];

describe('defaultSelectedDocIds', () => {
  it('selects include recommendations only', () => {
    expect(defaultSelectedDocIds(rows)).toEqual(['a']);
  });
});

describe('isCandidatesStale', () => {
  it('is false when nothing fetched yet', () => {
    expect(isCandidatesStale('purpose', null)).toBe(false);
  });

  it('is true when purpose differs from fetched purpose', () => {
    expect(isCandidatesStale('new purpose', 'old purpose')).toBe(true);
  });
});

describe('resolveDocIdsForGeneration', () => {
  it('uses advanced docIds when provided', () => {
    expect(
      resolveDocIdsForGeneration('doc-x\n', new Set(['a']), parseDocIds),
    ).toEqual(['doc-x']);
  });

  it('falls back to checkbox selection', () => {
    expect(resolveDocIdsForGeneration('', new Set(['a', 'c']), parseDocIds)).toEqual([
      'a',
      'c',
    ]);
  });
});

describe('groupCandidatesByRecommendation', () => {
  it('splits candidates into three buckets', () => {
    const grouped = groupCandidatesByRecommendation(rows);
    expect(grouped.include.map((c) => c.docId)).toEqual(['a']);
    expect(grouped.exclude.map((c) => c.docId)).toEqual(['b']);
    expect(grouped.needs_review.map((c) => c.docId)).toEqual(['c']);
  });
});

describe('candidateDisplayReason', () => {
  it('uses matchReason for include and reasonLabel for exclude', () => {
    expect(
      candidateDisplayReason({
        ...rows[0],
        matchReason: '関連あり',
      }),
    ).toBe('関連あり');
    expect(
      candidateDisplayReason({
        ...rows[1],
        reasonLabel: 'Restricted 情報',
      }),
    ).toBe('Restricted 情報');
  });
});

describe('canGenerateContextPackage', () => {
  it('requires ready candidates and at least one docId', () => {
    expect(
      canGenerateContextPackage({
        purpose: 'test',
        candidatesReady: true,
        candidatesStale: false,
        isBusy: false,
        isFetchingCandidates: false,
        docIds: ['a'],
      }),
    ).toBe(true);

    expect(
      canGenerateContextPackage({
        purpose: 'test',
        candidatesReady: false,
        candidatesStale: false,
        isBusy: false,
        isFetchingCandidates: false,
        docIds: ['a'],
      }),
    ).toBe(false);
  });
});

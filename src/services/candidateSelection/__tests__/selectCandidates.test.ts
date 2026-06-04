import { describe, expect, it } from 'vitest';
import type { InventoryDocument } from '../../../lib/inventory';
import { selectCandidates } from '../selectCandidates';

const NOW = new Date('2026-06-03T00:00:00.000Z').getTime();

function doc(overrides: Partial<InventoryDocument> = {}): InventoryDocument {
  return {
    id: 'doc-1',
    fileName: '給与計算手順.txt',
    documentType: 'チェックリスト',
    businessDomain: '給与計算',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    aiUsePolicy: 'direct',
    status: 'curated',
    rationale: '',
    sensitivitySource: 'curator',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('selectCandidates', () => {
  it('returns candidates and missingHints together', () => {
    const result = selectCandidates('給与計算', [doc()], { now: NOW });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.recommendation).toBe('include');
    expect(result.totalClassified).toBe(1);
    expect(Array.isArray(result.missingHints)).toBe(true);
  });

  it('applies responseLimit to candidates but reports totalClassified for the full set', () => {
    const docs = [
      doc({ id: 'a', isAuthoritativeCandidate: true, fileName: '給与計算a.txt' }),
      doc({ id: 'b', isAuthoritativeCandidate: false, fileName: 'unrelated.txt' }),
      doc({ id: 'c', isAuthoritativeCandidate: false, fileName: 'unrelated2.txt' }),
    ];
    const result = selectCandidates('給与計算', docs, { now: NOW, responseLimit: 1 });
    expect(result.candidates).toHaveLength(1);
    expect(result.totalClassified).toBe(3);
  });

  it('computes missingHints over the FULL set, not the sliced candidates', () => {
    // The only current/authoritative 給与計算 include is ranked lower (no fileName match),
    // so it falls beyond responseLimit=1. A naive "slice then hint" would wrongly report
    // 給与計算 as missing; selectCandidates must NOT, because it hints before slicing.
    const highRankOtherDomain = doc({
      id: 'top',
      businessDomain: '給与計算',
      fileName: '給与計算チェックリスト.txt', // strong fileName match → highest score
      isAuthoritativeCandidate: true,
      freshness: 'current',
    });
    const lowerRankAuthoritative = doc({
      id: 'auth',
      businessDomain: '給与計算',
      fileName: 'doc.txt', // no keyword match → lower score, slips past limit=1
      isAuthoritativeCandidate: true,
      freshness: 'current',
    });

    const result = selectCandidates('給与計算', [highRankOtherDomain, lowerRankAuthoritative], {
      now: NOW,
      responseLimit: 1,
    });

    expect(result.candidates).toHaveLength(1);
    // 給与計算 has current authoritative includes in the full set → no missing hint for it
    expect(result.missingHints).not.toContain(
      '「給与計算」に関する現行の正本文書が見つかりません',
    );
  });

  it('handles empty inventory', () => {
    const result = selectCandidates('給与計算', [], { now: NOW });
    expect(result.candidates).toHaveLength(0);
    expect(result.totalClassified).toBe(0);
  });

  it('responseLimit of 0 returns no candidates but still computes hints over full set', () => {
    const result = selectCandidates('給与計算', [doc({ isAuthoritativeCandidate: false, freshness: 'superseded_candidate' })], {
      now: NOW,
      responseLimit: 0,
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.missingHints).toContain('「給与計算」に関する現行の正本文書が見つかりません');
  });
});

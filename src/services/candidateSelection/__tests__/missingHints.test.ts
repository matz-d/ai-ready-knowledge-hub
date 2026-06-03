import { describe, expect, it } from 'vitest';
import type { CandidateDoc } from '../types';
import { generateMissingHints } from '../missingHints';

function candidate(overrides: Partial<CandidateDoc> = {}): CandidateDoc {
  return {
    docId: 'doc-1',
    fileName: '給与計算手順.csv',
    documentType: 'チェックリスト',
    businessDomain: '給与計算',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    status: 'curated',
    score: 10,
    recommendation: 'include',
    matchReason: '業務領域が一致',
    ...overrides,
  };
}

describe('generateMissingHints', () => {
  it('returns empty array when include candidates cover the purpose domain', () => {
    const candidates = [candidate({ recommendation: 'include', businessDomain: '給与計算' })];
    const hints = generateMissingHints('給与計算', candidates);
    // At least one current authoritative include exists → no hint for 給与計算
    expect(hints.filter((h) => h.includes('給与計算'))).toHaveLength(0);
  });

  it('returns a fallback hint when zero include candidates exist', () => {
    const candidates = [
      candidate({ recommendation: 'exclude', businessDomain: '給与計算' }),
    ];
    const hints = generateMissingHints('給与計算', candidates);
    expect(hints.length).toBeGreaterThan(0);
  });

  it('returns a domain-specific hint when include candidates are not current authoritative documents', () => {
    const candidates = [
      candidate({ freshness: 'superseded_candidate' }),
      candidate({ isAuthoritativeCandidate: false }),
    ];
    const hints = generateMissingHints('給与計算', candidates);
    expect(hints).toContain('「給与計算」に関する現行の正本文書が見つかりません');
  });

  it('uses synonyms to bridge English purpose terms to Japanese business domains', () => {
    const candidates = [
      candidate({ businessDomain: '給与計算' }),
    ];
    const hints = generateMissingHints('invoice', candidates);
    expect(hints).toContain('「料金管理」に関する現行の正本文書が見つかりません');
  });

  it('does not treat shared short domain fragments as required domains', () => {
    const candidates = [
      candidate({ businessDomain: '料金管理' }),
    ];
    const hints = generateMissingHints('管理', candidates);
    expect(hints).not.toContain('「顧問契約管理」に関する現行の正本文書が見つかりません');
  });

  it('returns no hints for empty purpose with include candidates present', () => {
    const candidates = [candidate()];
    const hints = generateMissingHints('', candidates);
    expect(Array.isArray(hints)).toBe(true);
  });
});

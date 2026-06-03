import { describe, expect, it } from 'vitest';
import type { InventoryDocument } from '../../../lib/inventory';
import { scoreDocumentForPurpose, DOC_RELEVANCE_WEIGHTS } from '../ranking';

const NOW = new Date('2026-06-03T00:00:00.000Z').getTime();
const RECENT = '2026-05-01T00:00:00.000Z';
const OLD = '2024-01-01T00:00:00.000Z';

function doc(overrides: Partial<InventoryDocument> = {}): InventoryDocument {
  return {
    id: 'doc-1',
    fileName: '給与計算チェックリスト.csv',
    documentType: 'チェックリスト',
    businessDomain: '給与計算',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: false,
    aiUsePolicy: 'direct',
    status: 'curated',
    rationale: '',
    sensitivitySource: 'curator',
    updatedAt: RECENT,
    ...overrides,
  };
}

describe('scoreDocumentForPurpose', () => {
  it('returns zero keyword score for unrelated purpose', () => {
    const result = scoreDocumentForPurpose(doc(), ['助成金'], NOW);
    // businessDomain/fileName have no keyword match — their breakdown components are 0
    expect(result.scoreBreakdown.businessDomain).toBe(0);
    expect(result.scoreBreakdown.fileName).toBe(0);
    // Overall score may still be > 0 due to freshness/recency/authoritative bonuses
  });

  it('scores businessDomain match with highest per-term weight', () => {
    const result = scoreDocumentForPurpose(doc(), ['給与計算'], NOW);
    expect(result.scoreBreakdown.businessDomain).toBe(DOC_RELEVANCE_WEIGHTS.businessDomainTermHit);
    expect(result.scoreBreakdown.fileName).toBeGreaterThan(0);
  });

  it('scores canonical businessDomain included inside an unspaced Japanese purpose token', () => {
    const result = scoreDocumentForPurpose(
      doc(),
      ['新人スタッフ向けに給与計算業務を学べるaiを作りたい'],
      NOW,
    );
    expect(result.scoreBreakdown.businessDomain).toBe(
      DOC_RELEVANCE_WEIGHTS.businessDomainTermHit,
    );
  });

  it('does not count short ASCII terms inside unrelated words', () => {
    const result = scoreDocumentForPurpose(
      doc({ fileName: 'coffee_menu.pdf', businessDomain: '料金管理' }),
      ['fee'],
      NOW,
    );
    expect(result.scoreBreakdown.fileName).toBe(0);
  });

  it('adds freshnessCurrent bonus only when freshness === current', () => {
    const current = scoreDocumentForPurpose(doc({ freshness: 'current' }), [], NOW);
    const superseded = scoreDocumentForPurpose(
      doc({ freshness: 'superseded_candidate' }),
      [],
      NOW,
    );
    expect(current.scoreBreakdown.freshness).toBe(DOC_RELEVANCE_WEIGHTS.freshnessCurrent);
    expect(superseded.scoreBreakdown.freshness).toBe(0);
  });

  it('adds authoritative bonus only when isAuthoritativeCandidate === true', () => {
    const auth = scoreDocumentForPurpose(doc({ isAuthoritativeCandidate: true }), [], NOW);
    const notAuth = scoreDocumentForPurpose(doc({ isAuthoritativeCandidate: false }), [], NOW);
    expect(auth.scoreBreakdown.authoritative).toBe(DOC_RELEVANCE_WEIGHTS.authoritative);
    expect(notAuth.scoreBreakdown.authoritative).toBe(0);
  });

  it('gives higher recency score to newer documents', () => {
    const recent = scoreDocumentForPurpose(doc({ updatedAt: RECENT }), [], NOW);
    const old = scoreDocumentForPurpose(doc({ updatedAt: OLD }), [], NOW);
    expect(recent.scoreBreakdown.recency).toBeGreaterThan(old.scoreBreakdown.recency);
  });

  it('does not reward future-dated updatedAt with recency bonus', () => {
    const result = scoreDocumentForPurpose(
      doc({ updatedAt: '2026-06-04T00:00:00.000Z' }),
      [],
      NOW,
    );
    expect(result.scoreBreakdown.recency).toBe(0);
  });

  it('returns zero recency for missing updatedAt', () => {
    const result = scoreDocumentForPurpose(doc({ updatedAt: undefined }), [], NOW);
    expect(result.scoreBreakdown.recency).toBe(0);
  });

  it('includes businessDomain match in matchReason', () => {
    const result = scoreDocumentForPurpose(doc(), ['給与計算'], NOW);
    expect(result.matchReason).toContain('給与計算');
  });

  it('includes authoritative label in matchReason when applicable', () => {
    const result = scoreDocumentForPurpose(
      doc({ isAuthoritativeCandidate: true }),
      [],
      NOW,
    );
    expect(result.matchReason).toContain('正本候補');
  });
});

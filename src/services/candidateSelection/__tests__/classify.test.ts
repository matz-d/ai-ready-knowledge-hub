import { describe, expect, it } from 'vitest';
import type { InventoryDocument } from '../../../lib/inventory';
import { classifyDocument, classifyInventory } from '../classify';

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

// ---------------------------------------------------------------------------
// Rule 1: exclude — isBlockedForAi
// ---------------------------------------------------------------------------
describe('Rule 1: exclude when isBlockedForAi', () => {
  it('excludes Restricted sensitivity documents', () => {
    const result = classifyDocument(
      doc({ sensitivity: 'Restricted', aiUsePolicy: 'blocked', status: 'restricted' }),
      ['給与計算'],
      NOW,
    );
    expect(result.recommendation).toBe('exclude');
    expect(result.reasonCode).toBe('restricted_sensitivity');
    expect(result.score).toBe(0);
  });

  it('excludes blocked aiUsePolicy documents', () => {
    const result = classifyDocument(
      doc({ aiUsePolicy: 'blocked', status: 'blocked' }),
      [],
      NOW,
    );
    expect(result.recommendation).toBe('exclude');
    expect(result.reasonCode).toBe('restricted_sensitivity');
  });

  it('rule 1 takes precedence over freshness=superseded_candidate', () => {
    const result = classifyDocument(
      doc({
        sensitivity: 'Restricted',
        aiUsePolicy: 'blocked',
        freshness: 'superseded_candidate',
      }),
      [],
      NOW,
    );
    expect(result.recommendation).toBe('exclude');
    expect(result.reasonCode).toBe('restricted_sensitivity');
  });
});

// ---------------------------------------------------------------------------
// Rule 2: needs_review — masking pending
// ---------------------------------------------------------------------------
describe('Rule 2: needs_review when masking incomplete', () => {
  it('flags needsMaskerEvaluation docs as needs_review', () => {
    const result = classifyDocument(
      doc({
        aiUsePolicy: 'requires_masking',
        maskerEvaluation: undefined,
        status: 'masking',
      }),
      [],
      NOW,
    );
    expect(result.recommendation).toBe('needs_review');
    expect(result.reasonCode).toBe('masking_required_unavailable');
    expect(result.reasonDetail).toBeDefined();
  });

  it('flags maskingPending===true docs as needs_review', () => {
    const result = classifyDocument(
      doc({ maskingPending: true, status: 'curated' }),
      [],
      NOW,
    );
    expect(result.recommendation).toBe('needs_review');
    expect(result.reasonCode).toBe('masking_required_unavailable');
  });

  it('does NOT flag requires_masking with completed maskerEvaluation (Confidential) as masking_required', () => {
    const result = classifyDocument(
      doc({
        aiUsePolicy: 'requires_masking',
        sensitivity: 'Confidential',
        status: 'ai_safe',
        maskerEvaluation: {
          recommendedSensitivity: 'Confidential',
          rationale: 'ok',
          residualRisk: { detected: false, reasons: ['no re-identification risk'] },
        },
      }),
      [],
      NOW,
    );
    // ai_safe with completed masking → should be include (rule 4), not masking_required
    expect(result.recommendation).toBe('include');
  });
});

// ---------------------------------------------------------------------------
// Rule 3: needs_review — superseded
// ---------------------------------------------------------------------------
describe('Rule 3: needs_review for superseded documents', () => {
  it('marks superseded_candidate as needs_review with superseded_or_stale reason', () => {
    const result = classifyDocument(
      doc({ freshness: 'superseded_candidate', status: 'curated' }),
      [],
      NOW,
    );
    expect(result.recommendation).toBe('needs_review');
    expect(result.reasonCode).toBe('superseded_or_stale');
  });

  it('superseded doc still gets a score for ordering', () => {
    const result = classifyDocument(
      doc({ freshness: 'superseded_candidate', isAuthoritativeCandidate: true }),
      ['給与計算'],
      NOW,
    );
    expect(result.score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Rule 4: include
// ---------------------------------------------------------------------------
describe('Rule 4: include safe documents', () => {
  it('includes curated documents with matchReason', () => {
    const result = classifyDocument(doc({ status: 'curated' }), ['給与計算'], NOW);
    expect(result.recommendation).toBe('include');
    expect(result.matchReason).toBeDefined();
    expect(result.scoreBreakdown).toBeDefined();
  });

  it('includes ai_safe documents', () => {
    const result = classifyDocument(
      doc({
        status: 'ai_safe',
        aiUsePolicy: 'requires_masking' as const,
        maskerEvaluation: {
          recommendedSensitivity: 'Confidential',
          rationale: 'ok',
          residualRisk: { detected: false, reasons: ['no re-identification risk'] },
        },
      }),
      [],
      NOW,
    );
    // completed maskerEvaluation skips rule 2 → ai_safe reaches rule 4 (include)
    expect(result.recommendation).toBe('include');
  });

  it('does not set reasonCode for include', () => {
    const result = classifyDocument(doc({ status: 'curated' }), [], NOW);
    expect(result.recommendation).toBe('include');
    expect(result.reasonCode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------
describe('Fallback: unexpected status', () => {
  it('returns needs_review for failed status', () => {
    const result = classifyDocument(
      doc({ status: 'failed', aiUsePolicy: 'direct' as const }),
      [],
      NOW,
    );
    expect(result.recommendation).toBe('needs_review');
    expect(result.reasonCode).toBe('human_confirmation_required');
  });
});

// ---------------------------------------------------------------------------
// classifyInventory
// ---------------------------------------------------------------------------
describe('classifyInventory', () => {
  it('returns all documents classified', () => {
    const docs = [
      doc({ id: 'doc-1', status: 'curated' }),
      doc({ id: 'doc-2', sensitivity: 'Restricted', aiUsePolicy: 'blocked', status: 'restricted' }),
      doc({ id: 'doc-3', freshness: 'superseded_candidate', status: 'curated' }),
    ];
    const result = classifyInventory('給与計算', docs, NOW);
    expect(result).toHaveLength(3);

    const byId = Object.fromEntries(result.map((c) => [c.docId, c]));
    expect(byId['doc-1']?.recommendation).toBe('include');
    expect(byId['doc-2']?.recommendation).toBe('exclude');
    expect(byId['doc-3']?.recommendation).toBe('needs_review');
  });

  it('sorts by score descending with stable tie-breaking', () => {
    const highScore = doc({
      id: 'high',
      status: 'curated',
      isAuthoritativeCandidate: true,
      freshness: 'current',
    });
    const lowScore = doc({
      id: 'low',
      status: 'curated',
      isAuthoritativeCandidate: false,
      freshness: 'superseded_candidate',
    });
    const result = classifyInventory('無関係なpurpose', [highScore, lowScore], NOW);
    // lowScore has freshness=superseded_candidate → needs_review (score doesn't compare with rule-4)
    // highScore is curated+current+authoritative
    expect(result[0]?.docId).toBe('high');
  });

  it('synonym expansion: English purpose matches Japanese domain', () => {
    const payrollDoc = doc({ id: 'payroll', businessDomain: '給与計算', status: 'curated' });
    const unrelated = doc({ id: 'other', businessDomain: '助成金相談', status: 'curated' });

    const result = classifyInventory('payroll calculation', [payrollDoc, unrelated], NOW);
    const payrollResult = result.find((c) => c.docId === 'payroll');
    const otherResult = result.find((c) => c.docId === 'other');

    expect(payrollResult?.score).toBeGreaterThan(otherResult?.score ?? 0);
    expect(payrollResult?.recommendation).toBe('include');
  });
});

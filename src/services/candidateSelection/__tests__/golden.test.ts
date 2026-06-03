import { describe, expect, it } from 'vitest';
import type { InventoryDocument } from '../../../lib/inventory';
import fixture from '../../../../sample-data/candidate-selection/accounting-office-inventory.fixture.json';
import { selectCandidates, type SelectCandidatesResult } from '../selectCandidates';

/** Fixed clock — must stay stable for golden snapshots. */
const GOLDEN_NOW = new Date('2026-06-03T00:00:00.000Z').getTime();

const FIXTURE_DOCS = fixture as InventoryDocument[];

/**
 * Stable projection for golden snapshots: ordering, classification, and scores
 * are deterministic when `now` is fixed; rationale / body fields are omitted.
 */
function goldenProjection(result: SelectCandidatesResult) {
  return {
    totalClassified: result.totalClassified,
    missingHints: result.missingHints,
    candidates: result.candidates.map(
      ({
        docId,
        fileName,
        businessDomain,
        recommendation,
        reasonCode,
        reasonLabel,
        score,
        scoreBreakdown,
        matchReason,
      }) => ({
        docId,
        fileName,
        businessDomain,
        recommendation,
        reasonCode: reasonCode ?? null,
        reasonLabel: reasonLabel ?? null,
        score,
        scoreBreakdown,
        matchReason: matchReason ?? null,
      }),
    ),
  };
}

describe('candidateSelection golden (S4)', () => {
  it('matches snapshot for payroll onboarding purpose (Japanese)', () => {
    const result = selectCandidates(
      '新人スタッフ向けに給与計算業務を学べるAIを作りたい',
      FIXTURE_DOCS,
      { now: GOLDEN_NOW },
    );

    expect(goldenProjection(result)).toMatchSnapshot();
  });

  it('matches snapshot for payroll purpose (English synonym expansion)', () => {
    const result = selectCandidates('payroll onboarding training', FIXTURE_DOCS, {
      now: GOLDEN_NOW,
    });

    expect(goldenProjection(result)).toMatchSnapshot();
  });

  it('matches snapshot with responseLimit applied (ranking order preserved)', () => {
    const result = selectCandidates(
      '新人スタッフ向けに給与計算業務を学べるAIを作りたい',
      FIXTURE_DOCS,
      { now: GOLDEN_NOW, responseLimit: 5 },
    );

    expect(goldenProjection(result)).toMatchSnapshot();
  });
});

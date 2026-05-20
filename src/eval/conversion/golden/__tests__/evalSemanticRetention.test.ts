import { describe, expect, it } from 'vitest';
import {
  evalSemanticRetention,
  normalizeForSubstringMatch,
} from '../evalSemanticRetention';

describe('normalizeForSubstringMatch', () => {
  it('NFKC-normalizes full-width alphanumerics and collapses whitespace', () => {
    expect(normalizeForSubstringMatch('　ＡＢ　Ｃ　')).toBe('ABC');
    expect(normalizeForSubstringMatch('１⽇８時間')).toBe('1日8時間');
  });

  it('treats half-width and full-width variants as equal after normalization', () => {
    const half = normalizeForSubstringMatch('1日8時間');
    const full = normalizeForSubstringMatch('１日８時間');
    expect(half).toBe(full);
  });
});

describe('evalSemanticRetention', () => {
  it('returns recall 1 when all expected fields are substrings of chunk text', () => {
    const { semanticRetention } = evalSemanticRetention({
      chunks: [
        { text: '労働条件通知書（一般労働者用）' },
        { text: '契約期間 期間の定めなし' },
      ],
      expectedFields: ['労働条件通知書', '期間の定めなし'],
    });

    expect(semanticRetention.keyFieldRecall).toBe(1);
    expect(semanticRetention.missingExpectedFields).toEqual([]);
  });

  it('lists missing fields and computes found/expected recall', () => {
    const { semanticRetention } = evalSemanticRetention({
      chunks: [{ text: 'alpha beta' }],
      expectedFields: ['alpha', 'gamma', 'beta'],
    });

    expect(semanticRetention.keyFieldRecall).toBeCloseTo(2 / 3, 5);
    expect(semanticRetention.missingExpectedFields).toEqual(['gamma']);
  });

  it('matches across chunk boundaries via concatenation', () => {
    const { semanticRetention } = evalSemanticRetention({
      chunks: [{ text: '契約期間' }, { text: '期間の定めなし' }],
      expectedFields: ['契約期間期間の定めなし'],
    });

    expect(semanticRetention.keyFieldRecall).toBe(1);
    expect(semanticRetention.missingExpectedFields).toEqual([]);
  });

  it('returns recall 1 for an empty expected field list', () => {
    const { semanticRetention } = evalSemanticRetention({
      chunks: [{ text: 'anything' }],
      expectedFields: [],
    });

    expect(semanticRetention.keyFieldRecall).toBe(1);
    expect(semanticRetention.missingExpectedFields).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { summarizeChunkPageCoverage } from '../pageEvidence';
import type { HeuristicEvalChunk } from '../types';

function pdfChunk(page: number, text = 'body'): HeuristicEvalChunk {
  return { text, locator: { kind: 'pdf', page } };
}

describe('summarizeChunkPageCoverage', () => {
  it('uses the max observed page as denominator so gaps are not hidden', () => {
    // Evidence for pages 1 and 3 but nothing for page 2. The old "distinct
    // observed pages" denominator would report 2/2 = 1.0 and hide the gap.
    const summary = summarizeChunkPageCoverage([pdfChunk(1), pdfChunk(3)]);
    expect(summary.totalPages).toBe(3);
    expect(summary.pagesWithText).toBe(2);
    // 2 / 3 ≈ 0.67 — the missing page 2 drags coverage below full.
    expect(summary.pagesWithText / summary.totalPages).toBeCloseTo(0.667, 2);
  });

  it('reports full coverage only when pages are contiguous from 1', () => {
    const summary = summarizeChunkPageCoverage([pdfChunk(1), pdfChunk(2), pdfChunk(3)]);
    expect(summary.totalPages).toBe(3);
    expect(summary.pagesWithText).toBe(3);
  });

  it('counts a page with whitespace-only text as missing in the numerator', () => {
    const summary = summarizeChunkPageCoverage([pdfChunk(1), pdfChunk(2, '   ')]);
    expect(summary.totalPages).toBe(2);
    expect(summary.pagesWithText).toBe(1);
  });

  it('returns zero pages when no chunk carries page evidence', () => {
    const summary = summarizeChunkPageCoverage([{ text: 'no locator' }]);
    expect(summary.totalPages).toBe(0);
    expect(summary.pagesWithText).toBe(0);
  });
});

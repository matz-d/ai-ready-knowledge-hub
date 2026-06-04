import { describe, expect, it } from 'vitest';
import type { CandidateRow } from '../candidateSelectionUi';
import {
  projectPreGenerationPreview,
  previewRequiresAcknowledgement,
} from '../preGenerationPreview';

function row(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    docId: 'doc-1',
    fileName: '給与計算チェックリスト.csv',
    documentType: '表',
    businessDomain: '給与計算',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    status: 'curated',
    score: 10,
    recommendation: 'include',
    ...overrides,
  };
}

function selection(...ids: string[]): ReadonlySet<string> {
  return new Set(ids);
}

describe('projectPreGenerationPreview', () => {
  it('puts safe include docs into willSend', () => {
    const candidates = [row({ docId: 'a', recommendation: 'include' })];
    const preview = projectPreGenerationPreview(candidates, selection('a'));
    expect(preview.willSend.map((r) => r.docId)).toEqual(['a']);
    expect(preview.autoExcluded).toHaveLength(0);
    expect(preview.warnings).toHaveLength(0);
    expect(preview.hasWarnings).toBe(false);
  });

  it('only considers selected docs', () => {
    const candidates = [
      row({ docId: 'a', recommendation: 'include' }),
      row({ docId: 'b', recommendation: 'include' }),
    ];
    const preview = projectPreGenerationPreview(candidates, selection('a'));
    expect(preview.willSend.map((r) => r.docId)).toEqual(['a']);
    expect(preview.counts.willSend).toBe(1);
  });

  // -------------------------------------------------------------------------
  // SAFETY INVARIANT: nothing unsafe ever reaches willSend
  // -------------------------------------------------------------------------
  describe('safety invariant: Restricted/blocked never in willSend', () => {
    it('auto-excludes Restricted sensitivity even if somehow selected', () => {
      const candidates = [
        row({
          docId: 'r',
          sensitivity: 'Restricted',
          status: 'restricted',
          recommendation: 'exclude',
          reasonCode: 'restricted_sensitivity',
        }),
      ];
      const preview = projectPreGenerationPreview(candidates, selection('r'));
      expect(preview.autoExcluded.map((r) => r.docId)).toEqual(['r']);
      expect(preview.willSend).toHaveLength(0);
      expect(preview.hasAutoExcluded).toBe(true);
    });

    it('auto-excludes blocked status', () => {
      const candidates = [row({ docId: 'b', status: 'blocked', recommendation: 'exclude' })];
      const preview = projectPreGenerationPreview(candidates, selection('b'));
      expect(preview.autoExcluded.map((r) => r.docId)).toEqual(['b']);
      expect(preview.willSend).toHaveLength(0);
    });

    it('auto-excludes by reasonCode even when status looks benign', () => {
      // Defense-in-depth: a malformed row claiming curated status but restricted reasonCode
      const candidates = [
        row({
          docId: 'x',
          status: 'curated',
          sensitivity: 'Internal',
          reasonCode: 'restricted_sensitivity',
          recommendation: 'exclude',
        }),
      ];
      const preview = projectPreGenerationPreview(candidates, selection('x'));
      expect(preview.autoExcluded.map((r) => r.docId)).toEqual(['x']);
      expect(preview.willSend).toHaveLength(0);
    });

    it('never places any auto_excluded disposition in willSend across a mixed selection', () => {
      const candidates = [
        row({ docId: 'safe', recommendation: 'include' }),
        row({ docId: 'restricted', sensitivity: 'Restricted', status: 'restricted', recommendation: 'exclude' }),
        row({ docId: 'blocked2', status: 'blocked', recommendation: 'exclude' }),
      ];
      const preview = projectPreGenerationPreview(
        candidates,
        selection('safe', 'restricted', 'blocked2'),
      );
      expect(preview.willSend.every((r) => r.disposition === 'will_send')).toBe(true);
      expect(preview.willSend.some((r) => r.sensitivity === 'Restricted')).toBe(false);
      expect(preview.autoExcluded).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Warnings: masking-pending and stale
  // -------------------------------------------------------------------------
  it('flags masking-pending as a warning, not willSend', () => {
    const candidates = [
      row({
        docId: 'm',
        sensitivity: 'Confidential',
        status: 'masking',
        recommendation: 'needs_review',
        reasonCode: 'masking_required_unavailable',
      }),
    ];
    const preview = projectPreGenerationPreview(candidates, selection('m'));
    expect(preview.warnings.map((r) => r.disposition)).toEqual(['masking_pending']);
    expect(preview.willSend).toHaveLength(0);
    expect(preview.hasWarnings).toBe(true);
  });

  it('flags superseded as a stale warning', () => {
    const candidates = [
      row({
        docId: 's',
        freshness: 'superseded_candidate',
        recommendation: 'needs_review',
        reasonCode: 'superseded_or_stale',
      }),
    ];
    const preview = projectPreGenerationPreview(candidates, selection('s'));
    expect(preview.warnings.map((r) => r.disposition)).toEqual(['stale_warning']);
    expect(preview.willSend).toHaveLength(0);
  });

  it('treats Confidential + ai_safe (masked) as sendable, not unsafe', () => {
    // Confidential sensitivity is NOT a safety blocker — only Restricted is.
    const candidates = [
      row({
        docId: 'c',
        sensitivity: 'Confidential',
        status: 'ai_safe',
        recommendation: 'include',
      }),
    ];
    const preview = projectPreGenerationPreview(candidates, selection('c'));
    expect(preview.willSend.map((r) => r.docId)).toEqual(['c']);
    expect(preview.autoExcluded).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Unknown docIds (advanced manual override path)
  // -------------------------------------------------------------------------
  it('reports selected docIds that are not in the candidate list', () => {
    const candidates = [row({ docId: 'a', recommendation: 'include' })];
    const preview = projectPreGenerationPreview(candidates, selection('a', 'ghost-1'));
    expect(preview.unknownDocIds).toEqual(['ghost-1']);
    expect(preview.hasWarnings).toBe(true);
    expect(preview.counts.unknownDocIds).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Ordering and counts
  // -------------------------------------------------------------------------
  it('preserves candidate order within each bucket', () => {
    const candidates = [
      row({ docId: 'a', recommendation: 'include' }),
      row({ docId: 'b', recommendation: 'include' }),
      row({ docId: 'c', recommendation: 'include' }),
    ];
    const preview = projectPreGenerationPreview(candidates, selection('a', 'b', 'c'));
    expect(preview.willSend.map((r) => r.docId)).toEqual(['a', 'b', 'c']);
  });

  it('computes counts consistently', () => {
    const candidates = [
      row({ docId: 'i', recommendation: 'include' }),
      row({ docId: 'r', sensitivity: 'Restricted', status: 'restricted', recommendation: 'exclude' }),
      row({ docId: 's', freshness: 'superseded_candidate', recommendation: 'needs_review', reasonCode: 'superseded_or_stale' }),
    ];
    const preview = projectPreGenerationPreview(candidates, selection('i', 'r', 's'));
    expect(preview.counts).toEqual({
      willSend: 1,
      autoExcluded: 1,
      warnings: 1,
      unknownDocIds: 0,
    });
  });

  it('empty selection yields all-empty preview', () => {
    const candidates = [row({ docId: 'a', recommendation: 'include' })];
    const preview = projectPreGenerationPreview(candidates, selection());
    expect(preview.willSend).toHaveLength(0);
    expect(preview.autoExcluded).toHaveLength(0);
    expect(preview.warnings).toHaveLength(0);
    expect(preview.hasWarnings).toBe(false);
    expect(preview.hasAutoExcluded).toBe(false);
  });
});

describe('previewRequiresAcknowledgement', () => {
  it('is false for an all-safe selection', () => {
    const candidates = [row({ docId: 'a', recommendation: 'include' })];
    const preview = projectPreGenerationPreview(candidates, selection('a'));
    expect(previewRequiresAcknowledgement(preview)).toBe(false);
  });

  it('is true when there is an auto-excluded Restricted doc', () => {
    const candidates = [
      row({ docId: 'a', recommendation: 'include' }),
      row({ docId: 'r', sensitivity: 'Restricted', status: 'restricted', recommendation: 'exclude' }),
    ];
    const preview = projectPreGenerationPreview(candidates, selection('a', 'r'));
    expect(previewRequiresAcknowledgement(preview)).toBe(true);
  });

  it('is true when there is a stale warning', () => {
    const candidates = [
      row({ docId: 's', freshness: 'superseded_candidate', recommendation: 'needs_review', reasonCode: 'superseded_or_stale' }),
    ];
    const preview = projectPreGenerationPreview(candidates, selection('s'));
    expect(previewRequiresAcknowledgement(preview)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  evaluateDocumentSupersessionPolicy,
  extractVersionFamilyStem,
} from '../documentSupersessionPolicy';

function doc(overrides: {
  id: string;
  fileName: string;
  freshness?: 'current' | 'superseded_candidate';
  isAuthoritativeCandidate?: boolean;
  updatedAt?: string;
  eligibleAsCurrent?: boolean;
  supersededBy?: string;
}) {
  return {
    freshness: 'current' as const,
    isAuthoritativeCandidate: true,
    eligibleAsCurrent: true,
    ...overrides,
  };
}

describe('extractVersionFamilyStem', () => {
  it('groups year-suffixed replacement documents', () => {
    expect(extractVersionFamilyStem('料金表_2023.csv')).toEqual({
      stem: '料金表',
      hasVersionMarker: true,
    });
    expect(extractVersionFamilyStem('料金表_2026.csv')).toEqual({
      stem: '料金表',
      hasVersionMarker: true,
    });
  });

  it('does not treat fiscal-year-like subject names as replacement versions', () => {
    expect(extractVersionFamilyStem('2023年度研修資料.md')).toEqual({
      stem: '2023年度研修資料',
      hasVersionMarker: false,
    });
    expect(extractVersionFamilyStem('2026年度研修資料.md')).toEqual({
      stem: '2026年度研修資料',
      hasVersionMarker: false,
    });
  });
});

describe('evaluateDocumentSupersessionPolicy', () => {
  it('marks older year versions as superseded when an includable current representative exists', () => {
    const result = evaluateDocumentSupersessionPolicy([
      doc({ id: 'old', fileName: '料金表_2023.csv' }),
      doc({ id: 'current', fileName: '料金表_2026.csv' }),
    ]);

    expect(result.currentRepresentatives.map((member) => member.document.id)).toEqual([
      'current',
    ]);
    expect(result.superseded.map((member) => member.document.id)).toEqual(['old']);
    expect(result.groups[0]).toEqual(
      expect.objectContaining({
        familyStem: '料金表',
        confidence: 'medium',
      }),
    );
  });

  it('handles manual_v1/manual_v2 as the same version family', () => {
    const result = evaluateDocumentSupersessionPolicy([
      doc({ id: 'v1', fileName: 'manual_v1.pdf' }),
      doc({ id: 'v2', fileName: 'manual_v2.pdf' }),
    ]);

    expect(result.currentRepresentatives.map((member) => member.document.id)).toEqual([
      'v2',
    ]);
    expect(result.superseded.map((member) => member.document.id)).toEqual(['v1']);
  });

  it('handles Japanese old/new markers as the same version family', () => {
    const result = evaluateDocumentSupersessionPolicy([
      doc({ id: 'old', fileName: '手順書_旧版.md' }),
      doc({ id: 'new', fileName: '手順書_新版.md' }),
    ]);

    expect(result.currentRepresentatives.map((member) => member.document.id)).toEqual([
      'new',
    ]);
    expect(result.superseded.map((member) => member.document.id)).toEqual(['old']);
  });

  it('does not supersede when the stronger candidate is not currently eligible', () => {
    const result = evaluateDocumentSupersessionPolicy([
      doc({ id: 'old', fileName: '料金表_2023.csv' }),
      doc({
        id: 'current',
        fileName: '料金表_2026.csv',
        eligibleAsCurrent: false,
      }),
    ]);

    expect(result.superseded).toEqual([]);
    expect(result.ambiguous.map((member) => member.document.id).sort()).toEqual([
      'current',
      'old',
    ]);
  });

  it('uses explicit supersededBy metadata as high confidence when available', () => {
    const result = evaluateDocumentSupersessionPolicy([
      doc({
        id: 'old',
        fileName: 'service-menu-old.csv',
        supersededBy: 'current',
      }),
      doc({ id: 'current', fileName: 'service-menu-current.csv' }),
    ]);

    expect(result.groups[0]?.confidence).toBe('high');
    expect(result.currentRepresentatives.map((member) => member.document.id)).toEqual([
      'current',
    ]);
    expect(result.superseded.map((member) => member.document.id)).toEqual(['old']);
  });

  it('leaves unrelated year-subject documents untouched', () => {
    const result = evaluateDocumentSupersessionPolicy([
      doc({ id: 'training-2023', fileName: '2023年度研修資料.md' }),
      doc({ id: 'training-2026', fileName: '2026年度研修資料.md' }),
    ]);

    expect(result.groups).toEqual([]);
    expect(result.superseded).toEqual([]);
    expect(result.ambiguous).toEqual([]);
  });
});

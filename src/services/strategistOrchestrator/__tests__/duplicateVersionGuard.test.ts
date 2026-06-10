import { describe, expect, it } from 'vitest';
import type { KnowledgeChunk } from '../../../lib/knowledgeChunkSchema';
import type { StrategistOrchestratorParent } from '../types';
import {
  applyDuplicateVersionAmbiguityGuard,
  extractVersionFamilyStem,
  scoreDocumentVersionStrength,
} from '../duplicateVersionGuard';

function parent(
  overrides: Partial<StrategistOrchestratorParent> = {},
): StrategistOrchestratorParent {
  return {
    id: 'doc-1',
    fileName: 'policy.md',
    documentType: 'メモ',
    businessDomain: '顧客対応',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    updatedAt: '2026-05-14T00:00:00.000Z',
    ...overrides,
  };
}

function chunk(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    id: 'chunk-1',
    docId: 'doc-1',
    schemaVersion: 1,
    sourceType: 'text',
    structureType: 'paragraph',
    locator: { kind: 'paragraph' },
    text: 'default body',
    sensitivity: 'Internal',
    aiUsePolicy: 'direct',
    sensitivitySource: 'inherited',
    extractionProvider: 'csv',
    sourceHash: 'hash',
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
    ...overrides,
  };
}

function joinedByKeyFor(
  rows: { docId: string; chunkId: string; parent: StrategistOrchestratorParent }[],
): Map<string, { parent: StrategistOrchestratorParent }> {
  return new Map(
    rows.map((row) => [
      `${row.docId}\u0000${row.chunkId}`,
      { parent: row.parent },
    ]),
  );
}

describe('extractVersionFamilyStem', () => {
  it('strips obvious version markers and keeps a stable stem', () => {
    expect(extractVersionFamilyStem('給与計算マニュアル_v1.pdf')).toEqual({
      stem: '給与計算マニュアル',
      hasVersionMarker: true,
    });
    expect(extractVersionFamilyStem('給与計算マニュアル_v2.pdf')).toEqual({
      stem: '給与計算マニュアル',
      hasVersionMarker: true,
    });
  });
});

describe('scoreDocumentVersionStrength', () => {
  it('prefers current freshness and newer updatedAt as weak hints', () => {
    const older = scoreDocumentVersionStrength(
      parent({
        fileName: '給与計算マニュアル_旧版.pdf',
        freshness: 'superseded_candidate',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }),
    );
    const newer = scoreDocumentVersionStrength(
      parent({
        fileName: '給与計算マニュアル_v2.pdf',
        freshness: 'current',
        updatedAt: '2026-05-14T00:00:00.000Z',
      }),
    );
    expect(newer).toBeGreaterThan(older);
  });
});

describe('applyDuplicateVersionAmbiguityGuard', () => {
  it('routes the older/weaker included doc to human review and keeps the newer included', () => {
    const oldParent = parent({
      id: 'doc-old',
      fileName: '給与計算マニュアル_旧版.pdf',
      freshness: 'superseded_candidate',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    const newParent = parent({
      id: 'doc-new',
      fileName: '給与計算マニュアル_v2.pdf',
      freshness: 'current',
      updatedAt: '2026-05-14T00:00:00.000Z',
    });
    const oldChunk = chunk({ id: 'old-chunk', docId: 'doc-old' });
    const newChunk = chunk({ id: 'new-chunk', docId: 'doc-new' });

    const result = applyDuplicateVersionAmbiguityGuard({
      included: [
        {
          docId: 'doc-old',
          chunkId: 'old-chunk',
          rationale: 'batch A included old version',
          confidence: 0.8,
        },
        {
          docId: 'doc-new',
          chunkId: 'new-chunk',
          rationale: 'batch B included new version',
          confidence: 0.9,
        },
      ],
      joinedByKey: joinedByKeyFor([
        { docId: 'doc-old', chunkId: 'old-chunk', parent: oldParent },
        { docId: 'doc-new', chunkId: 'new-chunk', parent: newParent },
      ]),
    });

    expect(result.included).toEqual([
      expect.objectContaining({ docId: 'doc-new', chunkId: 'new-chunk' }),
    ]);
    expect(result.included).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ docId: 'doc-old' }),
      ]),
    );
    expect(result.humanConfirmationRequired).toEqual([
      expect.objectContaining({
        docId: 'doc-old',
        chunkId: 'old-chunk',
        reason: 'human_confirmation_required',
      }),
    ]);
    expect(result.humanReviewQuestions).toHaveLength(1);
    expect(result.humanReviewQuestions[0]?.relatedChunkIds).toEqual(['old-chunk']);
    expect(result.humanReviewQuestions[0]?.question).toContain('旧版');
    expect(result.humanReviewQuestions[0]?.question).toContain('v2');
    expect(oldChunk.id).toBe('old-chunk');
    expect(newChunk.id).toBe('new-chunk');
  });

  it('leaves unrelated documents untouched when no obvious version family exists', () => {
    const payrollParent = parent({
      id: 'doc-payroll',
      fileName: '給与計算チェックリスト.md',
      freshness: 'current',
    });
    const hrParent = parent({
      id: 'doc-hr',
      fileName: '採用フロー.md',
      freshness: 'current',
    });

    const result = applyDuplicateVersionAmbiguityGuard({
      included: [
        {
          docId: 'doc-payroll',
          chunkId: 'payroll-chunk',
          rationale: 'payroll included',
          confidence: 0.8,
        },
        {
          docId: 'doc-hr',
          chunkId: 'hr-chunk',
          rationale: 'hr included',
          confidence: 0.7,
        },
      ],
      joinedByKey: joinedByKeyFor([
        { docId: 'doc-payroll', chunkId: 'payroll-chunk', parent: payrollParent },
        { docId: 'doc-hr', chunkId: 'hr-chunk', parent: hrParent },
      ]),
    });

    expect(result.included).toHaveLength(2);
    expect(result.humanConfirmationRequired).toEqual([]);
    expect(result.humanReviewQuestions).toEqual([]);
  });

  it('does not invent chunk ids and only moves existing included refs', () => {
    const oldParent = parent({
      id: 'doc-old',
      fileName: '社内規程_2024.pdf',
      freshness: 'superseded_candidate',
      updatedAt: '2024-06-01T00:00:00.000Z',
    });
    const newParent = parent({
      id: 'doc-new',
      fileName: '社内規程_2026.pdf',
      freshness: 'current',
      updatedAt: '2026-06-01T00:00:00.000Z',
    });

    const included = [
      {
        docId: 'doc-old',
        chunkId: 'existing-old-chunk',
        rationale: 'included from batch 1',
        confidence: 0.75,
      },
      {
        docId: 'doc-new',
        chunkId: 'existing-new-chunk',
        rationale: 'included from batch 2',
        confidence: 0.9,
      },
    ];

    const result = applyDuplicateVersionAmbiguityGuard({
      included,
      joinedByKey: joinedByKeyFor([
        {
          docId: 'doc-old',
          chunkId: 'existing-old-chunk',
          parent: oldParent,
        },
        {
          docId: 'doc-new',
          chunkId: 'existing-new-chunk',
          parent: newParent,
        },
      ]),
    });

    const allChunkIds = [
      ...result.included.flatMap((ref) => [ref.chunkId]),
      ...result.humanConfirmationRequired.flatMap((ref) => [ref.chunkId]),
      ...result.humanReviewQuestions.flatMap((row) => row.relatedChunkIds ?? []),
    ];
    expect(allChunkIds.sort()).toEqual(
      ['existing-new-chunk', 'existing-old-chunk', 'existing-old-chunk'].sort(),
    );
    expect(result.included.map((ref) => ref.chunkId)).toEqual(['existing-new-chunk']);
    expect(result.humanConfirmationRequired.map((ref) => ref.chunkId)).toEqual([
      'existing-old-chunk',
    ]);
  });
});

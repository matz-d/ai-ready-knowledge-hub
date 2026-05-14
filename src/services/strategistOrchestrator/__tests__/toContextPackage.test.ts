import { describe, expect, it } from 'vitest';
import type { KnowledgeChunk } from '../../../lib/knowledgeChunkSchema';
import type {
  SafetyExcludedChunk,
  StrategistChunkSelection,
  StrategistOrchestratorResult,
} from '../types';
import { buildStrategistContextPackage } from '../toContextPackage';

function parent() {
  return {
    id: 'doc-1',
    fileName: 'policy.xlsx',
    documentType: '表' as const,
    businessDomain: '顧客対応' as const,
    freshness: 'current' as const,
    isAuthoritativeCandidate: true,
    updatedAt: '2026-05-14T00:00:00.000Z',
  };
}

function baseChunk(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    id: 'chunk-included',
    docId: 'doc-1',
    schemaVersion: 1,
    sourceType: 'spreadsheet',
    structureType: 'cellRange',
    locator: { kind: 'spreadsheet', sheetName: 'Data', range: 'A1:B2' },
    text: 'SECRET_PLAIN_TEXT_BODY',
    sensitivity: 'Internal',
    aiUsePolicy: 'direct',
    sensitivitySource: 'inherited',
    extractionProvider: 'xlsx',
    sourceHash: 'hash',
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
    ...overrides,
  };
}

function selection(
  chunk: KnowledgeChunk,
  rationale: string,
): StrategistChunkSelection {
  return {
    docId: chunk.docId,
    chunkId: chunk.id,
    rationale,
    chunk,
    parent: parent(),
  };
}

function minimalResult(
  overrides: Partial<StrategistOrchestratorResult> = {},
): StrategistOrchestratorResult {
  return {
    purpose: 'p',
    generatedAt: '2026-05-14T12:00:00.000Z',
    sourceDocumentsReviewed: 3,
    included: [],
    excluded: [],
    safetyExcluded: [],
    missing: [],
    humanReviewQuestions: [],
    ...overrides,
  };
}

describe('buildStrategistContextPackage', () => {
  it('puts only included chunks under Full AI-Ready Sources (markdown)', () => {
    const includedChunk = baseChunk({
      id: 'only-included',
      text: 'included body only',
    });
    const excludedChunk = baseChunk({
      id: 'strategist-out',
      text: 'STRATEGIST_EXCLUDED_BODY',
    });
    const safetyChunk = baseChunk({
      id: 'safety-out',
      text: 'SAFETY_EXCLUDED_SECRET',
      sensitivity: 'Restricted',
      aiUsePolicy: 'blocked',
    });

    const { markdown, input } = buildStrategistContextPackage(
      minimalResult({
        included: [selection(includedChunk, 'keep')],
        excluded: [selection(excludedChunk, 'drop')],
        safetyExcluded: [
          {
            docId: safetyChunk.docId,
            chunkId: safetyChunk.id,
            rationale: 'blocked',
            reason: 'restricted_sensitivity',
            chunk: safetyChunk,
            parent: parent(),
          } satisfies SafetyExcludedChunk,
        ],
      }),
    );

    const fullIdx = markdown.indexOf('# Full AI-Ready Sources');
    expect(fullIdx).toBeGreaterThan(-1);
    const fullSection = markdown.slice(fullIdx);

    expect(fullSection).toContain('included body only');
    expect(fullSection).not.toContain('STRATEGIST_EXCLUDED_BODY');
    expect(fullSection).not.toContain('SAFETY_EXCLUDED_SECRET');

    expect(input.includedDocuments).toHaveLength(1);
    expect(input.excludedDocuments).toHaveLength(1);
    expect(input.humanReviewDocuments).toHaveLength(1);
  });

  it('uses maskedText as Full AI-Ready body when requires_masking; raw text never appears there', () => {
    const chunk = baseChunk({
      id: 'masked-ch',
      aiUsePolicy: 'requires_masking',
      sensitivity: 'Confidential',
      text: 'DO_NOT_LEAK_RAW_CUSTOMER_NAME',
      maskedText: 'Customer [REDACTED]',
    });

    const { markdown, input } = buildStrategistContextPackage(
      minimalResult({
        included: [selection(chunk, 'masked path')],
      }),
    );

    const fullIdx = markdown.indexOf('# Full AI-Ready Sources');
    const fullSection = markdown.slice(fullIdx);

    expect(fullSection).toContain('Customer [REDACTED]');
    expect(fullSection).not.toContain('DO_NOT_LEAK_RAW_CUSTOMER_NAME');

    expect(input.includedDocuments[0]?.aiSafeContent).toBe('Customer [REDACTED]');
    expect(input.includedDocuments[0]?.aiSafeViaMasking).toBe(true);
  });

  it('throws when requires_masking chunk reaches included without maskedText (defense-in-depth; safety gate should have excluded)', () => {
    const chunk = baseChunk({
      id: 'no-mask',
      aiUsePolicy: 'requires_masking',
      sensitivity: 'Confidential',
      text: 'DO_NOT_LEAK_RAW_BODY',
      maskedText: '   ',
    });

    expect(() =>
      buildStrategistContextPackage(
        minimalResult({
          included: [selection(chunk, 'should never reach here')],
        }),
      ),
    ).toThrow(/requires masking but maskedText is unavailable/);
  });

  it('maps strategist excluded chunks to excludedDocuments and lists them in markdown', () => {
    const ex = baseChunk({ id: 'ex-1', text: 'stale content' });
    const { markdown, input } = buildStrategistContextPackage(
      minimalResult({
        excluded: [
          {
            ...selection(ex, 'too old for this purpose'),
            reason: 'superseded_or_stale',
          },
        ],
      }),
    );

    expect(input.excludedDocuments[0]?.fileName).toBe(
      'policy.xlsx (sheet=Data, range=A1:B2)',
    );
    expect(input.excludedDocuments[0]?.reason).toContain('too old for this purpose');
    expect(input.excludedDocuments[0]?.reason).toContain('superseded_or_stale');

    expect(markdown).toContain('## Excluded Documents');
    expect(markdown).toContain('policy.xlsx (sheet=Data, range=A1:B2)');
    expect(markdown).toContain('too old for this purpose');
  });

  it('maps missing and human review questions', () => {
    const { input } = buildStrategistContextPackage(
      minimalResult({
        missing: ['topic a'],
        humanReviewQuestions: ['q1?'],
      }),
    );
    expect(input.missingKnowledge).toEqual(['topic a']);
    expect(input.questionsForHumanOwner).toEqual(['q1?']);
  });

  it('matches markdown snapshot for a stable strategist-shaped payload', () => {
    const inc = baseChunk({
      id: 'inc',
      locator: { kind: 'paragraph' },
      text: 'hello',
    });
    const { markdown } = buildStrategistContextPackage(
      minimalResult({
        purpose: 'demo purpose',
        sourceDocumentsReviewed: 2,
        included: [selection(inc, 'rationale line')],
        excluded: [],
        safetyExcluded: [],
        missing: ['gap'],
        humanReviewQuestions: ['confirm?'],
      }),
    );
    expect(markdown).toMatchSnapshot();
  });
});

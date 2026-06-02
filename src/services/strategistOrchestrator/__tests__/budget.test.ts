import { describe, expect, it } from 'vitest';
import type { KnowledgeChunk } from '../../../lib/knowledgeChunkSchema';
import type { StrategistOrchestratorParent } from '../types';
import {
  applyStrategistInputBudget,
  estimateTokensFromChars,
  purposeTerms,
  scoringTextForChunk,
  type BudgetCandidate,
  type StrategistInputBudgetConfig,
} from '../budget';
import { buildStrategistContextPackage } from '../toContextPackage';

function parent(
  overrides: Partial<StrategistOrchestratorParent> = {},
): StrategistOrchestratorParent {
  return {
    id: 'doc-1',
    fileName: 'policy.xlsx',
    documentType: '表',
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

function candidate(
  chunkOverrides: Partial<KnowledgeChunk> = {},
  parentOverrides: Partial<StrategistOrchestratorParent> = {},
): BudgetCandidate {
  const c = chunk(chunkOverrides);
  return {
    chunk: c,
    parent: parent({ id: c.docId, ...parentOverrides }),
  };
}

const GENEROUS: StrategistInputBudgetConfig = {
  maxDocuments: 100,
  maxChunks: 100,
  maxTotalPromptChars: 1_000_000,
  maxCharsPerChunk: 1_200,
};

describe('scoringTextForChunk', () => {
  it('returns maskedText for requires_masking chunks and never raw text', () => {
    const c = chunk({
      aiUsePolicy: 'requires_masking',
      sensitivity: 'Confidential',
      text: 'RAW_PII_SHOULD_NOT_BE_READ',
      maskedText: 'masked body',
    });
    expect(scoringTextForChunk(c)).toBe('masked body');
  });

  it('returns empty string (not raw text) when requires_masking lacks maskedText', () => {
    const c = chunk({
      aiUsePolicy: 'requires_masking',
      sensitivity: 'Confidential',
      text: 'RAW_PII_SHOULD_NOT_BE_READ',
      maskedText: undefined,
    });
    expect(scoringTextForChunk(c)).toBe('');
  });

  it('uses raw text for direct chunks', () => {
    expect(scoringTextForChunk(chunk({ text: 'plain body' }))).toBe('plain body');
  });
});

describe('purposeTerms', () => {
  it('lowercases, splits on punctuation, dedupes, and drops 1-char tokens', () => {
    expect(purposeTerms('Tax FILING, deadline / tax')).toEqual([
      'tax',
      'filing',
      'deadline',
    ]);
  });
});

describe('estimateTokensFromChars', () => {
  it('estimates ~half a token per char (conservative, rounded up)', () => {
    expect(estimateTokensFromChars(101)).toBe(51);
    expect(estimateTokensFromChars(0)).toBe(0);
  });
});

describe('applyStrategistInputBudget', () => {
  it('keeps everything and reports zero dropped when under all limits', () => {
    const candidates = [
      candidate({ id: 'a', text: 'aaa' }),
      candidate({ id: 'b', text: 'bbb' }),
    ];
    const { kept, report } = applyStrategistInputBudget(candidates, 'purpose', GENEROUS);

    expect(kept.map((c) => c.id)).toEqual(['a', 'b']);
    expect(report.totalCandidates).toBe(2);
    expect(report.keptChunks).toBe(2);
    expect(report.droppedChunks).toBe(0);
    expect(report.keptDocuments).toBe(1);
    expect(report.estimatedPromptTokens).toBe(
      estimateTokensFromChars(report.estimatedPromptChars),
    );
  });

  it('enforces maxChunks and reports the dropped count', () => {
    const candidates = Array.from({ length: 5 }, (_, i) =>
      candidate({ id: `c-${i}`, text: 'body' }),
    );
    const { kept, report } = applyStrategistInputBudget(candidates, 'purpose', {
      ...GENEROUS,
      maxChunks: 2,
    });

    expect(kept).toHaveLength(2);
    expect(report.keptChunks).toBe(2);
    expect(report.droppedChunks).toBe(3);
  });

  it('enforces maxDocuments across distinct docIds', () => {
    const candidates = [
      candidate({ id: 'd1-a', docId: 'doc-1' }, { id: 'doc-1' }),
      candidate({ id: 'd2-a', docId: 'doc-2' }, { id: 'doc-2' }),
      candidate({ id: 'd1-b', docId: 'doc-1' }, { id: 'doc-1' }),
    ];
    const { kept, report } = applyStrategistInputBudget(candidates, 'purpose', {
      ...GENEROUS,
      maxDocuments: 1,
    });

    // Only chunks from the first accepted document survive; the other doc is dropped.
    expect(report.keptDocuments).toBe(1);
    expect(new Set(kept.map((c) => c.docId)).size).toBe(1);
    expect(kept.map((c) => c.id)).toEqual(['d1-a', 'd1-b']);
  });

  it('enforces maxTotalPromptChars but always admits at least the top chunk', () => {
    // overhead per chunk is 512; tiny bodies => ~512 chars each.
    const candidates = Array.from({ length: 4 }, (_, i) =>
      candidate({ id: `c-${i}`, text: 'x' }),
    );
    const { kept, report } = applyStrategistInputBudget(candidates, 'purpose', {
      ...GENEROUS,
      maxTotalPromptChars: 1_100,
    });

    expect(kept.length).toBeGreaterThanOrEqual(1);
    expect(kept).toHaveLength(2);
    expect(report.estimatedPromptChars).toBeLessThanOrEqual(1_100);
    expect(report.droppedChunks).toBe(2);
  });

  it('ranks by purpose relevance, not input order, when capacity is scarce', () => {
    const irrelevant = candidate({ id: 'irrelevant', text: 'unrelated content' });
    // The relevant chunk is placed LAST so a pass can only mean score (not order) won.
    const relevant = candidate({ id: 'relevant', text: 'tax filing deadline notice' });

    const { kept } = applyStrategistInputBudget(
      [irrelevant, relevant],
      'tax filing deadline',
      { ...GENEROUS, maxChunks: 1 },
    );

    expect(kept.map((c) => c.id)).toEqual(['relevant']);
  });

  it('does NOT read raw text of a requires_masking chunk when ranking', () => {
    // The masked chunk hides the purpose term inside raw `text`; its maskedText is
    // unrelated. A direct chunk carries the term in visible text. With capacity 1,
    // the masked chunk must lose because its raw text is invisible to the scorer.
    const masked = candidate({
      id: 'masked',
      aiUsePolicy: 'requires_masking',
      sensitivity: 'Confidential',
      text: 'tax filing deadline tax filing deadline', // raw — must be ignored
      maskedText: 'redacted summary',
    });
    const direct = candidate({ id: 'direct', text: 'tax filing deadline' });

    const { kept } = applyStrategistInputBudget(
      [masked, direct],
      'tax filing deadline',
      { ...GENEROUS, maxChunks: 1 },
    );

    expect(kept.map((c) => c.id)).toEqual(['direct']);
  });
});

describe('Context Package masked-text regression', () => {
  it('emits masked invoice text and never the raw invoice number', () => {
    const maskedChunk = chunk({
      id: 'invoice-chunk',
      aiUsePolicy: 'requires_masking',
      sensitivity: 'Confidential',
      text: 'invoice SYN-INV-2026-0501 for customer',
      maskedText: 'invoice SYN-INV-2[REDACTED:POSTAL_CODE] for customer',
    });

    const { markdown } = buildStrategistContextPackage({
      purpose: 'invoice review',
      generatedAt: '2026-05-14T12:00:00.000Z',
      sourceDocumentsReviewed: 1,
      included: [
        {
          docId: maskedChunk.docId,
          chunkId: maskedChunk.id,
          rationale: 'masked invoice body is AI-safe',
          chunk: maskedChunk,
          parent: parent(),
        },
      ],
      excluded: [],
      safetyExcluded: [],
      missing: [],
      humanReviewQuestions: [],
      budget: {
        config: GENEROUS,
        totalCandidates: 1,
        keptChunks: 1,
        droppedChunks: 0,
        keptDocuments: 1,
        estimatedPromptChars: 0,
        estimatedPromptTokens: 0,
      },
      syncEstimateSeconds: 0,
    });

    expect(markdown).toContain('SYN-INV-2[REDACTED:POSTAL_CODE]');
    expect(markdown).not.toContain('SYN-INV-2026-0501');
  });
});

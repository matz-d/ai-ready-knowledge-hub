import { describe, expect, it } from 'vitest';
import {
  computeChunkSourceHash,
  KnowledgeChunkSchema,
  type KnowledgeChunk,
  type KnowledgeChunkLocator,
} from '../../../lib/knowledgeChunkSchema';
import {
  StrategistChunkInputSchema,
  StrategistInputSchema,
  StrategistOutputCoreSchema,
  StrategistOutputSchema,
  strategistOutputUnknownChunkRefMessage,
} from '../schema';

const EXTRACTOR_INPUT = 'fixture-extractor-bytes';
const BASE_LOCATOR: KnowledgeChunkLocator = { kind: 'paragraph' };

function buildChunk(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  const locator = overrides.locator ?? BASE_LOCATOR;
  return KnowledgeChunkSchema.parse({
    id: overrides.id ?? 'chunk-1',
    docId: overrides.docId ?? 'doc-1',
    schemaVersion: 1,
    sourceType: 'text',
    structureType: 'paragraph',
    locator,
    text: 'plain body',
    sensitivity: 'Internal',
    aiUsePolicy: 'direct',
    sensitivitySource: 'inherited',
    extractionProvider: 'csv',
    sourceHash: computeChunkSourceHash({ extractorInput: EXTRACTOR_INPUT, locator }),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

const validParent = {
  docId: 'doc-1',
  fileName: 'memo.txt',
  documentType: 'メモ' as const,
  businessDomain: 'その他' as const,
  freshness: 'current' as const,
  isAuthoritativeCandidate: true,
  updatedAt: '2026-01-02T00:00:00.000Z',
};

describe('StrategistChunkInputSchema', () => {
  it('accepts chunk + parent when docIds align', () => {
    const parsed = StrategistChunkInputSchema.parse({
      chunk: buildChunk(),
      parent: validParent,
    });
    expect(parsed.chunk.docId).toBe('doc-1');
    expect(parsed.parent.fileName).toBe('memo.txt');
  });

  it('rejects parent.docId !== chunk.docId', () => {
    const result = StrategistChunkInputSchema.safeParse({
      chunk: buildChunk({ docId: 'doc-1' }),
      parent: { ...validParent, docId: 'doc-2' },
    });
    expect(result.success).toBe(false);
  });
});

describe('StrategistInputSchema', () => {
  it('parses purpose + chunkInputs', () => {
    const parsed = StrategistInputSchema.parse({
      purpose: 'test',
      chunkInputs: [{ chunk: buildChunk(), parent: validParent }],
    });
    expect(parsed.chunkInputs).toHaveLength(1);
  });
});

describe('StrategistOutputSchema', () => {
  const baseOutput = {
    included: [
      {
        docId: 'd1',
        chunkId: 'c1',
        rationale: '「plain」と本文にあり Purpose に合う根拠となる。',
        confidence: 0.9,
      },
    ],
    excluded: [] as {
      docId: string;
      chunkId: string;
      rationale: string;
      reason: 'purpose_mismatch';
    }[],
    missing: [] as { topic: string; whyNeeded: string }[],
    humanReviewQuestions: [] as { question: string }[],
  };

  it('accepts a minimal strategist-valid output', () => {
    const parsed = StrategistOutputSchema.parse(baseOutput);
    expect(parsed.included).toHaveLength(1);
  });

  it('rejects duplicate docId+chunkId within included', () => {
    const result = StrategistOutputSchema.safeParse({
      ...baseOutput,
      included: [
        baseOutput.included[0]!,
        { ...baseOutput.included[0]!, confidence: 0.5 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate docId+chunkId within excluded', () => {
    const row = {
      docId: 'd1',
      chunkId: 'c9',
      rationale: '根拠は本文と Purpose の関係で説明する。',
      reason: 'purpose_mismatch' as const,
    };
    const result = StrategistOutputSchema.safeParse({
      ...baseOutput,
      included: [],
      excluded: [row, row],
    });
    expect(result.success).toBe(false);
  });

  it('rejects the same chunk ref in included and excluded', () => {
    const result = StrategistOutputSchema.safeParse({
      ...baseOutput,
      excluded: [
        {
          docId: 'd1',
          chunkId: 'c1',
          rationale: 'Purpose と整合しないため除外。',
          reason: 'purpose_mismatch',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects safety_gate-origin exclusion reasons from the LLM', () => {
    const result = StrategistOutputSchema.safeParse({
      ...baseOutput,
      included: [],
      excluded: [
        {
          docId: 'd1',
          chunkId: 'c2',
          rationale: 'safety gate 由来は Strategist が出してはいけない。',
          reason: 'restricted_sensitivity',
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('StrategistOutputCoreSchema vs StrategistOutputSchema (safety_gate reasons)', () => {
  const outputWithSafetyGateReason = {
    included: [] as {
      docId: string;
      chunkId: string;
      rationale: string;
      confidence: number;
    }[],
    excluded: [
      {
        docId: 'd1',
        chunkId: 'c1',
        rationale: '構造上は旧 Core では safety_gate 理由も列挙値として通った。',
        reason: 'restricted_sensitivity' as const,
      },
    ],
    missing: [] as { topic: string; whyNeeded: string }[],
    humanReviewQuestions: [] as { question: string }[],
  };

  it('StrategistOutputCoreSchema rejects safety_gate-origin reasons at parse time', () => {
    const result = StrategistOutputCoreSchema.safeParse(outputWithSafetyGateReason);
    expect(result.success).toBe(false);
  });

  it('StrategistOutputSchema rejects safety_gate-origin reasons (final contract)', () => {
    const result = StrategistOutputSchema.safeParse(outputWithSafetyGateReason);
    expect(result.success).toBe(false);
  });
});

describe('strategistOutputUnknownChunkRefMessage', () => {
  const parentD1 = { ...validParent, docId: 'd1' };

  const strategistInput = StrategistInputSchema.parse({
    purpose: 'fixture purpose',
    chunkInputs: [
      {
        chunk: buildChunk({ id: 'c1', docId: 'd1' }),
        parent: parentD1,
      },
    ],
  });

  const matchingOutput = StrategistOutputSchema.parse({
    included: [
      {
        docId: 'd1',
        chunkId: 'c1',
        rationale: '「plain」と本文にあり Purpose に合う根拠となる。',
        confidence: 0.9,
      },
    ],
    excluded: [],
    missing: [],
    humanReviewQuestions: [
      { question: 'この chunk の前提は正しいか？', relatedChunkIds: ['c1'] },
    ],
  });

  it('returns undefined when included, excluded, and relatedChunkIds align with chunkInputs', () => {
    expect(strategistOutputUnknownChunkRefMessage(strategistInput, matchingOutput)).toBeUndefined();
  });

  it('rejects included row whose docId+chunkId is not in chunkInputs', () => {
    const bad = StrategistOutputSchema.parse({
      ...matchingOutput,
      included: [
        {
          docId: 'phantom-doc',
          chunkId: 'c1',
          rationale: '「plain」と本文にあり Purpose に合う根拠となる。',
          confidence: 0.9,
        },
      ],
    });
    expect(strategistOutputUnknownChunkRefMessage(strategistInput, bad)).toMatch(/included\[0\]/);
  });

  it('rejects excluded row whose docId+chunkId is not in chunkInputs', () => {
    const bad = StrategistOutputSchema.parse({
      ...matchingOutput,
      included: [],
      excluded: [
        {
          docId: 'd1',
          chunkId: 'ghost-chunk',
          rationale: '除外根拠。',
          reason: 'purpose_mismatch',
        },
      ],
    });
    expect(strategistOutputUnknownChunkRefMessage(strategistInput, bad)).toMatch(/excluded\[0\]/);
  });

  it('rejects humanReviewQuestions.relatedChunkIds not in input chunk ids', () => {
    const bad = StrategistOutputSchema.parse({
      ...matchingOutput,
      humanReviewQuestions: [{ question: 'q', relatedChunkIds: ['not-a-chunk'] }],
    });
    expect(strategistOutputUnknownChunkRefMessage(strategistInput, bad)).toMatch(
      /humanReviewQuestions\[0\]\.relatedChunkIds\[0\]/,
    );
  });
});

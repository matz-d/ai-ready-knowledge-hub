import { describe, expect, it } from 'vitest';
import {
  assertKnowledgeChunkInvariants,
  computeChunkSourceHash,
  KnowledgeChunkSchema,
  KnowledgeChunkLocatorSchema,
  validateKnowledgeChunkInvariants,
  type KnowledgeChunk,
  type KnowledgeChunkLocator,
} from '../knowledgeChunkSchema';
import {
  AiUsePolicyEnum,
  SensitivityEnum,
  expectedAiUsePolicy,
} from '../../agents/curator/schema';

const EXTRACTOR_INPUT = 'fixture-extractor-bytes';
const DOC_ID = 'doc-parent-1';

function hashFor(locator: KnowledgeChunkLocator): string {
  return computeChunkSourceHash({
    extractorInput: EXTRACTOR_INPUT,
    locator,
  });
}

function buildChunk(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  const locator: KnowledgeChunkLocator =
    overrides.locator ?? ({ kind: 'paragraph' } as const);
  const base = {
    id: 'chunk-1',
    docId: DOC_ID,
    schemaVersion: 1 as const,
    sourceType: 'text' as const,
    structureType: 'paragraph' as const,
    locator,
    text: 'body',
    sensitivity: 'Internal' as const,
    aiUsePolicy: 'direct' as const,
    sensitivitySource: 'inherited' as const,
    extractionProvider: 'csv' as const,
    sourceHash: hashFor(locator),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return KnowledgeChunkSchema.parse({ ...base, ...overrides });
}

const validParent = { id: DOC_ID, status: 'curated' as const };

describe('KnowledgeChunkLocatorSchema', () => {
  it('parses all five locator variants', () => {
    const spreadsheet: KnowledgeChunkLocator = {
      kind: 'spreadsheet',
      sheetName: 'Sheet1',
      range: 'A1:E20',
    };
    const pdf: KnowledgeChunkLocator = {
      kind: 'pdf',
      page: 3,
      paragraphId: 'p-9',
    };
    const slide: KnowledgeChunkLocator = { kind: 'slide', slide: 2 };
    const imageText: KnowledgeChunkLocator = { kind: 'imageText' };
    const paragraph: KnowledgeChunkLocator = { kind: 'paragraph' };

    expect(KnowledgeChunkLocatorSchema.parse(spreadsheet)).toEqual(spreadsheet);
    expect(KnowledgeChunkLocatorSchema.parse(pdf)).toEqual(pdf);
    expect(KnowledgeChunkLocatorSchema.parse(slide)).toEqual(slide);
    expect(KnowledgeChunkLocatorSchema.parse(imageText)).toEqual(imageText);
    expect(KnowledgeChunkLocatorSchema.parse(paragraph)).toEqual(paragraph);
  });
});

describe('KnowledgeChunkSchema', () => {
  it('uses the shared sensitivity and aiUsePolicy enum values', () => {
    expect(SensitivityEnum.options).toEqual([
      'Public',
      'Internal',
      'Confidential',
      'Restricted',
    ]);
    expect(AiUsePolicyEnum.options).toEqual([
      'direct',
      'requires_masking',
      'blocked',
    ]);
  });

  it('parses a valid chunk for each locator variant', () => {
    const locators: KnowledgeChunkLocator[] = [
      { kind: 'spreadsheet', sheetName: 'S', range: 'A1:B2' },
      { kind: 'pdf', page: 1 },
      { kind: 'slide', slide: 1 },
      { kind: 'imageText' },
      { kind: 'paragraph' },
    ];

    for (const locator of locators) {
      const chunk = buildChunk({
        locator,
        sourceHash: hashFor(locator),
      });
      expect(chunk.locator).toEqual(locator);
    }
  });
});

describe('computeChunkSourceHash', () => {
  it('returns the same hash for the same extractor input and locator', () => {
    const locator: KnowledgeChunkLocator = {
      kind: 'spreadsheet',
      sheetName: 'Prices',
      range: 'A1:C10',
    };
    const input = { extractorInput: 'same', locator };
    expect(computeChunkSourceHash(input)).toBe(
      computeChunkSourceHash(input)
    );
  });

  it('changes when extractor input or locator changes', () => {
    const a = computeChunkSourceHash({
      extractorInput: 'x',
      locator: { kind: 'paragraph' },
    });
    const b = computeChunkSourceHash({
      extractorInput: 'y',
      locator: { kind: 'paragraph' },
    });
    const c = computeChunkSourceHash({
      extractorInput: 'x',
      locator: { kind: 'slide', slide: 1 },
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('validateKnowledgeChunkInvariants', () => {
  it.each(SensitivityEnum.options)(
    'accepts the expected aiUsePolicy for sensitivity %s',
    (sensitivity) => {
      const locator: KnowledgeChunkLocator = { kind: 'paragraph' };
      const expectedPolicy = expectedAiUsePolicy(sensitivity);
      const chunk = buildChunk({
        locator,
        sensitivity,
        aiUsePolicy: expectedPolicy,
        maskedText:
          expectedPolicy === 'requires_masking' ? '[REDACTED]' : undefined,
        sourceHash: hashFor(locator),
      });

      expect(
        validateKnowledgeChunkInvariants(chunk, {
          parentDocument: validParent,
          extractorInput: EXTRACTOR_INPUT,
        })
      ).toEqual({ ok: true });
    }
  );

  it.each([
    ['Public', 'blocked'],
    ['Internal', 'requires_masking'],
    ['Confidential', 'direct'],
    ['Restricted', 'requires_masking'],
  ] as const)(
    'rejects mismatched aiUsePolicy %s -> %s',
    (sensitivity, aiUsePolicy) => {
      const locator: KnowledgeChunkLocator = { kind: 'paragraph' };
      const chunk = buildChunk({
        locator,
        sensitivity,
        aiUsePolicy,
        maskedText:
          aiUsePolicy === 'requires_masking' ? '[REDACTED]' : undefined,
        sourceHash: hashFor(locator),
      });

      const result = validateKnowledgeChunkInvariants(chunk, {
        parentDocument: validParent,
        extractorInput: EXTRACTOR_INPUT,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(
          result.errors.some((e) =>
            e.includes(
              `When sensitivity is ${sensitivity}, aiUsePolicy must be ${expectedAiUsePolicy(sensitivity)}`
            )
          )
        ).toBe(true);
      }
    }
  );

  it('returns ok when all invariants hold', () => {
    const locator: KnowledgeChunkLocator = { kind: 'paragraph' };
    const chunk = buildChunk({
      locator,
      sensitivity: 'Confidential',
      aiUsePolicy: 'requires_masking',
      maskedText: '[REDACTED]',
      sourceHash: hashFor(locator),
    });
    expect(
      validateKnowledgeChunkInvariants(chunk, {
        parentDocument: validParent,
        extractorInput: EXTRACTOR_INPUT,
      })
    ).toEqual({ ok: true });
  });

  it('rule 1: rejects parent id mismatch', () => {
    const chunk = buildChunk();
    const result = validateKnowledgeChunkInvariants(chunk, {
      parentDocument: { id: 'other-doc', status: 'curated' },
      extractorInput: EXTRACTOR_INPUT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('parentDocument.id'))).toBe(
        true
      );
    }
  });

  it('rule 1: rejects non-terminal parent status', () => {
    const chunk = buildChunk();
    const result = validateKnowledgeChunkInvariants(chunk, {
      parentDocument: { id: DOC_ID, status: 'masking' },
      extractorInput: EXTRACTOR_INPUT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) => e.includes('parentDocument.status'))
      ).toBe(true);
    }
  });

  it('rule 2: Restricted requires aiUsePolicy blocked', () => {
    const locator: KnowledgeChunkLocator = { kind: 'paragraph' };
    const chunk = buildChunk({
      locator,
      sensitivity: 'Restricted',
      aiUsePolicy: 'direct',
      sourceHash: hashFor(locator),
    });
    const result = validateKnowledgeChunkInvariants(chunk, {
      parentDocument: validParent,
      extractorInput: EXTRACTOR_INPUT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('Restricted'))).toBe(true);
    }
  });

  it('rule 3: Confidential requires requires_masking', () => {
    const locator: KnowledgeChunkLocator = { kind: 'paragraph' };
    const chunk = buildChunk({
      locator,
      sensitivity: 'Confidential',
      aiUsePolicy: 'direct',
      sourceHash: hashFor(locator),
    });
    const result = validateKnowledgeChunkInvariants(chunk, {
      parentDocument: validParent,
      extractorInput: EXTRACTOR_INPUT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('Confidential'))).toBe(
        true
      );
    }
  });

  it('rule 4: requires_masking requires maskedText', () => {
    const locator: KnowledgeChunkLocator = { kind: 'paragraph' };
    const chunk = buildChunk({
      locator,
      sensitivity: 'Confidential',
      aiUsePolicy: 'requires_masking',
      maskedText: undefined,
      sourceHash: hashFor(locator),
    });
    const result = validateKnowledgeChunkInvariants(chunk, {
      parentDocument: validParent,
      extractorInput: EXTRACTOR_INPUT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('maskedText'))).toBe(true);
    }
  });

  it('rule 5: columnRule requires non-empty sensitivityReason', () => {
    const locator: KnowledgeChunkLocator = { kind: 'paragraph' };
    const chunk = buildChunk({
      locator,
      sensitivitySource: 'columnRule',
      sensitivityReason: '   ',
      sourceHash: hashFor(locator),
    });
    const result = validateKnowledgeChunkInvariants(chunk, {
      parentDocument: validParent,
      extractorInput: EXTRACTOR_INPUT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('columnRule'))).toBe(true);
    }
  });

  it('rule 6: rejects sourceHash mismatch', () => {
    const locator: KnowledgeChunkLocator = { kind: 'paragraph' };
    const chunk = buildChunk({
      locator,
      sourceHash: 'deadbeef',
    });
    const result = validateKnowledgeChunkInvariants(chunk, {
      parentDocument: validParent,
      extractorInput: EXTRACTOR_INPUT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('sourceHash'))).toBe(true);
    }
  });

  it('assertKnowledgeChunkInvariants throws with a consolidated message', () => {
    expect(() =>
      assertKnowledgeChunkInvariants(buildChunk(), {
        parentDocument: { id: 'wrong', status: 'curated' },
        extractorInput: EXTRACTOR_INPUT,
      })
    ).toThrow(/Knowledge chunk invariant violations/);
  });
});

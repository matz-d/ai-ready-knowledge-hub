import { describe, expect, it } from 'vitest';
import {
  computeChunkSourceHash,
  KnowledgeChunkSchema,
  type KnowledgeChunk,
  type KnowledgeChunkLocator,
} from '../../../lib/knowledgeChunkSchema';
import { maskKnowledgeChunk } from '../maskKnowledgeChunk';

const EXTRACTOR_INPUT = 'fixture-extractor-bytes';
const DOC_ID = 'doc-1';
const BASE_LOCATOR: KnowledgeChunkLocator = { kind: 'paragraph' };

function buildChunk(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  const locator = overrides.locator ?? BASE_LOCATOR;
  return KnowledgeChunkSchema.parse({
    id: 'chunk-1',
    docId: DOC_ID,
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

describe('maskKnowledgeChunk', () => {
  it('masks text and populates maskedText/maskedSpansCount/ruleHits when requires_masking', async () => {
    const chunk = buildChunk({
      sensitivity: 'Confidential',
      aiUsePolicy: 'requires_masking',
      text: 'Contact test@example.com for details',
    });

    const result = await maskKnowledgeChunk(chunk, { provider: 'simple-rule' });

    expect(result.maskedText).toBe('Contact [REDACTED:EMAIL] for details');
    expect(result.maskedSpansCount).toBe(1);
    expect(result.ruleHits).toEqual({ email: 1 });
    expect(result.text).toBe('Contact test@example.com for details');
  });

  it('returns the same chunk reference (no-op) when aiUsePolicy is direct', async () => {
    const chunk = buildChunk({
      sensitivity: 'Internal',
      aiUsePolicy: 'direct',
      text: 'Contact test@example.com for details',
    });

    const result = await maskKnowledgeChunk(chunk, { provider: 'simple-rule' });

    expect(result).toBe(chunk);
    expect(result.maskedText).toBeUndefined();
  });

  it('returns the same chunk reference (no-op) when aiUsePolicy is blocked', async () => {
    const chunk = buildChunk({
      sensitivity: 'Restricted',
      aiUsePolicy: 'blocked',
      text: 'Secret test@example.com data',
    });

    const result = await maskKnowledgeChunk(chunk, { provider: 'simple-rule' });

    expect(result).toBe(chunk);
    expect(result.maskedText).toBeUndefined();
  });

  it('masks multiple PII types deterministically with simple-rule provider', async () => {
    const chunk = buildChunk({
      sensitivity: 'Confidential',
      aiUsePolicy: 'requires_masking',
      text: '担当：田中 太郎\n電話: 03-1234-5678',
    });

    const result = await maskKnowledgeChunk(chunk, { provider: 'simple-rule' });

    expect(result.maskedText).toContain('[REDACTED:');
    expect(result.maskedSpansCount).toBeGreaterThanOrEqual(1);
    expect(result.ruleHits).toBeDefined();
    // original unchanged
    expect(result.text).toBe('担当：田中 太郎\n電話: 03-1234-5678');
  });
});

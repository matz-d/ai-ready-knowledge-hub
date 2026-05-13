import { describe, expect, it } from 'vitest';
import {
  computeChunkSourceHash,
  KnowledgeChunkSchema,
  type KnowledgeChunk,
  type KnowledgeChunkLocator,
} from '../../../lib/knowledgeChunkSchema';
import {
  runSafetyGate,
  type CrossCustomerDetector,
} from '../safetyGate';
import { ExclusionReasonOrigin } from '../schema';

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

const CTX = { purpose: 'test purpose' };

describe('runSafetyGate', () => {
  it('passes through safe Public/Internal chunks unchanged', () => {
    const chunks = [
      buildChunk({ id: 'c1', sensitivity: 'Public', aiUsePolicy: 'direct' }),
      buildChunk({ id: 'c2', sensitivity: 'Internal', aiUsePolicy: 'direct' }),
    ];
    const result = runSafetyGate(chunks, CTX);
    expect(result.safe).toHaveLength(2);
    expect(result.excluded).toHaveLength(0);
  });

  it('excludes Restricted sensitivity with restricted_sensitivity reason', () => {
    const chunk = buildChunk({
      id: 'c1',
      sensitivity: 'Restricted',
      aiUsePolicy: 'blocked',
    });
    const result = runSafetyGate([chunk], CTX);
    expect(result.safe).toHaveLength(0);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]).toMatchObject({
      docId: 'doc-1',
      chunkId: 'c1',
      reason: 'restricted_sensitivity',
    });
  });

  it('excludes blocked aiUsePolicy even when sensitivity is not Restricted (defense in depth)', () => {
    // 通常ありえない組み合わせだが、二重防御を確認するため
    const chunk = buildChunk({
      id: 'c1',
      sensitivity: 'Confidential',
      aiUsePolicy: 'blocked',
    });
    const result = runSafetyGate([chunk], CTX);
    expect(result.excluded[0]?.reason).toBe('restricted_sensitivity');
  });

  it('excludes requires_masking chunks without maskedText as masking_required_unavailable', () => {
    const chunk = buildChunk({
      id: 'c1',
      sensitivity: 'Confidential',
      aiUsePolicy: 'requires_masking',
      maskedText: undefined,
    });
    const result = runSafetyGate([chunk], CTX);
    expect(result.excluded[0]).toMatchObject({
      chunkId: 'c1',
      reason: 'masking_required_unavailable',
    });
  });

  it('passes through requires_masking chunks WITH maskedText', () => {
    const chunk = buildChunk({
      id: 'c1',
      sensitivity: 'Confidential',
      aiUsePolicy: 'requires_masking',
      maskedText: 'masked body',
    });
    const result = runSafetyGate([chunk], CTX);
    expect(result.safe).toHaveLength(1);
    expect(result.excluded).toHaveLength(0);
  });

  it('excludes requires_masking when maskedText is whitespace-only', () => {
    const chunk = buildChunk({
      id: 'c1',
      sensitivity: 'Confidential',
      aiUsePolicy: 'requires_masking',
      maskedText: '   \n\t  ',
    });
    const result = runSafetyGate([chunk], CTX);
    expect(result.safe).toHaveLength(0);
    expect(result.excluded[0]).toMatchObject({
      chunkId: 'c1',
      reason: 'masking_required_unavailable',
    });
  });

  it('uses crossCustomerDetector when provided', () => {
    const c1 = buildChunk({ id: 'c1' });
    const c2 = buildChunk({ id: 'c2' });
    const detector: CrossCustomerDetector = (chunk) => chunk.id === 'c2';
    const result = runSafetyGate([c1, c2], CTX, { crossCustomerDetector: detector });
    expect(result.safe.map((c) => c.id)).toEqual(['c1']);
    expect(result.excluded[0]).toMatchObject({
      chunkId: 'c2',
      reason: 'cross_customer_confidentiality',
    });
  });

  it('default behavior is no cross-customer detection (Phase 3-C-1 has no clientScope yet)', () => {
    const chunk = buildChunk({ id: 'c1' });
    const result = runSafetyGate([chunk], CTX);
    expect(result.safe).toHaveLength(1);
  });

  it('all emitted exclusion reasons are safety_gate origin (architectural invariant)', () => {
    const chunks = [
      buildChunk({ id: 'r1', sensitivity: 'Restricted', aiUsePolicy: 'blocked' }),
      buildChunk({
        id: 'm1',
        sensitivity: 'Confidential',
        aiUsePolicy: 'requires_masking',
      }),
      buildChunk({ id: 'x1' }),
    ];
    const result = runSafetyGate(chunks, CTX, {
      crossCustomerDetector: (c) => c.id === 'x1',
    });
    for (const ex of result.excluded) {
      expect(ExclusionReasonOrigin[ex.reason]).toBe('safety_gate');
    }
  });

  it('preserves input order in safe[] (orchestrator may rely on positional info)', () => {
    const chunks = [
      buildChunk({ id: 'a' }),
      buildChunk({ id: 'b', sensitivity: 'Restricted', aiUsePolicy: 'blocked' }),
      buildChunk({ id: 'c' }),
    ];
    const result = runSafetyGate(chunks, CTX);
    expect(result.safe.map((c) => c.id)).toEqual(['a', 'c']);
  });
});

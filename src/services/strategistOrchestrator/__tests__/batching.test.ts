import { describe, expect, it } from 'vitest';
import type { KnowledgeChunk } from '../../../lib/knowledgeChunkSchema';
import type { StrategistOrchestratorParent } from '../types';
import {
  batchSatisfiesBudget,
  partitionStrategistBatches,
  preservesChunkOrderWithinDocuments,
} from '../batching';
import {
  DEFAULT_STRATEGIST_INPUT_BUDGET,
  type BudgetCandidate,
  type StrategistInputBudgetConfig,
} from '../budget';

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

function candidate(
  chunkOverrides: Partial<KnowledgeChunk> = {},
  parentOverrides: Partial<StrategistOrchestratorParent> = {},
): BudgetCandidate {
  const row = chunk(chunkOverrides);
  return {
    chunk: row,
    parent: parent({ id: row.docId, ...parentOverrides }),
  };
}

const TIGHT: StrategistInputBudgetConfig = {
  maxDocuments: 2,
  maxChunks: 3,
  maxTotalPromptChars: 10_000,
  maxCharsPerChunk: 200,
};

describe('partitionStrategistBatches', () => {
  it('covers every candidate exactly once (disjoint full coverage)', () => {
    const candidates = [
      candidate({ id: 'c1', docId: 'doc-a' }),
      candidate({ id: 'c2', docId: 'doc-a' }),
      candidate({ id: 'c3', docId: 'doc-b' }),
      candidate({ id: 'c4', docId: 'doc-c' }),
    ];

    const { batches } = partitionStrategistBatches(
      candidates,
      'test purpose',
      TIGHT,
    );
    const flattened = batches.flat();
    const ids = flattened.map((row) => `${row.chunk.docId}/${row.chunk.id}`);

    expect(flattened).toHaveLength(candidates.length);
    expect(new Set(ids).size).toBe(candidates.length);
    expect(ids.sort()).toEqual(
      candidates.map((row) => `${row.chunk.docId}/${row.chunk.id}`).sort(),
    );
  });

  it('is deterministic for the same input', () => {
    const candidates = Array.from({ length: 12 }, (_, index) =>
      candidate({
        id: `chunk-${index}`,
        docId: `doc-${index % 4}`,
        text: `body-${index}`,
      }),
    );

    const first = partitionStrategistBatches(candidates, 'payroll training', TIGHT);
    const second = partitionStrategistBatches(candidates, 'payroll training', TIGHT);

    expect(first.batches.map((batch) => batch.map((row) => row.chunk.id))).toEqual(
      second.batches.map((batch) => batch.map((row) => row.chunk.id)),
    );
  });

  it('splits a huge single document across consecutive batches', () => {
    const hugeDocChunks = Array.from({ length: 7 }, (_, index) =>
      candidate({
        id: `huge-${index}`,
        docId: 'huge-doc',
        text: 'x'.repeat(100),
      }),
    );
    const config: StrategistInputBudgetConfig = {
      ...DEFAULT_STRATEGIST_INPUT_BUDGET,
      maxDocuments: 5,
      maxChunks: 3,
      maxTotalPromptChars: 50_000,
    };

    const { batches } = partitionStrategistBatches(
      hugeDocChunks,
      'test',
      config,
    );

    expect(batches.length).toBeGreaterThan(1);
    const hugeDocBatchIndexes = batches
      .map((batch, index) =>
        batch.some((row) => row.chunk.docId === 'huge-doc') ? index : -1,
      )
      .filter((index) => index >= 0);
    expect(hugeDocBatchIndexes).toEqual([0, 1, 2]);
    expect(preservesChunkOrderWithinDocuments(batches, hugeDocChunks)).toBe(true);
  });

  it('keeps a non-huge document together by starting a new batch', () => {
    const candidates = [
      candidate({ id: 'a-1', docId: 'doc-a', text: 'a'.repeat(100) }),
      candidate({ id: 'a-2', docId: 'doc-a', text: 'a'.repeat(100) }),
      candidate({ id: 'b-1', docId: 'doc-b', text: 'b'.repeat(100) }),
      candidate({ id: 'b-2', docId: 'doc-b', text: 'b'.repeat(100) }),
    ];
    const config: StrategistInputBudgetConfig = {
      maxDocuments: 2,
      maxChunks: 3,
      maxTotalPromptChars: 10_000,
      maxCharsPerChunk: 200,
    };

    const { batches } = partitionStrategistBatches(
      candidates,
      'test',
      config,
    );

    expect(batches.map((batch) => batch.map((row) => row.chunk.id))).toEqual([
      ['a-1', 'a-2'],
      ['b-1', 'b-2'],
    ]);
  });

  it('obeys maxDocuments, maxChunks, and maxTotalPromptChars per batch', () => {
    const candidates = [
      ...Array.from({ length: 5 }, (_, index) =>
        candidate({
          id: `a-${index}`,
          docId: 'doc-a',
          text: 'a'.repeat(150),
        }),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        candidate({
          id: `b-${index}`,
          docId: 'doc-b',
          text: 'b'.repeat(150),
        }),
      ),
      candidate({ id: 'c-1', docId: 'doc-c', text: 'c'.repeat(150) }),
      candidate({ id: 'd-1', docId: 'doc-d', text: 'd'.repeat(150) }),
    ];

    const { batches } = partitionStrategistBatches(candidates, 'test', TIGHT);

    for (const batch of batches) {
      expect(batchSatisfiesBudget(batch, TIGHT)).toBe(true);
    }
  });

  it('orders documents by relevance so higher-scoring docs appear earlier', () => {
    const candidates = [
      candidate(
        { id: 'low-1', docId: 'low-doc', text: 'unrelated filler' },
        {
          id: 'low-doc',
          fileName: 'filler.md',
          freshness: 'superseded_candidate',
        },
      ),
      candidate(
        { id: 'high-1', docId: 'high-doc', text: 'payroll calculation checklist' },
        {
          id: 'high-doc',
          fileName: '給与計算チェックリスト.md',
          businessDomain: '給与計算',
          freshness: 'current',
        },
      ),
    ];

    const { batches } = partitionStrategistBatches(
      candidates,
      'payroll calculation training',
      {
        ...DEFAULT_STRATEGIST_INPUT_BUDGET,
        maxDocuments: 1,
        maxChunks: 1,
      },
    );

    expect(batches[0]?.[0]?.chunk.docId).toBe('high-doc');
    expect(batches[1]?.[0]?.chunk.docId).toBe('low-doc');
  });

  it('returns empty batches for empty input', () => {
    const result = partitionStrategistBatches([], 'test');
    expect(result.batches).toEqual([]);
    expect(result.stats.totalCandidates).toBe(0);
    expect(result.stats.batchCount).toBe(0);
  });
});

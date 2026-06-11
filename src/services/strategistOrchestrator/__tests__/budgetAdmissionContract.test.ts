import { describe, expect, it } from 'vitest';
import type { KnowledgeChunk } from '../../../lib/knowledgeChunkSchema';
import type { StrategistOrchestratorParent } from '../types';
import {
  applyStrategistInputBudget,
  admitChunkToBudget,
  batchSatisfiesBudgetContract,
  chunkAdmitsToBudget,
  emptyBudgetAdmissionAccumulator,
  type BudgetCandidate,
  type StrategistInputBudgetConfig,
} from '../budget';
import { batchSatisfiesBudget, partitionStrategistBatches } from '../batching';

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

const CONFIG: StrategistInputBudgetConfig = {
  maxDocuments: 2,
  maxChunks: 3,
  maxTotalPromptChars: 2_000,
  maxCharsPerChunk: 200,
};

function keptSetSatisfiesContract(
  kept: readonly BudgetCandidate[],
  config: StrategistInputBudgetConfig,
): boolean {
  return batchSatisfiesBudgetContract(kept, config);
}

describe('shared budget admission contract', () => {
  it('keeps the first chunk even when it alone exceeds maxTotalPromptChars', () => {
    const huge = candidate({ id: 'huge', text: 'x'.repeat(5_000) });
    const accumulator = emptyBudgetAdmissionAccumulator();

    expect(chunkAdmitsToBudget(accumulator, huge, CONFIG)).toBe(true);
  });

  it('rejects a second chunk that would exceed maxTotalPromptChars', () => {
    const first = candidate({ id: 'first', text: 'x'.repeat(1_000) });
    const second = candidate({ id: 'second', text: 'y'.repeat(1_000) });
    const config: StrategistInputBudgetConfig = {
      ...CONFIG,
      maxTotalPromptChars: 1_100,
    };
    const accumulator = emptyBudgetAdmissionAccumulator();
    expect(chunkAdmitsToBudget(accumulator, first, config)).toBe(true);
    admitChunkToBudget(accumulator, first, config);

    expect(chunkAdmitsToBudget(accumulator, second, config)).toBe(false);
  });

  it('applyStrategistInputBudget kept set satisfies the shared contract', () => {
    const candidates = [
      candidate({ id: 'a-1', docId: 'doc-a', text: 'a'.repeat(120) }),
      candidate({ id: 'a-2', docId: 'doc-a', text: 'a'.repeat(120) }),
      candidate({ id: 'b-1', docId: 'doc-b', text: 'b'.repeat(120) }),
      candidate({ id: 'c-1', docId: 'doc-c', text: 'c'.repeat(120) }),
      candidate({ id: 'd-1', docId: 'doc-d', text: 'd'.repeat(120) }),
    ];

    const { kept } = applyStrategistInputBudget(
      candidates,
      'payroll training',
      CONFIG,
    );

    expect(keptSetSatisfiesContract(
      kept.map((row) => candidate({ id: row.id, docId: row.docId, text: row.text })),
      CONFIG,
    )).toBe(true);
  });

  it('every partition batch satisfies the same shared contract', () => {
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

    const { batches } = partitionStrategistBatches(
      candidates,
      'test purpose',
      CONFIG,
    );

    for (const batch of batches) {
      expect(batchSatisfiesBudget(batch, CONFIG)).toBe(true);
      expect(batchSatisfiesBudgetContract(batch, CONFIG)).toBe(true);
    }
  });
});

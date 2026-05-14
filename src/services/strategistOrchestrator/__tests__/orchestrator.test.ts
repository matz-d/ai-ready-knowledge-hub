import { describe, expect, it, vi } from 'vitest';
import {
  NoInventoryDocumentsError,
  NoKnowledgeChunksError,
  runStrategistOrchestrator,
  type RunStrategistOrchestratorDeps,
} from '../orchestrator';
import type { StrategistOutput } from '../../../agents/strategist/schema';
import type { InventoryDocument } from '../../../lib/inventory';
import type { KnowledgeChunk } from '../../../lib/knowledgeChunkSchema';

function inventoryDoc(
  overrides: Partial<InventoryDocument> = {},
): InventoryDocument {
  return {
    id: 'doc-1',
    fileName: 'sample.md',
    status: 'curated',
    documentType: 'メモ',
    businessDomain: '顧客対応',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    aiUsePolicy: 'direct',
    rationale: 'AI に渡せる社内メモです。',
    sensitivitySource: 'curator',
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
    text: 'default chunk text',
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

function deps(params: {
  documents?: InventoryDocument[];
  chunksByDocId?: Record<string, KnowledgeChunk[]>;
  safetyGate?: RunStrategistOrchestratorDeps['safetyGate'];
  strategistFlow?: RunStrategistOrchestratorDeps['strategistFlow'];
}): Required<RunStrategistOrchestratorDeps> {
  const listInventoryDocuments = vi.fn(async () => params.documents ?? []);
  const listChunks = vi.fn(async (documentId: string) =>
    params.chunksByDocId?.[documentId] ?? [],
  );
  const safetyGate =
    params.safetyGate ??
    (vi.fn((chunks: readonly KnowledgeChunk[]) => ({
      safe: [...chunks],
      excluded: [],
    })) as unknown as RunStrategistOrchestratorDeps['safetyGate']);
  const strategistFlow =
    params.strategistFlow ??
    (vi.fn(async () => ({
      included: [],
      excluded: [],
      missing: [],
      humanReviewQuestions: [],
    })) as unknown as RunStrategistOrchestratorDeps['strategistFlow']);

  return {
    listInventoryDocuments,
    listChunks,
    safetyGate: safetyGate!,
    strategistFlow: strategistFlow!,
  };
}

describe('runStrategistOrchestrator', () => {
  it('throws NoInventoryDocumentsError when inventory is empty', async () => {
    const injected = deps({});

    await expect(
      runStrategistOrchestrator({ purpose: 'test' }, injected),
    ).rejects.toBeInstanceOf(NoInventoryDocumentsError);

    expect(injected.listChunks).not.toHaveBeenCalled();
    expect(injected.strategistFlow).not.toHaveBeenCalled();
  });

  it('throws NoKnowledgeChunksError when terminal inventory has no chunks', async () => {
    const injected = deps({
      documents: [inventoryDoc()],
      chunksByDocId: { 'doc-1': [] },
    });

    await expect(
      runStrategistOrchestrator({ purpose: 'test' }, injected),
    ).rejects.toBeInstanceOf(NoKnowledgeChunksError);

    expect(injected.listChunks).toHaveBeenCalledWith('doc-1');
    expect(injected.strategistFlow).not.toHaveBeenCalled();
  });

  it('does not call strategistFlow when all chunks are safety excluded', async () => {
    const safeRejected = chunk({
      id: 'restricted-chunk',
      sensitivity: 'Restricted',
      aiUsePolicy: 'blocked',
    });
    const strategistFlowStub = vi.fn(async () => {
      throw new Error('strategistFlow must not be called');
    }) as unknown as RunStrategistOrchestratorDeps['strategistFlow'];
    const safetyGateStub = vi.fn((chunks: readonly KnowledgeChunk[]) => ({
      safe: [],
      excluded: chunks.map((row) => ({
        docId: row.docId,
        chunkId: row.id,
        rationale: 'safety gate rejected the chunk',
        reason: 'restricted_sensitivity' as const,
      })),
    })) as unknown as RunStrategistOrchestratorDeps['safetyGate'];
    const injected = deps({
      documents: [inventoryDoc()],
      chunksByDocId: { 'doc-1': [safeRejected] },
      strategistFlow: strategistFlowStub,
      safetyGate: safetyGateStub,
    });

    const result = await runStrategistOrchestrator(
      { purpose: 'test' },
      injected,
    );

    expect(strategistFlowStub).not.toHaveBeenCalled();
    expect(result.included).toEqual([]);
    expect(result.excluded).toEqual([]);
    expect(result.safetyExcluded).toEqual([
      expect.objectContaining({
        docId: 'doc-1',
        chunkId: 'restricted-chunk',
        reason: 'restricted_sensitivity',
        chunk: safeRejected,
      }),
    ]);
  });

  it('separates included, strategist excluded, and safety excluded chunks', async () => {
    const included = chunk({ id: 'included-chunk', text: 'Useful current rule' });
    const strategistExcluded = chunk({
      id: 'old-chunk',
      text: 'Old rule',
    });
    const safetyExcluded = chunk({
      id: 'unsafe-chunk',
      sensitivity: 'Restricted',
      aiUsePolicy: 'blocked',
      text: 'Restricted client detail',
    });
    const output: StrategistOutput = {
      included: [
        {
          docId: 'doc-1',
          chunkId: 'included-chunk',
          rationale: 'Purpose に合う現行情報です。',
          confidence: 0.91,
        },
      ],
      excluded: [
        {
          docId: 'doc-1',
          chunkId: 'old-chunk',
          rationale: '古い候補のため今回の目的では除外します。',
          reason: 'superseded_or_stale',
        },
      ],
      missing: [
        {
          topic: '最新の運用責任者',
          whyNeeded: 'AI 回答の確認先を確定するため。',
        },
      ],
      humanReviewQuestions: [
        {
          question: '旧ルールを廃止済みとして扱ってよいですか？',
          relatedChunkIds: ['old-chunk'],
        },
      ],
    };
    const strategistFlowStub = vi.fn(async () => output);
    const safetyGateStub = vi.fn((chunks: readonly KnowledgeChunk[]) => ({
      safe: chunks.filter((row) => row.id !== 'unsafe-chunk'),
      excluded: chunks
        .filter((row) => row.id === 'unsafe-chunk')
        .map((row) => ({
          docId: row.docId,
          chunkId: row.id,
          rationale: 'safety gate rejected restricted chunk',
          reason: 'restricted_sensitivity' as const,
        })),
    })) as unknown as RunStrategistOrchestratorDeps['safetyGate'];
    const injected = deps({
      documents: [inventoryDoc()],
      chunksByDocId: {
        'doc-1': [included, strategistExcluded, safetyExcluded],
      },
      strategistFlow:
        strategistFlowStub as unknown as RunStrategistOrchestratorDeps['strategistFlow'],
      safetyGate: safetyGateStub,
    });

    const result = await runStrategistOrchestrator(
      { purpose: '社内回答に使える現行情報を整理する' },
      injected,
    );

    expect(strategistFlowStub).toHaveBeenCalledWith({
      purpose: '社内回答に使える現行情報を整理する',
      chunkInputs: [
        expect.objectContaining({ chunk: included }),
        expect.objectContaining({ chunk: strategistExcluded }),
      ],
      safetyExcludedCount: 1,
    });
    expect(result.included).toEqual([
      expect.objectContaining({
        chunkId: 'included-chunk',
        confidence: 0.91,
        chunk: included,
      }),
    ]);
    expect(result.excluded).toEqual([
      expect.objectContaining({
        chunkId: 'old-chunk',
        reason: 'superseded_or_stale',
        chunk: strategistExcluded,
      }),
    ]);
    expect(result.safetyExcluded).toEqual([
      expect.objectContaining({
        chunkId: 'unsafe-chunk',
        reason: 'restricted_sensitivity',
        chunk: safetyExcluded,
      }),
    ]);
    expect(result.missing).toEqual(['最新の運用責任者']);
    expect(result.humanReviewQuestions).toEqual([
      '旧ルールを廃止済みとして扱ってよいですか？',
    ]);
    expect(result.sourceDocumentsReviewed).toBe(1);
  });
});

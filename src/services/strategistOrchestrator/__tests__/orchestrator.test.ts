import { describe, expect, it, vi } from 'vitest';
import {
  NoInventoryDocumentsError,
  NoKnowledgeChunksError,
  StrategistSyncBudgetExceededError,
  UnresolvedDocIdsError,
  runStrategistOrchestrator,
  type RunStrategistOrchestratorDeps,
} from '../orchestrator';
import { DEFAULT_STRATEGIST_INPUT_BUDGET } from '../budget';
import type { StrategistOutput } from '../../../agents/strategist/schema';
import type { InventoryDocument } from '../../../lib/inventory';
import type { ResolvedInventoryDocument } from '../../../lib/inventoryFirestoreAdapter';
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
  resolveByIds?: RunStrategistOrchestratorDeps['resolveInventoryDocumentsByIds'];
  safetyGate?: RunStrategistOrchestratorDeps['safetyGate'];
  strategistFlow?: RunStrategistOrchestratorDeps['strategistFlow'];
}): Required<RunStrategistOrchestratorDeps> {
  const listInventoryDocuments = vi.fn(async () => params.documents ?? []);
  const resolveInventoryDocumentsByIds =
    params.resolveByIds ?? vi.fn(async () => [] as ResolvedInventoryDocument[]);
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
    resolveInventoryDocumentsByIds,
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
    expect(result.budget).toEqual({
      config: DEFAULT_STRATEGIST_INPUT_BUDGET,
      totalCandidates: 0,
      keptChunks: 0,
      droppedChunks: 0,
      keptDocuments: 0,
      estimatedPromptChars: 0,
      estimatedPromptTokens: 0,
    });
    expect(result.syncEstimateSeconds).toBe(0);
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
    expect(result.budget).toMatchObject({
      config: DEFAULT_STRATEGIST_INPUT_BUDGET,
      totalCandidates: 2,
      keptChunks: 2,
      droppedChunks: 0,
      keptDocuments: 1,
    });
    expect(result.budgetDroppedDocuments).toEqual([]);
    expect(result.syncEstimateSeconds).toBeGreaterThan(0);
  });

  it('keeps default budget worst-case estimate within the 20s sync target', async () => {
    const heavyChunks = Array.from({ length: 80 }, (_, i) =>
      chunk({
        id: `heavy-${i}`,
        text: 'x'.repeat(1_200),
      }),
    );
    const strategistFlowStub = vi.fn(async () => ({
      included: [],
      excluded: [],
      missing: [],
      humanReviewQuestions: [],
    })) as unknown as RunStrategistOrchestratorDeps['strategistFlow'];
    const injected = deps({
      documents: [inventoryDoc()],
      chunksByDocId: { 'doc-1': heavyChunks },
      strategistFlow: strategistFlowStub,
    });

    const result = await runStrategistOrchestrator({ purpose: 'test' }, injected);

    expect(result.budget.config).toEqual(DEFAULT_STRATEGIST_INPUT_BUDGET);
    expect(result.budget.keptChunks).toBeLessThan(DEFAULT_STRATEGIST_INPUT_BUDGET.maxChunks);
    expect(result.budget.droppedChunks).toBeGreaterThan(0);
    expect(result.budget.estimatedPromptChars).toBeLessThanOrEqual(
      DEFAULT_STRATEGIST_INPUT_BUDGET.maxTotalPromptChars,
    );
    expect(result.syncEstimateSeconds).toBeLessThanOrEqual(20);
    expect(strategistFlowStub).toHaveBeenCalledTimes(1);
    // dropped chunks surface as a per-document truncation breakdown.
    expect(result.budgetDroppedDocuments).toEqual([
      { docId: 'doc-1', fileName: 'sample.md', droppedChunks: result.budget.droppedChunks },
    ]);
  });

  it('throws StrategistSyncBudgetExceededError before strategistFlow when custom budget estimate exceeds 20s', async () => {
    const heavyChunks = Array.from({ length: 80 }, (_, i) =>
      chunk({
        id: `heavy-${i}`,
        text: 'x'.repeat(1_200),
      }),
    );
    const strategistFlowStub = vi.fn(async () => {
      throw new Error('strategistFlow must not be called');
    }) as unknown as RunStrategistOrchestratorDeps['strategistFlow'];
    const injected = deps({
      documents: [inventoryDoc()],
      chunksByDocId: { 'doc-1': heavyChunks },
      strategistFlow: strategistFlowStub,
    });

    await expect(
      runStrategistOrchestrator(
        {
          purpose: 'test',
          inputBudget: {
            ...DEFAULT_STRATEGIST_INPUT_BUDGET,
            maxTotalPromptChars: 80_000,
          },
        },
        injected,
      ),
    ).rejects.toBeInstanceOf(StrategistSyncBudgetExceededError);
    expect(strategistFlowStub).not.toHaveBeenCalled();
  });

  describe('docIds strict resolution', () => {
    it('resolves only the requested docIds and ignores the inventory limit list', async () => {
      const target = inventoryDoc({ id: 'doc-target', fileName: 'target.md' });
      const targetChunk = chunk({ id: 'chunk-target', docId: 'doc-target' });
      const resolveByIds = vi.fn(
        async (): Promise<ResolvedInventoryDocument[]> => [
          { docId: 'doc-target', outcome: 'terminal', document: target },
        ],
      );
      const injected = deps({
        // listInventoryDocuments を空にしておき、docIds 経路がこれに依存しないことを示す。
        documents: [],
        chunksByDocId: { 'doc-target': [targetChunk] },
        resolveByIds,
      });

      const result = await runStrategistOrchestrator(
        { purpose: 'test', docIds: ['doc-target'] },
        injected,
      );

      expect(resolveByIds).toHaveBeenCalledWith(['doc-target']);
      expect(injected.listInventoryDocuments).not.toHaveBeenCalled();
      expect(injected.listChunks).toHaveBeenCalledWith('doc-target');
      expect(injected.listChunks).toHaveBeenCalledTimes(1);
      expect(result.sourceDocumentsReviewed).toBe(1);
    });

    it('throws UnresolvedDocIdsError listing unknown docIds', async () => {
      const resolveByIds = vi.fn(
        async (): Promise<ResolvedInventoryDocument[]> => [
          { docId: 'doc-1', outcome: 'unknown' },
        ],
      );
      const injected = deps({ resolveByIds });

      await expect(
        runStrategistOrchestrator(
          { purpose: 'test', docIds: ['doc-1'] },
          injected,
        ),
      ).rejects.toMatchObject({
        name: 'UnresolvedDocIdsError',
        unknownDocIds: ['doc-1'],
        nonTerminalDocIds: [],
      });
      expect(injected.listChunks).not.toHaveBeenCalled();
    });

    it('throws UnresolvedDocIdsError listing non-terminal docIds with their status', async () => {
      const resolveByIds = vi.fn(
        async (): Promise<ResolvedInventoryDocument[]> => [
          { docId: 'doc-pending', outcome: 'non_terminal', status: 'masking_pending' },
        ],
      );
      const injected = deps({ resolveByIds });

      const error = await runStrategistOrchestrator(
        { purpose: 'test', docIds: ['doc-pending'] },
        injected,
      ).catch((e) => e);

      expect(error).toBeInstanceOf(UnresolvedDocIdsError);
      expect(error.unknownDocIds).toEqual([]);
      expect(error.nonTerminalDocIds).toEqual([
        { docId: 'doc-pending', status: 'masking_pending' },
      ]);
      expect(injected.listChunks).not.toHaveBeenCalled();
    });

    it('reports both unknown and non-terminal docIds in a single error', async () => {
      const target = inventoryDoc({ id: 'doc-ok' });
      const resolveByIds = vi.fn(
        async (): Promise<ResolvedInventoryDocument[]> => [
          { docId: 'doc-ok', outcome: 'terminal', document: target },
          { docId: 'doc-missing', outcome: 'unknown' },
          { docId: 'doc-draft', outcome: 'non_terminal', status: 'uploaded' },
        ],
      );
      const injected = deps({ resolveByIds });

      await expect(
        runStrategistOrchestrator(
          { purpose: 'test', docIds: ['doc-ok', 'doc-missing', 'doc-draft'] },
          injected,
        ),
      ).rejects.toMatchObject({
        unknownDocIds: ['doc-missing'],
        nonTerminalDocIds: [{ docId: 'doc-draft', status: 'uploaded' }],
      });
    });
  });
});

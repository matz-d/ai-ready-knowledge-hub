import { Timestamp } from '@google-cloud/firestore';
import { describe, expect, it, vi } from 'vitest';
import { getFirestoreClient } from '../firestore';
import type {
  FirestoreCuratorBlock,
  FirestoreDocument,
  FirestoreMaskerBlock,
} from '../firestoreSchema';
import { FIRESTORE_DOCUMENT_SCHEMA_VERSION } from '../firestoreSchema';
import {
  adaptFirestoreDocumentToInventory,
  listInventoryDocumentsFromFirestore,
} from '../inventoryFirestoreAdapter';
import { adaptW1SnapshotEntries } from '../inventory';

vi.mock('../firestore', () => ({
  getFirestoreClient: vi.fn(),
}));

function timestamp(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso));
}

const baseCurator: FirestoreCuratorBlock = {
  documentType: 'メモ',
  businessDomain: '顧客対応',
  sensitivity: 'Confidential',
  freshness: 'current',
  isAuthoritativeCandidate: true,
  aiUsePolicy: 'requires_masking',
  rationale: '顧客対応の最新メモです。',
  completedAt: timestamp('2026-05-08T01:00:00.000Z'),
  modelId: 'test-model',
};

const baseMasker: FirestoreMaskerBlock = {
  decision: 'ai_safe_ready',
  provider: 'simple-rule',
  maskedSpansCount: 2,
  ruleHits: { email: 1, phone_like: 1 },
  residualRisk: { detected: false, reasons: ['再識別リスクは低い'] },
  rationale: 'AI-safe version として扱えます。',
  recommendedSensitivity: 'Confidential',
  sourceContentHash: 'hash-1',
  aiSafeSchemaVersion: 1,
  completedAt: timestamp('2026-05-08T01:00:01.000Z'),
  modelId: 'test-model',
};

function buildDoc(overrides: Partial<FirestoreDocument> = {}): FirestoreDocument {
  return {
    id: 'doc-1',
    schemaVersion: FIRESTORE_DOCUMENT_SCHEMA_VERSION,
    fileName: 'sample.txt',
    contentType: 'text/plain',
    byteSize: 12,
    contentSha256: 'hash-1',
    sourceKind: 'upload',
    externalSource: null,
    storagePath: 'raw/doc-1/sample.txt',
    aiSafeStoragePath: null,
    status: 'curated',
    createdAt: timestamp('2026-05-08T00:00:00.000Z'),
    updatedAt: timestamp('2026-05-08T02:00:00.000Z'),
    documentType: 'メモ',
    businessDomain: '顧客対応',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    aiUsePolicy: 'direct',
    sensitivitySource: 'curator',
    originalCuratorSensitivity: null,
    sensitivityReason: null,
    curator: {
      ...baseCurator,
      sensitivity: 'Internal',
      aiUsePolicy: 'direct',
      rationale: 'AI に直接渡せる社内手順です。',
    },
    curatorError: null,
    masker: null,
    maskerError: null,
    ...overrides,
  };
}

describe('adaptFirestoreDocumentToInventory', () => {
  it('keeps curator fields and curator sensitivity provenance for curated documents', () => {
    const row = adaptFirestoreDocumentToInventory('snapshot-id', buildDoc());

    expect(row).toEqual(
      expect.objectContaining({
        id: 'doc-1',
        fileName: 'sample.txt',
        status: 'curated',
        storagePath: 'raw/doc-1/sample.txt',
        documentType: 'メモ',
        businessDomain: '顧客対応',
        sensitivity: 'Internal',
        aiUsePolicy: 'direct',
        sensitivitySource: 'curator',
        createdAt: '2026-05-08T00:00:00.000Z',
        updatedAt: '2026-05-08T02:00:00.000Z',
      })
    );
    expect(row?.curator).toEqual(
      expect.objectContaining({
        aiUsePolicy: 'direct',
        completedAt: '2026-05-08T01:00:00.000Z',
      })
    );
  });

  it('keeps blocked status, Restricted sensitivity, and blocked policy', () => {
    const row = adaptFirestoreDocumentToInventory(
      'snapshot-id',
      buildDoc({
        status: 'blocked',
        sensitivity: 'Restricted',
        aiUsePolicy: 'blocked',
        curator: {
          ...baseCurator,
          sensitivity: 'Restricted',
          aiUsePolicy: 'blocked',
          rationale: '顧客固有情報を含むため AI 利用不可です。',
        },
      })
    );

    expect(row).toEqual(
      expect.objectContaining({
        status: 'blocked',
        sensitivity: 'Restricted',
        aiUsePolicy: 'blocked',
        sensitivitySource: 'curator',
      })
    );
  });

  it('keeps ai_safe status, safe storage path, masker block, and export evaluation', () => {
    const row = adaptFirestoreDocumentToInventory(
      'snapshot-id',
      buildDoc({
        status: 'ai_safe',
        sensitivity: 'Confidential',
        aiUsePolicy: 'requires_masking',
        aiSafeStoragePath: 'masked/doc-1/sample.txt',
        curator: baseCurator,
        masker: baseMasker,
      })
    );

    expect(row).toEqual(
      expect.objectContaining({
        status: 'ai_safe',
        sensitivity: 'Confidential',
        aiUsePolicy: 'requires_masking',
        aiSafeStoragePath: 'masked/doc-1/sample.txt',
      })
    );
    expect(row?.masker).toEqual(
      expect.objectContaining({
        decision: 'ai_safe_ready',
        recommendedSensitivity: 'Confidential',
        completedAt: '2026-05-08T01:00:01.000Z',
      })
    );
    expect(row?.maskerEvaluation).toEqual({
      residualRisk: { detected: false, reasons: ['再識別リスクは低い'] },
      recommendedSensitivity: 'Confidential',
      rationale: 'AI-safe version として扱えます。',
    });
  });

  it('keeps restricted masker provenance, original curator sensitivity, and reason', () => {
    const row = adaptFirestoreDocumentToInventory(
      'snapshot-id',
      buildDoc({
        status: 'restricted',
        sensitivity: 'Restricted',
        aiUsePolicy: 'blocked',
        sensitivitySource: 'masker',
        originalCuratorSensitivity: 'Confidential',
        sensitivityReason: '残存リスクが高い',
        curator: baseCurator,
        masker: {
          ...baseMasker,
          decision: 'restricted_promoted',
          residualRisk: { detected: true, reasons: ['取引条件で再識別可能'] },
          recommendedSensitivity: 'Restricted',
          rationale: '人間確認に回す必要があります。',
        },
      })
    );

    expect(row).toEqual(
      expect.objectContaining({
        status: 'restricted',
        sensitivity: 'Restricted',
        aiUsePolicy: 'blocked',
        sensitivitySource: 'masker',
        originalCuratorSensitivity: 'Confidential',
        sensitivityReason: '残存リスクが高い',
      })
    );
    expect(row?.maskerEvaluation).toEqual(
      expect.objectContaining({
        recommendedSensitivity: 'Restricted',
      })
    );
  });

  it('skips unfinished or incomplete documents', () => {
    expect(
      adaptFirestoreDocumentToInventory(
        'snapshot-id',
        buildDoc({ status: 'curating', documentType: null })
      )
    ).toBeNull();
    expect(
      adaptFirestoreDocumentToInventory(
        'snapshot-id',
        buildDoc({ status: 'ai_safe', masker: null })
      )
    ).toBeNull();
    expect(
      adaptFirestoreDocumentToInventory(
        'snapshot-id',
        {
          ...buildDoc(),
          sensitivity: undefined,
        } as unknown as FirestoreDocument
      )
    ).toBeNull();
  });

  it('keeps W1 snapshot adapter usable as demo fallback with status', () => {
    const [row] = adaptW1SnapshotEntries([
      {
        fileName: 'w1.txt',
        sourcePath: 'sample-data/w1.txt',
        documentType: 'メモ',
        businessDomain: '顧客対応',
        sensitivity: 'Confidential',
        freshness: 'current',
        isAuthoritativeCandidate: true,
        aiUsePolicy: 'requires_masking',
        rationale: 'W1 demo row',
        maskerEvaluation: {
          residualRisk: { detected: true, reasons: ['再識別可能'] },
          recommendedSensitivity: 'Restricted',
          rationale: 'Restricted に昇格',
        },
      },
    ]);

    expect(row).toEqual(
      expect.objectContaining({
        id: 'w1-0-w1.txt',
        status: 'restricted',
        sensitivity: 'Restricted',
        aiUsePolicy: 'blocked',
        sensitivitySource: 'masker',
        storagePath: 'sample-data/w1.txt',
      })
    );
  });

  it('skips schemaVersion 1 raw Firestore documents and logs a warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rawData = {
      ...buildDoc(),
      schemaVersion: 1,
    };
    const get = vi.fn().mockResolvedValue({
      docs: [
        {
          id: 'legacy-v1-doc',
          data: () => rawData,
        },
      ],
    });
    const limit = vi.fn(() => ({ get }));
    const orderBy = vi.fn(() => ({ limit }));
    const collection = vi.fn(() => ({ orderBy }));
    vi.mocked(getFirestoreClient).mockReturnValue({
      collection,
    } as unknown as ReturnType<typeof getFirestoreClient>);

    await expect(listInventoryDocumentsFromFirestore()).resolves.toEqual([]);
    expect(collection).toHaveBeenCalledWith('documents');
    expect(warnSpy).toHaveBeenCalledWith(
      '[inventoryFirestore] skipping malformed document',
      expect.objectContaining({ docId: 'legacy-v1-doc' })
    );
    warnSpy.mockRestore();
  });

  it('returns only valid rows when one snapshot fails parse, and warns with docId', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const malformed = {
      id: 'malformed-年末調整',
      data: () => ({
        fileName: '年末調整_案内文.txt',
      }),
    };
    const validA = {
      id: 'valid-a',
      data: () => buildDoc({ fileName: 'good-a.txt', storagePath: 'raw/valid-a/good-a.txt' }),
    };
    const validB = {
      id: 'valid-b',
      data: () => buildDoc({ fileName: 'good-b.txt', storagePath: 'raw/valid-b/good-b.txt' }),
    };
    const get = vi.fn().mockResolvedValue({
      docs: [malformed, validA, validB],
    });
    const limit = vi.fn(() => ({ get }));
    const orderBy = vi.fn(() => ({ limit }));
    const collection = vi.fn(() => ({ orderBy }));
    vi.mocked(getFirestoreClient).mockReturnValue({
      collection,
    } as unknown as ReturnType<typeof getFirestoreClient>);

    const rows = await listInventoryDocumentsFromFirestore();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual(['valid-a', 'valid-b']);
    expect(warnSpy).toHaveBeenCalledWith(
      '[inventoryFirestore] skipping malformed document',
      expect.objectContaining({
        docId: 'malformed-年末調整',
      })
    );
    warnSpy.mockRestore();
  });
});

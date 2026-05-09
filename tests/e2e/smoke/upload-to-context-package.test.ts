import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirestoreDocument } from '../../../src/lib/firestoreSchema';

type FakeStoredObject = {
  body: Buffer;
  contentType?: string;
  metadata?: unknown;
};

type FakeDocSnapshot = {
  id: string;
  data: () => Record<string, unknown>;
};

const {
  randomUUIDMock,
  curatorFlowMock,
  maskerPipelineFlowMock,
  serverTimestampMock,
  firestoreDocuments,
  storageObjects,
} = vi.hoisted(() => ({
  randomUUIDMock: vi.fn(),
  curatorFlowMock: vi.fn(),
  maskerPipelineFlowMock: vi.fn(),
  serverTimestampMock: vi.fn(),
  firestoreDocuments: new Map<string, Record<string, unknown>>(),
  storageObjects: new Map<string, FakeStoredObject>(),
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomUUID: randomUUIDMock,
  };
});

vi.mock('../../../src/agents/_shared/genkitClient', () => ({
  modelId: 'e2e-smoke-model',
}));

vi.mock('../../../src/agents/curator/flow', () => ({
  curatorFlow: curatorFlowMock,
}));

vi.mock('../../../src/agents/masker/pipelineFlow', () => ({
  maskerPipelineFlow: maskerPipelineFlowMock,
}));

vi.mock('../../../src/lib/firestore', () => ({
  FieldValue: {
    serverTimestamp: serverTimestampMock,
  },
  getFirestoreClient: () => fakeFirestoreClient,
}));

vi.mock('../../../src/lib/storage', () => ({
  uploadRawObject: async (
    objectPath: string,
    body: Buffer,
    contentType: string
  ) => {
    storageObjects.set(objectPath, { body, contentType });
  },
  deleteRawObject: async (objectPath: string) => {
    storageObjects.delete(objectPath);
  },
  uploadMaskedObject: async (
    objectPath: string,
    body: string | Buffer,
    metadata: unknown
  ) => {
    storageObjects.set(objectPath, {
      body: Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf-8'),
      contentType: 'text/plain; charset=utf-8',
      metadata,
    });
  },
  deleteMaskedObject: async (objectPath: string) => {
    storageObjects.delete(objectPath);
  },
  readTextObject: async (objectPath: string) => {
    const object = storageObjects.get(objectPath);
    if (!object) {
      throw new Error(`Fake GCS object not found: ${objectPath}`);
    }
    return object.body.toString('utf-8');
  },
}));

const fakeFirestoreClient = {
  collection: (collectionName: string) => {
    expect(collectionName).toBe('documents');
    return {
      doc: (docId: string) => ({
        set: async (body: Record<string, unknown>) => {
          firestoreDocuments.set(docId, { ...body });
        },
        update: async (patch: Record<string, unknown>) => {
          const current = firestoreDocuments.get(docId);
          if (!current) {
            throw new Error(`Fake Firestore document not found: ${docId}`);
          }
          firestoreDocuments.set(docId, { ...current, ...patch });
        },
        delete: async () => {
          firestoreDocuments.delete(docId);
        },
      }),
      orderBy: () => ({
        limit: (limit: number) => ({
          get: async () => ({
            docs: [...firestoreDocuments.entries()]
              .slice(0, limit)
              .map(([id, data]) => ({
                id,
                data: () => data,
              })) satisfies FakeDocSnapshot[],
          }),
        }),
      }),
    };
  },
};

import { exportContextPackageMarkdown } from '../../../src/lib/exportContextPackage';
import { buildFirestoreContextPackageExportInput } from '../../../src/lib/contextPackageFirestoreAdapter';
import { listInventoryDocumentsFromFirestore } from '../../../src/lib/inventoryFirestoreAdapter';
import { orchestrateUploadProcessing } from '../../../src/lib/uploadOrchestrator';

const rawBody = '顧客名: 山田太郎\n電話: 090-1234-5678\n相談内容: 年末調整';
const maskedBody = '顧客名: [NAME]\n電話: [PHONE]\n相談内容: 年末調整';

const curatorRequiresMaskingResult = {
  documentType: 'メモ',
  businessDomain: '顧客対応',
  sensitivity: 'Confidential',
  freshness: 'current',
  isAuthoritativeCandidate: true,
  aiUsePolicy: 'requires_masking',
  rationale: '顧客個人情報を含むためマスキングが必要',
} as const;

function aiSafePipelineResult() {
  return {
    decision: 'ai_safe_ready',
    aiSafeVersion: {
      fileName: 'customer-note.txt',
      provider: 'simple-rule',
      maskedContent: maskedBody,
      maskedSpans: [
        {
          start: 5,
          end: 9,
          type: 'CUSTOM_RULE',
          ruleId: 'name',
        },
        {
          start: 14,
          end: 27,
          type: 'CUSTOM_RULE',
          ruleId: 'phone',
        },
      ],
      generatedAt: '2026-05-09T00:00:00.000Z',
      sourceContentHash: 'fake-hash',
      residualRisk: { detected: false, reasons: [] },
      schemaVersion: 1,
    },
    curatorFeedback: null,
    rawRiskOutput: {
      residualRisk: { detected: false, reasons: [] },
      recommendedSensitivity: 'Confidential',
      rationale: 'マスキング後の残留リスクは低い',
    },
    maskingResult: {
      provider: 'simple-rule',
      maskedContent: maskedBody,
      maskedSpans: [
        {
          start: 5,
          end: 9,
          type: 'CUSTOM_RULE',
          ruleId: 'name',
        },
        {
          start: 14,
          end: 27,
          type: 'CUSTOM_RULE',
          ruleId: 'phone',
        },
      ],
      ruleHits: { name: 1, phone: 1 },
    },
  } as const;
}

function restrictedPipelineResult() {
  return {
    decision: 'restricted_promoted',
    aiSafeVersion: null,
    curatorFeedback: {
      newSensitivity: 'Restricted',
      newAiUsePolicy: 'blocked',
      reason: '再識別リスクが残る',
    },
    rawRiskOutput: {
      residualRisk: { detected: true, reasons: ['再識別リスクが残る'] },
      recommendedSensitivity: 'Restricted',
      rationale: 'マスキング後も特定可能性が高い',
    },
    maskingResult: {
      provider: 'simple-rule',
      maskedContent: 'partial mask only',
      maskedSpans: [],
      ruleHits: {},
    },
  } as const;
}

beforeEach(() => {
  firestoreDocuments.clear();
  storageObjects.clear();
  vi.clearAllMocks();
  serverTimestampMock.mockReturnValue('2026-05-09T00:00:00.000Z');
  curatorFlowMock.mockResolvedValue(curatorRequiresMaskingResult);
});

describe('Upload to Context Package smoke E2E', () => {
  it('exports the masked ai_safe body and never includes the raw body', async () => {
    randomUUIDMock.mockReturnValue('smoke-ai-safe-doc');
    maskerPipelineFlowMock.mockResolvedValue(aiSafePipelineResult());

    const result = await orchestrateUploadProcessing({
      displayName: 'customer-note.txt',
      contentType: 'text/plain',
      buffer: Buffer.from(rawBody, 'utf-8'),
      content: rawBody,
    });

    expect(result.kind).toBe('ai_safe');

    const firestoreDoc = firestoreDocuments.get(
      'smoke-ai-safe-doc'
    ) as FirestoreDocument;
    expect(firestoreDoc).toMatchObject({
      id: 'smoke-ai-safe-doc',
      status: 'ai_safe',
      storagePath: 'raw/smoke-ai-safe-doc/customer-note.txt',
      aiSafeStoragePath: 'masked/smoke-ai-safe-doc/customer-note.txt',
      aiUsePolicy: 'requires_masking',
      sensitivity: 'Confidential',
      sensitivitySource: 'curator',
    });
    expect(firestoreDoc.masker).toMatchObject({
      decision: 'ai_safe_ready',
      provider: 'simple-rule',
      recommendedSensitivity: 'Confidential',
    });

    expect(
      storageObjects.get('raw/smoke-ai-safe-doc/customer-note.txt')?.body.toString(
        'utf-8'
      )
    ).toBe(rawBody);
    expect(
      storageObjects
        .get('masked/smoke-ai-safe-doc/customer-note.txt')
        ?.body.toString('utf-8')
    ).toBe(maskedBody);

    const inventory = await listInventoryDocumentsFromFirestore();
    expect(inventory).toHaveLength(1);
    expect(inventory[0]).toMatchObject({
      id: 'smoke-ai-safe-doc',
      status: 'ai_safe',
      aiSafeStoragePath: 'masked/smoke-ai-safe-doc/customer-note.txt',
    });

    const exportInput = await buildFirestoreContextPackageExportInput({
      purpose: '年末調整の顧客対応 FAQ を作る',
      generatedAt: '2026-05-09T00:00:00.000Z',
    });
    expect(exportInput.includedDocuments).toHaveLength(1);
    expect(exportInput.includedDocuments[0]).toMatchObject({
      fileName: 'customer-note.txt',
      aiSafeViaMasking: true,
      aiSafeContent: maskedBody,
    });

    const markdown = exportContextPackageMarkdown(exportInput);
    expect(markdown).toContain(maskedBody);
    expect(markdown).not.toContain(rawBody);
    expect(markdown).not.toContain('山田太郎');
    expect(markdown).not.toContain('090-1234-5678');
  });

  it('keeps restricted_promoted documents out of included sources', async () => {
    randomUUIDMock.mockReturnValue('smoke-restricted-doc');
    maskerPipelineFlowMock.mockResolvedValue(restrictedPipelineResult());

    const result = await orchestrateUploadProcessing({
      displayName: 'high-risk-note.txt',
      contentType: 'text/plain',
      buffer: Buffer.from(rawBody, 'utf-8'),
      content: rawBody,
    });

    expect(result.kind).toBe('restricted');

    const firestoreDoc = firestoreDocuments.get(
      'smoke-restricted-doc'
    ) as FirestoreDocument;
    expect(firestoreDoc).toMatchObject({
      status: 'restricted',
      storagePath: 'raw/smoke-restricted-doc/high-risk-note.txt',
      aiSafeStoragePath: null,
      sensitivity: 'Restricted',
      aiUsePolicy: 'blocked',
      sensitivitySource: 'masker',
      originalCuratorSensitivity: 'Confidential',
    });
    expect(firestoreDoc.masker).toMatchObject({
      decision: 'restricted_promoted',
      recommendedSensitivity: 'Restricted',
    });
    expect(
      storageObjects.has('masked/smoke-restricted-doc/high-risk-note.txt')
    ).toBe(false);

    const inventory = await listInventoryDocumentsFromFirestore();
    expect(inventory).toHaveLength(1);
    expect(inventory[0]).toMatchObject({
      id: 'smoke-restricted-doc',
      status: 'restricted',
      aiSafeStoragePath: undefined,
    });

    const exportInput = await buildFirestoreContextPackageExportInput({
      purpose: '高リスク文書の扱いを確認する',
      generatedAt: '2026-05-09T00:00:00.000Z',
    });
    expect(exportInput.includedDocuments).toHaveLength(0);
    expect(exportInput.humanReviewDocuments).toEqual([
      expect.objectContaining({
        fileName: 'high-risk-note.txt',
        status: 'Restricted / human review only',
      }),
    ]);

    const markdown = exportContextPackageMarkdown(exportInput);
    expect(markdown).toContain('Human review required: 1');
    expect(markdown).toContain('high-risk-note.txt');
    expect(markdown).toContain('No AI-ready sources were included.');
    expect(markdown).not.toContain(rawBody);
  });
});

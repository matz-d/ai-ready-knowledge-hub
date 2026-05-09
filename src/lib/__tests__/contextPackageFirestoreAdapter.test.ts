import { describe, expect, it, vi } from 'vitest';
import { buildContextPackageExportInput } from '../contextPackageInput';
import {
  attachContextPackageBodies,
  buildFirestoreContextPackageExportInput,
  CONTEXT_PACKAGE_GCS_BODY_UNAVAILABLE,
  contextPackageBodyObjectPath,
} from '../contextPackageFirestoreAdapter';
import type { InventoryDocument } from '../inventory';

vi.mock('../inventoryFirestoreAdapter', () => ({
  listInventoryDocumentsFromFirestore: vi.fn(),
}));

const { listInventoryDocumentsFromFirestore } = await import(
  '../inventoryFirestoreAdapter'
);

function inventoryDoc(
  overrides: Partial<InventoryDocument> = {}
): InventoryDocument {
  return {
    id: 'doc-1',
    fileName: 'sample.txt',
    storagePath: 'raw/doc-1/sample.txt',
    status: 'curated',
    documentType: 'メモ',
    businessDomain: '顧客対応',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    aiUsePolicy: 'direct',
    rationale: 'AI に直接渡せる社内手順です。',
    sensitivitySource: 'curator',
    ...overrides,
  };
}

describe('contextPackageFirestoreAdapter', () => {
  it('uses raw storagePath for curated documents', () => {
    const doc = inventoryDoc({
      status: 'curated',
      storagePath: 'raw/doc-1/sample.txt',
    });

    expect(contextPackageBodyObjectPath(doc)).toBe('raw/doc-1/sample.txt');
  });

  it('uses aiSafeStoragePath for ai_safe documents and exports the masked body', async () => {
    const readBody = vi.fn(async (objectPath: string) => {
      if (objectPath === 'masked/doc-2/customer.txt') {
        return 'Customer name: [MASKED_PERSON]';
      }
      return 'UNMASKED CUSTOMER NAME';
    });

    const [doc] = await attachContextPackageBodies({
      documents: [
        inventoryDoc({
          id: 'doc-2',
          fileName: 'customer.txt',
          storagePath: 'raw/doc-2/customer.txt',
          aiSafeStoragePath: 'masked/doc-2/customer.txt',
          status: 'ai_safe',
          sensitivity: 'Confidential',
          aiUsePolicy: 'requires_masking',
          maskerEvaluation: {
            residualRisk: { detected: false, reasons: [] },
            recommendedSensitivity: 'Confidential',
            rationale: 'Masked body is safe for AI.',
          },
        }),
      ],
      readBody,
    });

    const exportInput = buildContextPackageExportInput({
      purpose: 'test',
      documents: [doc],
    });

    expect(readBody).toHaveBeenCalledTimes(1);
    expect(readBody).toHaveBeenCalledWith('masked/doc-2/customer.txt');
    expect(exportInput.includedDocuments).toHaveLength(1);
    expect(exportInput.includedDocuments[0].aiSafeViaMasking).toBe(true);
    expect(exportInput.includedDocuments[0].aiSafeContent).toBe(
      'Customer name: [MASKED_PERSON]'
    );
  });

  it('does not fall back to raw storagePath when an ai_safe document is missing aiSafeStoragePath', async () => {
    const readBody = vi.fn(async () => 'RAW CUSTOMER NAME');

    const [doc] = await attachContextPackageBodies({
      documents: [
        inventoryDoc({
          id: 'doc-2b',
          fileName: 'broken-ai-safe.txt',
          storagePath: 'raw/doc-2b/broken-ai-safe.txt',
          aiSafeStoragePath: undefined,
          status: 'ai_safe',
          sensitivity: 'Confidential',
          aiUsePolicy: 'requires_masking',
          maskerEvaluation: {
            residualRisk: { detected: false, reasons: [] },
            recommendedSensitivity: 'Confidential',
            rationale: 'Masked body should exist.',
          },
        }),
      ],
      readBody,
    });

    const exportInput = buildContextPackageExportInput({
      purpose: 'test',
      documents: [doc],
    });

    expect(readBody).not.toHaveBeenCalled();
    expect(exportInput.includedDocuments).toEqual([]);
    expect(exportInput.humanReviewDocuments).toEqual([
      expect.objectContaining({
        fileName: 'broken-ai-safe.txt',
        status: 'Human review required',
      }),
    ]);
  });

  it('does not read bodies for restricted or blocked documents and excludes them from AI-ready sources', async () => {
    const readBody = vi.fn(async () => 'should not be read');

    const docs = await attachContextPackageBodies({
      documents: [
        inventoryDoc({
          id: 'doc-3',
          fileName: 'restricted.txt',
          status: 'restricted',
          sensitivity: 'Restricted',
          aiUsePolicy: 'blocked',
          sensitivitySource: 'masker',
          originalCuratorSensitivity: 'Confidential',
          sensitivityReason: 'Residual risk remains.',
          maskerEvaluation: {
            residualRisk: { detected: true, reasons: ['customer terms'] },
            recommendedSensitivity: 'Restricted',
            rationale: 'Needs human review.',
          },
        }),
        inventoryDoc({
          id: 'doc-4',
          fileName: 'blocked.txt',
          status: 'blocked',
          sensitivity: 'Restricted',
          aiUsePolicy: 'blocked',
        }),
      ],
      readBody,
    });

    const exportInput = buildContextPackageExportInput({
      purpose: 'test',
      documents: docs,
    });

    expect(readBody).not.toHaveBeenCalled();
    expect(exportInput.includedDocuments).toEqual([]);
    expect(exportInput.humanReviewDocuments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileName: 'restricted.txt' }),
        expect.objectContaining({ fileName: 'blocked.txt' }),
      ])
    );
  });

  it('builds Firestore export input by listing metadata first and reading only exportable bodies', async () => {
    vi.mocked(listInventoryDocumentsFromFirestore).mockResolvedValue([
      inventoryDoc({
        id: 'doc-5',
        fileName: 'curated.txt',
        storagePath: 'raw/doc-5/curated.txt',
      }),
      inventoryDoc({
        id: 'doc-6',
        fileName: 'restricted.txt',
        status: 'restricted',
        sensitivity: 'Restricted',
        aiUsePolicy: 'blocked',
      }),
    ]);
    const readBody = vi.fn(async () => 'Curated source body');

    const exportInput = await buildFirestoreContextPackageExportInput({
      purpose: 'Firestore export',
      readBody,
    });

    expect(listInventoryDocumentsFromFirestore).toHaveBeenCalledWith(undefined);
    expect(readBody).toHaveBeenCalledWith('raw/doc-5/curated.txt');
    expect(readBody).toHaveBeenCalledTimes(1);
    expect(exportInput.sourceDocumentsReviewed).toBe(2);
    expect(exportInput.includedDocuments.map((doc) => doc.fileName)).toEqual([
      'curated.txt',
    ]);
    expect(exportInput.humanReviewDocuments?.map((doc) => doc.fileName)).toEqual([
      'restricted.txt',
    ]);
  });

  it('keeps exporting other documents when one GCS read fails', async () => {
    const readBody = vi.fn(async (objectPath: string) => {
      if (objectPath.includes('broken')) {
        throw new Error('simulated GCS failure');
      }
      return 'good body';
    });

    const docs = await attachContextPackageBodies({
      documents: [
        inventoryDoc({
          id: 'doc-ok',
          fileName: 'ok.txt',
          storagePath: 'raw/doc-ok/ok.txt',
          status: 'curated',
        }),
        inventoryDoc({
          id: 'doc-bad',
          fileName: 'broken.txt',
          storagePath: 'raw/doc-bad/broken.txt',
          status: 'curated',
        }),
      ],
      readBody,
    });

    const exportInput = buildContextPackageExportInput({
      purpose: 'test',
      documents: docs,
    });

    expect(readBody).toHaveBeenCalledTimes(2);
    expect(exportInput.includedDocuments.map((d) => d.fileName)).toEqual(['ok.txt']);
    expect(exportInput.humanReviewDocuments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileName: 'broken.txt',
          reason: CONTEXT_PACKAGE_GCS_BODY_UNAVAILABLE,
          status: 'curated',
        }),
      ])
    );
  });
});

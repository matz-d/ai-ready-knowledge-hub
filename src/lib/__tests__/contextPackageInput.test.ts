import { describe, expect, it } from 'vitest';
import {
  buildContextPackageExportInput,
  CONTEXT_PACKAGE_BODY_UNAVAILABLE_REASON,
  isSafeForContextPackageExport,
} from '../contextPackageInput';
import type { KnowledgeChunk } from '../knowledgeChunkSchema';
import type { InventoryDocument } from '../inventory';

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

function knowledgeChunk(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    id: 'chunk-1',
    docId: 'doc-1',
    schemaVersion: 1,
    sourceType: 'spreadsheet',
    structureType: 'cellRange',
    locator: {
      kind: 'spreadsheet',
      sheetName: 'Sheet1',
      range: 'A1:B2',
    },
    text: 'default chunk text',
    sensitivity: 'Internal',
    aiUsePolicy: 'direct',
    sensitivitySource: 'inherited',
    extractionProvider: 'csv',
    sourceHash: 'hash',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildContextPackageExportInput', () => {
  it('does not put curated rows without a body into included when placeholders are disallowed (default)', () => {
    const exportInput = buildContextPackageExportInput({
      purpose: 'test',
      documents: [
        inventoryDoc({
          aiSafeContent: undefined,
        }),
      ],
    });

    expect(exportInput.includedDocuments).toEqual([]);
    expect(exportInput.humanReviewDocuments).toEqual([
      expect.objectContaining({
        fileName: 'sample.txt',
        reason: CONTEXT_PACKAGE_BODY_UNAVAILABLE_REASON,
        status: 'Human review required',
      }),
    ]);
  });

  it('uses demo placeholders only when allowPlaceholderBodies is true', () => {
    const exportInput = buildContextPackageExportInput({
      purpose: 'test',
      documents: [inventoryDoc({ aiSafeContent: undefined })],
      allowPlaceholderBodies: true,
    });

    expect(exportInput.includedDocuments).toHaveLength(1);
    expect(exportInput.includedDocuments[0].aiSafeContent).toContain(
      '[Demo: body not loaded'
    );
    expect(exportInput.humanReviewDocuments?.filter((r) => r.reason === CONTEXT_PACKAGE_BODY_UNAVAILABLE_REASON)).toEqual([]);
  });

  it('routes GCS load failures to human review with the adapter reason', () => {
    const exportInput = buildContextPackageExportInput({
      purpose: 'test',
      documents: [
        inventoryDoc({
          fileName: 'missing.txt',
          contextPackageBodyLoadError: 'GCS body unavailable',
        }),
      ],
    });

    expect(exportInput.includedDocuments).toEqual([]);
    expect(exportInput.humanReviewDocuments).toEqual([
      expect.objectContaining({
        fileName: 'missing.txt',
        reason: 'GCS body unavailable',
        status: 'curated',
      }),
    ]);
  });

  it('keeps document-only output unchanged when chunks are omitted', () => {
    const exportInput = buildContextPackageExportInput({
      purpose: 'snapshot',
      documents: [
        inventoryDoc({
          fileName: 'doc-a.txt',
          aiSafeContent: '  real body  ',
        }),
      ],
      missingKnowledge: ['missing-1'],
      questionsForHumanOwner: ['question-1'],
    });

    expect(exportInput).toEqual({
      purpose: 'snapshot',
      generatedAt: undefined,
      sourceDocumentsReviewed: 1,
      includedDocuments: [
        {
          fileName: 'doc-a.txt',
          reason: 'AI に直接渡せる社内手順です。',
          sourceType: 'メモ',
          sensitivity: 'Internal',
          aiSafeViaMasking: false,
          aiSafeContent: 'real body',
        },
      ],
      excludedDocuments: [],
      humanReviewDocuments: [],
      missingKnowledge: ['missing-1'],
      questionsForHumanOwner: ['question-1'],
    });
  });

  it('includes direct chunks when chunks are provided and annotates spreadsheet sheet/range in source name', () => {
    const exportInput = buildContextPackageExportInput({
      purpose: 'chunk',
      documents: [
        inventoryDoc({
          id: 'doc-1',
          fileName: 'sales.xlsx',
        }),
      ],
      chunks: [
        knowledgeChunk({
          docId: 'doc-1',
          text: 'Revenue table',
          aiUsePolicy: 'direct',
          sensitivity: 'Internal',
        }),
      ],
    });

    expect(exportInput.includedDocuments).toEqual([
      expect.objectContaining({
        fileName: 'sales.xlsx (sheet=Sheet1, range=A1:B2)',
        aiSafeContent: 'Revenue table',
      }),
    ]);
  });

  it('includes maskedText for requires_masking chunks', () => {
    const exportInput = buildContextPackageExportInput({
      purpose: 'chunk',
      documents: [inventoryDoc({ id: 'doc-1', fileName: 'pii.csv' })],
      chunks: [
        knowledgeChunk({
          docId: 'doc-1',
          aiUsePolicy: 'requires_masking',
          sensitivity: 'Confidential',
          text: 'name,phone',
          maskedText: '[MASKED_NAME],[MASKED_PHONE]',
        }),
      ],
    });

    expect(exportInput.includedDocuments).toEqual([
      expect.objectContaining({
        fileName: 'pii.csv (sheet=Sheet1, range=A1:B2)',
        aiSafeViaMasking: true,
        aiSafeContent: '[MASKED_NAME],[MASKED_PHONE]',
      }),
    ]);
    expect(exportInput.humanReviewDocuments).toEqual([]);
  });

  it('routes requires_masking chunks without maskedText to human review', () => {
    const exportInput = buildContextPackageExportInput({
      purpose: 'chunk',
      documents: [inventoryDoc({ id: 'doc-1', fileName: 'pending-mask.csv' })],
      chunks: [
        knowledgeChunk({
          docId: 'doc-1',
          aiUsePolicy: 'requires_masking',
          sensitivity: 'Confidential',
          maskedText: undefined,
        }),
      ],
    });

    expect(exportInput.includedDocuments).toEqual([]);
    expect(exportInput.humanReviewDocuments).toEqual([
      expect.objectContaining({
        fileName: 'pending-mask.csv (sheet=Sheet1, range=A1:B2)',
        reason: 'Chunk requires masking but maskedText is unavailable',
        status: 'Human review required',
      }),
    ]);
  });

  it('excludes blocked chunks and chunks under blocked/restricted parent documents', () => {
    const exportInput = buildContextPackageExportInput({
      purpose: 'chunk',
      documents: [
        inventoryDoc({
          id: 'doc-open',
          fileName: 'open.csv',
          status: 'curated',
          sensitivity: 'Internal',
          aiUsePolicy: 'direct',
        }),
        inventoryDoc({
          id: 'doc-blocked',
          fileName: 'blocked.csv',
          status: 'blocked',
          sensitivity: 'Restricted',
          aiUsePolicy: 'blocked',
        }),
      ],
      chunks: [
        knowledgeChunk({
          id: 'chunk-blocked-policy',
          docId: 'doc-open',
          aiUsePolicy: 'blocked',
          sensitivity: 'Restricted',
        }),
        knowledgeChunk({
          id: 'chunk-blocked-parent',
          docId: 'doc-blocked',
          aiUsePolicy: 'direct',
          sensitivity: 'Internal',
        }),
      ],
    });

    expect(exportInput.includedDocuments).toEqual([]);
    expect(exportInput.humanReviewDocuments).toEqual([]);
  });
});

describe('isSafeForContextPackageExport', () => {
  it('is false without trimmed aiSafeContent', () => {
    expect(isSafeForContextPackageExport(inventoryDoc({ aiSafeContent: undefined }))).toBe(
      false
    );
  });

  it('is false when contextPackageBodyLoadError is set', () => {
    expect(
      isSafeForContextPackageExport(
        inventoryDoc({
          aiSafeContent: 'hello',
          contextPackageBodyLoadError: 'GCS body unavailable',
        })
      )
    ).toBe(false);
  });

  it('is true when exportable and a trimmed body is present', () => {
    expect(
      isSafeForContextPackageExport(
        inventoryDoc({
          aiSafeContent: 'real body',
        })
      )
    ).toBe(true);
  });
});

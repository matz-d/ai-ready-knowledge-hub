import { describe, expect, it } from 'vitest';
import {
  buildContextPackageExportInput,
  CONTEXT_PACKAGE_BODY_UNAVAILABLE_REASON,
  isSafeForContextPackageExport,
} from '../contextPackageInput';
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

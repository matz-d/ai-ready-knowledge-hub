import { describe, expect, it } from 'vitest';
import { P1dExpectedFixtureSchema } from '../p1dQualityGate';
import {
  assertScanPdfExpectedRefreshDoesNotWeaken,
  mergeScanPdfExpectedRefresh,
  summarizeExpectedCoverage,
} from '../scanPdfGoldenSidecarRefresh';

const prior = P1dExpectedFixtureSchema.parse({
  documentId: 'synthetic-scan',
  expectedFields: ['Invoice', 'Invoice number: SYN-001', 'Total'],
  expectedFieldTiers: {
    Invoice: 'core',
    'Invoice number: SYN-001': 'core',
  },
  expectedValues: [
    {
      field: 'Invoice number',
      expectedValue: 'SYN-001',
      tier: 'core',
    },
  ],
  expectedTableCells: [
    {
      rowLabel: 'Consulting',
      columnLabel: 'Amount',
      expectedValue: 'JPY 100,000',
      tier: 'core',
    },
  ],
  notes: 'curated expected fixture',
});

describe('scan-pdf golden sidecar expected refresh', () => {
  it('preserves curated fields, tiers, values, and table cells while adding candidates', () => {
    const refreshed = mergeScanPdfExpectedRefresh({
      prior,
      candidateFields: ['Invoice', 'New OCR heading'],
      regeneratedAt: '2026-06-18',
      model: 'gemini-test',
      recall: 1,
    });

    expect(refreshed.expectedFields).toEqual([
      'Invoice',
      'Invoice number: SYN-001',
      'Total',
      'New OCR heading',
    ]);
    expect(refreshed.expectedFieldTiers).toEqual(prior.expectedFieldTiers);
    expect(refreshed.expectedValues).toEqual(prior.expectedValues);
    expect(refreshed.expectedTableCells).toEqual(prior.expectedTableCells);
    expect(refreshed.notes).toContain(
      'curated expected tiers/values/table cells preserved'
    );
    expect(summarizeExpectedCoverage(refreshed)).toEqual({
      expectedFieldCount: 4,
      expectedValueCount: 1,
      expectedTableCellCount: 1,
    });
  });

  it('rejects a refresh that drops value or table expectations', () => {
    const weakened = P1dExpectedFixtureSchema.parse({
      documentId: 'synthetic-scan',
      expectedFields: ['Invoice', 'Invoice number: SYN-001', 'Total'],
      expectedFieldTiers: prior.expectedFieldTiers,
    });

    expect(() =>
      assertScanPdfExpectedRefreshDoesNotWeaken(prior, weakened)
    ).toThrow(/expectedValues/);
  });

  it('preserves not_applicable table-cell fixtures exactly', () => {
    const noTablePrior = P1dExpectedFixtureSchema.parse({
      documentId: 'synthetic-no-table-scan',
      expectedFields: ['Form', 'Name'],
      expectedValues: [{ field: 'Name', expectedValue: 'Synthetic User' }],
      expectedTableCells: 'not_applicable',
    });

    const refreshed = mergeScanPdfExpectedRefresh({
      prior: noTablePrior,
      candidateFields: ['Generated OCR line'],
      regeneratedAt: '2026-06-18',
      model: 'gemini-test',
      recall: 0.9,
    });

    expect(refreshed.expectedTableCells).toBe('not_applicable');
    expect(refreshed.expectedValues).toEqual(noTablePrior.expectedValues);
  });

  it('supports reviewed public fixtures without appending unreviewed OCR fields', () => {
    const refreshed = mergeScanPdfExpectedRefresh({
      prior,
      candidateFields: [],
      regeneratedAt: '2026-06-18',
      model: 'gemini-test',
      recall: 0.8,
    });

    expect(refreshed.expectedFields).toEqual(prior.expectedFields);
    expect(refreshed.expectedFieldTiers).toEqual(prior.expectedFieldTiers);
    expect(refreshed.expectedValues).toEqual(prior.expectedValues);
    expect(refreshed.expectedTableCells).toEqual(prior.expectedTableCells);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildP1dQualityReport,
  evaluateP1dFixture,
  P1dExpectedFixtureSchema,
} from '../p1dQualityGate';
import { parseDocumentIr, type DocumentIr } from '../documentIr';

function testDocumentIr(): DocumentIr {
  return parseDocumentIr({
    schemaVersion: 1,
    source: {
      fileName: 'synthetic-form.pdf',
      mediaType: 'application/pdf',
      sourceKind: 'poc',
      sourceSubtype: 'official-doc-pdf',
    },
    pages: [
      {
        pageNumber: 1,
        blocks: [
          {
            blockId: 'p1-heading',
            kind: 'heading',
            text: 'Synthetic Form',
            locator: { pageNumber: 1 },
          },
          {
            blockId: 'p1-table-r1',
            kind: 'table',
            text: 'Name Example Taro\nSalary JPY 280,000',
            locator: { pageNumber: 1, tableIndex: 0, rowIndex: 1 },
          },
        ],
      },
    ],
  });
}

describe('P1-D quality gate stable metrics', () => {
  it('evaluates field, value, table-cell, locator, redaction, and chunk metrics', () => {
    const expected = P1dExpectedFixtureSchema.parse({
      documentId: 'synthetic-form',
      expectedFields: ['Synthetic Form', 'Salary'],
      expectedFieldTiers: { 'Synthetic Form': 'core' },
      expectedValues: [{ field: 'Salary', expectedValue: 'JPY 280,000' }],
      expectedTableCells: [
        { rowLabel: 'Salary', expectedValue: 'JPY 280,000' },
      ],
    });

    const result = evaluateP1dFixture({
      documentId: 'synthetic-form',
      fixturePath: 'sample-data/document-conversion/official-doc-pdf/synthetic-form.document-ir.json',
      sourceSubtype: 'official-doc-pdf',
      isPublicDocument: true,
      documentIr: testDocumentIr(),
      expected,
      chunks: [
        {
          text: 'Synthetic Form',
          locator: { kind: 'pdf', page: 1, paragraphId: 'p1-heading' },
          structureType: 'paragraph',
        },
        {
          text: 'Name [REDACTED:PERSON_NAME]\nSalary JPY 280,000',
          locator: { kind: 'pdf', page: 1, paragraphId: 'table-0-row-1' },
          structureType: 'table',
        },
      ],
    });

    expect(result.metrics.fieldRecall.rate).toBe(1);
    expect(result.metrics.coreFieldRecall.rate).toBe(1);
    expect(result.metrics.valuePrecision.rate).toBe(1);
    expect(result.metrics.tableCellRecall.rate).toBe(1);
    expect(result.metrics.locatorCoverage.rate).toBe(1);
    expect(result.metrics.chunkLocatorCoverage).toBe(1);
    expect(result.metrics.safetyObservations.falseMaskedTokenCount).toBe(1);
    expect(result.metrics.safetyObservations.redactionMarkerCount).toBe(1);
    expect(result.metrics.chunkReadiness.emptyChunkCount).toBe(0);
    expect(result.metrics.chunkReadiness.oversizedChunkCount).toBe(0);
  });

  it('does not treat redaction markers in non-public fixtures as false masking', () => {
    const result = evaluateP1dFixture({
      documentId: 'synthetic-pii',
      fixturePath: 'sample-data/document-conversion/official-doc-pdf/synthetic-pii.document-ir.json',
      sourceSubtype: 'official-doc-pdf',
      isPublicDocument: false,
      documentIr: testDocumentIr(),
      expected: P1dExpectedFixtureSchema.parse({
        documentId: 'synthetic-pii',
        expectedFields: ['Synthetic Form'],
      }),
      chunks: [
        {
          text: 'Name Example Taro',
          maskedText: 'Name [REDACTED:PERSON_NAME]',
          locator: { kind: 'pdf', page: 1 },
          structureType: 'paragraph',
        },
      ],
    });

    expect(result.metrics.safetyObservations.falseMaskedTokenCountMeasured).toBe(
      false
    );
    expect(result.metrics.safetyObservations.falseMaskedTokenCount).toBe(0);
    expect(result.metrics.safetyObservations.redactionMarkerCount).toBe(1);
  });

  it('uses value/table matching rules for locator coverage and reports locator misses', () => {
    const result = evaluateP1dFixture({
      documentId: 'locator-missing',
      fixturePath: 'sample-data/document-conversion/official-doc-pdf/locator-missing.document-ir.json',
      sourceSubtype: 'official-doc-pdf',
      isPublicDocument: true,
      documentIr: testDocumentIr(),
      expected: P1dExpectedFixtureSchema.parse({
        documentId: 'locator-missing',
        expectedValues: [{ field: 'Salary', expectedValue: 'JPY 280,000' }],
        expectedTableCells: [
          { rowLabel: 'Bonus', expectedValue: 'JPY 50,000' },
        ],
      }),
      chunks: [
        {
          text: 'Salary details are below. Approved amount: JPY 280,000',
          structureType: 'paragraph',
        },
        {
          text: 'Bonus\tJPY 50,000',
          locator: { kind: 'pdf', page: 1, paragraphId: 'table-0-row-1' },
          structureType: 'table',
        },
      ],
    });

    expect(result.metrics.valuePrecision.rate).toBe(1);
    expect(result.metrics.tableCellRecall.rate).toBe(1);
    expect(result.metrics.locatorCoverage.expectedCount).toBe(2);
    expect(result.metrics.locatorCoverage.locatedCount).toBe(1);
    expect(result.metrics.locatorCoverage.notFound).toEqual([]);
    expect(result.metrics.locatorCoverage.unlocated).toEqual([
      'Salary: JPY 280,000',
    ]);
    expect(result.metrics.locatorCoverage.missing).toEqual([
      'locator_missing: Salary: JPY 280,000',
    ]);
  });

  it('keeps full field recall and core field recall as separate signals', () => {
    const expected = P1dExpectedFixtureSchema.parse({
      documentId: 'tiered-fields',
      expectedFields: ['Synthetic Form', 'Missing Core Field', 'Salary'],
      expectedFieldTiers: {
        'Synthetic Form': 'core',
        'Missing Core Field': 'core',
      },
    });

    const result = evaluateP1dFixture({
      documentId: 'tiered-fields',
      fixturePath: 'sample-data/document-conversion/official-doc-pdf/tiered-fields.document-ir.json',
      sourceSubtype: 'official-doc-pdf',
      isPublicDocument: true,
      documentIr: testDocumentIr(),
      expected,
      chunks: [
        {
          text: 'Synthetic Form',
          locator: { kind: 'pdf', page: 1 },
          structureType: 'paragraph',
        },
        {
          text: 'Salary JPY 280,000',
          locator: { kind: 'pdf', page: 1 },
          structureType: 'table',
        },
      ],
    });

    expect(expected.expectedFields).toEqual([
      'Synthetic Form',
      'Missing Core Field',
      'Salary',
    ]);
    expect(expected.expectedFieldTiers).toEqual({
      'Synthetic Form': 'core',
      'Missing Core Field': 'core',
    });
    expect(result.metrics.fieldRecall.expectedCount).toBe(3);
    expect(result.metrics.fieldRecall.rate).toBe(2 / 3);
    expect(result.metrics.coreFieldRecall.expectedCount).toBe(2);
    expect(result.metrics.coreFieldRecall.rate).toBe(0.5);
  });

  it('keeps unmeasured structured metrics explicit when expected sidecar is absent', () => {
    const result = evaluateP1dFixture({
      documentId: 'no-expected',
      fixturePath: 'sample-data/document-conversion/scan-pdf/no-expected.document-ir.json',
      sourceSubtype: 'scan-pdf',
      isPublicDocument: false,
      documentIr: testDocumentIr(),
      chunks: [{ text: 'Synthetic Form', structureType: 'paragraph' }],
    });

    expect(result.hasExpectedSidecar).toBe(false);
    expect(result.metrics.fieldRecall.measured).toBe(false);
    expect(result.metrics.coreFieldRecall.rate).toBeNull();
    expect(result.metrics.fieldRecall.rate).toBeNull();
    expect(result.metrics.valuePrecision.rate).toBeNull();
    expect(result.metrics.tableCellRecall.rate).toBeNull();
    expect(result.notes).toContain(
      'expected sidecar missing; structured recall metrics not measured'
    );
  });

  it('builds a report-only stable summary without live-call semantics', () => {
    const report = buildP1dQualityReport(
      [
        evaluateP1dFixture({
          documentId: 'synthetic-form',
          fixturePath: 'fixture.document-ir.json',
          sourceSubtype: 'official-doc-pdf',
          isPublicDocument: true,
          documentIr: testDocumentIr(),
          expected: P1dExpectedFixtureSchema.parse({
            documentId: 'synthetic-form',
            expectedFields: ['Synthetic Form'],
          }),
          chunks: [
            {
              text: 'Synthetic Form',
              locator: { kind: 'pdf', page: 1 },
              structureType: 'paragraph',
            },
          ],
        }),
      ],
      [
        {
          documentId: 'live-only',
          fixturePath: 'sample-data/document-conversion/scan-pdf/live-only.pdf',
          sourceSubtype: 'scan-pdf',
          reason: 'live only',
        },
      ],
      '2026-06-11T00:00:00.000Z'
    );

    expect(report.mode).toBe('stable');
    expect(report.liveCalls).toBe(false);
    expect(report.reportOnly).toBe(true);
    expect(report.summary.evaluatedFixtureCount).toBe(1);
    expect(report.summary.skippedFixtureCount).toBe(1);
    expect(report.summary.fieldRecallAverage).toBe(1);
    expect(report.summary.coreFieldRecallAverage).toBeNull();
    expect(report.summary.valuePrecisionAverage).toBeNull();
    expect(report.summary.tableCellRecallAverage).toBeNull();
    expect(report.summary.deterministicZeroChecks).toEqual([
      {
        metric: 'falseMaskedTokenCount',
        expected: 0,
        actual: 0,
        passed: true,
        ciBlockerCandidate: true,
      },
      {
        metric: 'emptyChunkCount',
        expected: 0,
        actual: 0,
        passed: true,
        ciBlockerCandidate: true,
      },
      {
        metric: 'oversizedChunkCount',
        expected: 0,
        actual: 0,
        passed: true,
        ciBlockerCandidate: true,
      },
    ]);
    expect(report.metricsPolicy.ciBlocker).toBe(false);
  });
});

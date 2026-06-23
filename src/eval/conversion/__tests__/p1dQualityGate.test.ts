import { describe, expect, it } from 'vitest';
import {
  buildP1dQualityReport,
  evaluateP1dFixture,
  listFailedDeterministicZeroChecks,
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

  it('rejects expectedFieldTiers keys that are not expectedFields', () => {
    expect(() =>
      P1dExpectedFixtureSchema.parse({
        documentId: 'tier-typo',
        expectedFields: ['Synthetic Form'],
        expectedFieldTiers: {
          'Synthetic From': 'core',
        },
      })
    ).toThrow(/expectedFieldTiers key must also exist in expectedFields/);
  });

  it('rejects one-character expectedValues after normalization', () => {
    expect(() =>
      P1dExpectedFixtureSchema.parse({
        documentId: 'weak-value-hard-fail',
        expectedValues: [{ field: 'Currency', expectedValue: '円' }],
      })
    ).toThrow(
      /expectedValues\[\]\.expectedValue must normalize to at least 2 characters/
    );
  });

  it('warns on weak short expectedValues without failing the sidecar', () => {
    const result = evaluateP1dFixture({
      documentId: 'weak-value-note',
      fixturePath: 'sample-data/document-conversion/official-doc-pdf/weak-value-note.document-ir.json',
      sourceSubtype: 'official-doc-pdf',
      isPublicDocument: true,
      documentIr: testDocumentIr(),
      expected: P1dExpectedFixtureSchema.parse({
        documentId: 'weak-value-note',
        expectedValues: [{ field: 'Article', expectedValue: '12' }],
      }),
      chunks: [
        {
          text: 'Article 12',
          locator: { kind: 'pdf', page: 1 },
          structureType: 'paragraph',
        },
      ],
    });

    expect(result.metrics.valuePrecision.rate).toBe(1);
    expect(result.notes).toContain('weak_expected_value: Article: 12');
  });

  it('treats tableCellRecall not_applicable as distinct from undefined', () => {
    const documentIr = parseDocumentIr({
      schemaVersion: 1,
      source: {
        fileName: 'synthetic-note.pdf',
        mediaType: 'application/pdf',
        sourceKind: 'poc',
        sourceSubtype: 'official-doc-pdf',
      },
      pages: [
        {
          pageNumber: 1,
          blocks: [
            {
              blockId: 'p1-note',
              kind: 'paragraph',
              text: 'Synthetic note',
              locator: { pageNumber: 1 },
            },
          ],
        },
      ],
    });
    const result = evaluateP1dFixture({
      documentId: 'no-table-source',
      fixturePath: 'sample-data/document-conversion/official-doc-pdf/no-table-source.document-ir.json',
      sourceSubtype: 'official-doc-pdf',
      isPublicDocument: true,
      documentIr,
      expected: P1dExpectedFixtureSchema.parse({
        documentId: 'no-table-source',
        expectedTableCells: 'not_applicable',
      }),
      chunks: [
        {
          text: 'Synthetic note',
          locator: { kind: 'pdf', page: 1 },
          structureType: 'paragraph',
        },
      ],
    });

    expect(result.metrics.tableCellRecall.rate).toBeNull();
    expect(result.metrics.tableCellRecallStatus).toBe('not_applicable');
    expect(result.notes).toContain(
      'expectedTableCells not applicable; source has no tables'
    );
  });

  it('rejects not_applicable table cells when source evidence contains tables', () => {
    const expected = P1dExpectedFixtureSchema.parse({
      documentId: 'table-source-conflict',
      expectedTableCells: 'not_applicable',
    });

    expect(() =>
      evaluateP1dFixture({
        documentId: 'table-source-conflict',
        fixturePath: 'sample-data/document-conversion/official-doc-pdf/table-source-conflict.document-ir.json',
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
        ],
      })
    ).toThrow(/declares expectedTableCells as not_applicable/);
  });

  it('rejects not_applicable table cells when synthesized chunks contain a table structureType', () => {
    // The DocumentIR itself has no table blocks (so the source-evidence check
    // passes), but a deterministic scan-pdf adapter (inline-unit / known-form
    // template) can synthesize a table chunk. This must still fail-closed so an
    // adapter that fires on a not_applicable fixture cannot silently inflate the
    // table-cell denominator.
    const expected = P1dExpectedFixtureSchema.parse({
      documentId: 'synthesized-table-conflict',
      expectedTableCells: 'not_applicable',
    });

    const noTableDocumentIr = parseDocumentIr({
      schemaVersion: 1,
      source: {
        fileName: 'synthetic-form.pdf',
        mediaType: 'application/pdf',
        sourceKind: 'poc',
        sourceSubtype: 'scan-pdf',
      },
      pages: [
        {
          pageNumber: 1,
          blocks: [
            {
              blockId: 'p1-ocr1',
              kind: 'paragraph',
              text: '休憩時間（ ）分',
              locator: { pageNumber: 1 },
            },
          ],
        },
      ],
    });

    expect(() =>
      evaluateP1dFixture({
        documentId: 'synthesized-table-conflict',
        fixturePath:
          'sample-data/document-conversion/scan-pdf/synthesized-table-conflict.document-ir.json',
        sourceSubtype: 'scan-pdf',
        isPublicDocument: true,
        documentIr: noTableDocumentIr,
        expected,
        chunks: [
          {
            text: '休憩時間\t分',
            locator: { kind: 'pdf', page: 1 },
            structureType: 'table',
          },
        ],
      })
    ).toThrow(/declares expectedTableCells as not_applicable/);
  });

  it('uses tableId to scope table-cell matching when table identity is available', () => {
    const chunks = [
      {
        id: 'doc:p1-t1-r0',
        text: 'Salary\tJPY 280,000',
        locator: { kind: 'pdf', page: 1, paragraphId: 'p1-t1-r0' },
        structureType: 'table',
      },
      {
        id: 'doc:p1-t2-r0',
        text: 'Salary\tJPY 310,000',
        locator: { kind: 'pdf', page: 1, paragraphId: 'p1-t2-r0' },
        structureType: 'table',
      },
    ];

    const matched = evaluateP1dFixture({
      documentId: 'table-id-matched',
      fixturePath: 'sample-data/document-conversion/official-doc-pdf/table-id-matched.document-ir.json',
      sourceSubtype: 'official-doc-pdf',
      isPublicDocument: true,
      documentIr: testDocumentIr(),
      expected: P1dExpectedFixtureSchema.parse({
        documentId: 'table-id-matched',
        expectedTableCells: [
          {
            tableId: 'p1-t2',
            rowLabel: 'Salary',
            expectedValue: 'JPY 310,000',
          },
        ],
      }),
      chunks,
    });

    const mismatched = evaluateP1dFixture({
      documentId: 'table-id-mismatched',
      fixturePath: 'sample-data/document-conversion/official-doc-pdf/table-id-mismatched.document-ir.json',
      sourceSubtype: 'official-doc-pdf',
      isPublicDocument: true,
      documentIr: testDocumentIr(),
      expected: P1dExpectedFixtureSchema.parse({
        documentId: 'table-id-mismatched',
        expectedTableCells: [
          {
            tableId: 'p1-t2',
            rowLabel: 'Salary',
            expectedValue: 'JPY 280,000',
          },
        ],
      }),
      chunks,
    });

    expect(matched.metrics.tableCellRecall.rate).toBe(1);
    expect(matched.metrics.locatorCoverage.rate).toBe(1);
    expect(mismatched.metrics.tableCellRecall.rate).toBe(0);
    expect(mismatched.metrics.tableCellRecall.missing).toEqual([
      'p1-t2 / Salary / JPY 280,000',
    ]);
  });

  it('maps pN-tM tableId expectations to synthesized table-M-row-N locators', () => {
    const result = evaluateP1dFixture({
      documentId: 'table-id-synthesized-locator',
      fixturePath: 'sample-data/document-conversion/official-doc-pdf/table-id-synthesized-locator.document-ir.json',
      sourceSubtype: 'official-doc-pdf',
      isPublicDocument: true,
      documentIr: testDocumentIr(),
      expected: P1dExpectedFixtureSchema.parse({
        documentId: 'table-id-synthesized-locator',
        expectedTableCells: [
          {
            tableId: 'p3-t1',
            rowLabel: '月',
            columnLabel: '上限',
            expectedValue: '45時間',
          },
        ],
      }),
      chunks: [
        {
          text: '月\t上限\t45時間',
          locator: { kind: 'pdf', page: 3, paragraphId: 'table-1-row-1' },
          structureType: 'table',
        },
      ],
    });

    expect(result.metrics.tableCellRecall.rate).toBe(1);
    expect(result.metrics.locatorCoverage.rate).toBe(1);
  });

  it('treats scan-pdf pN-ocrM table ids as page-scoped hints for OCR drift', () => {
    const result = evaluateP1dFixture({
      documentId: 'scan-pdf-ocr-table-id-drift',
      fixturePath: 'sample-data/document-conversion/scan-pdf/scan-pdf-ocr-table-id-drift.document-ir.json',
      sourceSubtype: 'scan-pdf',
      isPublicDocument: true,
      documentIr: testDocumentIr(),
      expected: P1dExpectedFixtureSchema.parse({
        documentId: 'scan-pdf-ocr-table-id-drift',
        expectedTableCells: [
          {
            tableId: 'p1-ocr3',
            rowLabel: '契約期間',
            expectedValue: '期間の定めなし',
          },
          {
            tableId: 'p2-ocr3',
            rowLabel: '契約期間',
            expectedValue: '期間の定めなし',
          },
        ],
      }),
      chunks: [
        {
          text: '契約期間\t期間の定めなし',
          locator: { kind: 'pdf', page: 1, paragraphId: 'p1-ocr7' },
          structureType: 'table',
        },
      ],
    });

    expect(result.metrics.tableCellRecall.rate).toBe(0.5);
    expect(result.metrics.tableCellRecall.missing).toEqual([
      'p2-ocr3 / 契約期間 / 期間の定めなし',
    ]);
    expect(result.metrics.locatorCoverage.locatedCount).toBe(1);
    expect(result.metrics.locatorCoverage.notFound).toEqual([
      'p2-ocr3 / 契約期間 / 期間の定めなし',
    ]);
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

  it('builds a stable summary without live-call semantics', () => {
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
    expect(report.summary.evaluatedFixtureCount).toBe(1);
    expect(report.summary.skippedFixtureCount).toBe(1);
    expect(report.summary.fieldRecallAverage).toBe(1);
    expect(report.summary.coreFieldRecallAverage).toBeNull();
    expect(report.summary.valuePrecisionAverage).toBeNull();
    expect(report.summary.tableCellRecallAverage).toBeNull();
    expect(report.summary.tableCellRecallNotApplicableCount).toBe(0);
    expect(report.summary.tableCellRecallUndefinedCount).toBe(1);
    expect(report.summary.deterministicZeroChecks).toEqual([
      {
        metric: 'falseMaskedTokenCount',
        expected: 0,
        actual: 0,
        passed: true,
        ciBlocker: true,
      },
      {
        metric: 'emptyChunkCount',
        expected: 0,
        actual: 0,
        passed: true,
        ciBlocker: true,
      },
      {
        metric: 'oversizedChunkCount',
        expected: 0,
        actual: 0,
        passed: true,
        ciBlocker: true,
      },
    ]);
    expect(report.metricsPolicy.ciBlockerMetrics).toEqual([
      'falseMaskedTokenCount',
      'emptyChunkCount',
      'oversizedChunkCount',
    ]);
    expect(report.metricsPolicy.recallMetricsReportOnly).toBe(true);
    expect(listFailedDeterministicZeroChecks(report)).toEqual([]);
  });

  it('lists failed deterministic zero checks for the CI gate', () => {
    const report = buildP1dQualityReport(
      [
        evaluateP1dFixture({
          documentId: 'public-doc-with-redaction',
          fixturePath: 'fixture.document-ir.json',
          sourceSubtype: 'official-doc-pdf',
          isPublicDocument: true,
          documentIr: testDocumentIr(),
          chunks: [
            {
              text: 'Notice [REDACTED:PERSON_NAME]',
              locator: { kind: 'pdf', page: 1 },
              structureType: 'paragraph',
            },
          ],
        }),
      ],
      [],
      '2026-06-11T00:00:00.000Z'
    );

    const failed = listFailedDeterministicZeroChecks(report);
    expect(failed).toHaveLength(1);
    expect(failed[0].metric).toBe('falseMaskedTokenCount');
    expect(failed[0].actual).toBe(1);
    expect(failed[0].passed).toBe(false);
  });
});

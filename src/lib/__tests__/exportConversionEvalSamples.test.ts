import { describe, expect, it } from 'vitest';
import {
  collectExportRowsFromDocs,
  parseArgs,
} from '../../../scripts/exportConversionEvalSamples';
import { createEmptyConversionEvalResult } from '../../eval/conversion/conversionEvalResult';

describe('exportConversionEvalSamples', () => {
  it('extracts M3 threshold sample fields from mock Firestore docs', async () => {
    const result = createEmptyConversionEvalResult();
    result.coverage.pageCoverage = 0.75;
    result.coverage.textDensityWarnings = ['page 2 is sparse'];
    result.coverage.tableCandidates = 3;
    result.locatorQuality.hasPageLocators = true;
    result.locatorQuality.hasTableLocators = false;
    result.contextPackageReadiness.oversizedChunks = 1;
    result.safetyReadiness.maskableChunkRate = 0.9;
    result.safetyReadiness.unmaskablePiiFindings = 2;

    const samples = await collectExportRowsFromDocs(
      [
        {
          id: 'doc-a:v1',
          data: () => ({
            docId: 'doc-a',
            revisionId: 'v1',
            stage: 'health',
            result,
            createdAt: '2026-05-20T00:00:00.000Z',
          }),
        },
        {
          id: 'doc-b:v1',
          data: () => ({
            docId: 'doc-b',
            revisionId: 'v1',
            stage: 'health',
            sourceSubtype: 'slide-pdf',
            result,
          }),
        },
      ],
      async (docId) => (docId === 'doc-a' ? 'official-doc-pdf' : null)
    );

    expect(samples.skippedBySubtype).toBe(1);
    expect(samples.skippedInvalid).toBe(0);
    expect(samples.rows).toEqual([
      {
        evalId: 'doc-a:v1',
        docId: 'doc-a',
        revisionId: 'v1',
        stage: 'health',
        createdAt: '2026-05-20T00:00:00.000Z',
        sourceSubtype: 'official-doc-pdf',
        coverage: {
          pageCoverage: 0.75,
          textDensityWarningsLength: 1,
          tableCandidates: 3,
        },
        locatorQuality: {
          hasPageLocators: true,
          hasTableLocators: false,
        },
        contextPackageReadiness: {
          oversizedChunks: 1,
        },
        safetyReadiness: {
          maskableChunkRate: 0.9,
          unmaskablePiiFindings: 2,
        },
      },
    ]);
  });

  it('supports dry-run output path defaults', () => {
    expect(parseArgs(['--dry-run'])).toEqual(
      expect.objectContaining({
        dryRun: true,
        outputPath: expect.stringMatching(
          /^tmp\/conversion-eval-samples-\d{4}-\d{2}-\d{2}\.jsonl$/
        ),
      })
    );
  });

  it('sorts rows deterministically when timestamps are missing or invalid', async () => {
    const result = createEmptyConversionEvalResult();
    const samples = await collectExportRowsFromDocs(
      [
        {
          id: 'doc-b:v1',
          data: () => ({
            docId: 'doc-b',
            revisionId: 'v1',
            stage: 'health',
            result,
            createdAt: 'not-a-date',
          }),
        },
        {
          id: 'doc-a:v1',
          data: () => ({
            docId: 'doc-a',
            revisionId: 'v1',
            stage: 'health',
            result,
          }),
        },
      ],
      async () => 'official-doc-pdf'
    );

    expect(samples.rows.map((row) => row.evalId)).toEqual([
      'doc-a:v1',
      'doc-b:v1',
    ]);
    expect(samples.rows[0].createdAt).toBeNull();
  });
});

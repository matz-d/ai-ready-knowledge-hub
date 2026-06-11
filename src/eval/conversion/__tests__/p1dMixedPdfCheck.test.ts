import { describe, expect, it } from 'vitest';
import {
  buildP1dMixedPdfHandoffCases,
  classifyP1dMixedPdfExtraction,
} from '../p1dMixedPdfCheck';

describe('P1-D mixed PDF local classification', () => {
  it('passes when text, tables, and chunk readiness are clean', () => {
    expect(
      classifyP1dMixedPdfExtraction({
        textExtractionOk: true,
        textCharCount: 1200,
        tableExtractionOk: true,
        oversizedChunkCount: 0,
        emptyChunkCount: 0,
        chunkCount: 12,
      })
    ).toEqual({
      largeMixedPdfExtractionStatus: 'pass',
      largeMixedPdfFailureReasons: [],
    });
  });

  it('returns partial when table extraction fails but text is usable', () => {
    expect(
      classifyP1dMixedPdfExtraction({
        textExtractionOk: true,
        textCharCount: 1200,
        tableExtractionOk: false,
        oversizedChunkCount: 0,
        emptyChunkCount: 0,
        chunkCount: 12,
      })
    ).toEqual({
      largeMixedPdfExtractionStatus: 'partial',
      largeMixedPdfFailureReasons: ['table_failed'],
    });
  });

  it('returns failed when text extraction fails and keeps orthogonal symptoms', () => {
    expect(
      classifyP1dMixedPdfExtraction({
        textExtractionOk: false,
        textCharCount: 0,
        tableExtractionOk: false,
        oversizedChunkCount: 1,
        emptyChunkCount: 2,
        chunkCount: 1201,
        maxChunks: 1000,
      })
    ).toEqual({
      largeMixedPdfExtractionStatus: 'failed',
      largeMixedPdfFailureReasons: [
        'text_failed',
        'table_failed',
        'oversized',
        'empty_chunks',
        'too_many_chunks',
      ],
    });
  });

  it('builds a P1-E handoff case only when symptoms exist', () => {
    expect(
      buildP1dMixedPdfHandoffCases({
        localPath: '/tmp/annual-report.pdf',
        command: 'pnpm eval:p1d:mixed-pdf -- /tmp/annual-report.pdf',
        reasons: [],
      })
    ).toEqual([]);

    const handoffCases = buildP1dMixedPdfHandoffCases({
      localPath: '/tmp/annual-report.pdf',
      command: 'pnpm eval:p1d:mixed-pdf -- /tmp/annual-report.pdf',
      reasons: ['table_failed'],
    });

    expect(handoffCases).toHaveLength(1);
    expect(handoffCases[0]).toMatchObject({
      materialType: 'large-mixed-pdf',
      fixtureOrLocalPath: '/tmp/annual-report.pdf',
      failureSymptoms: ['table_failed'],
      targetPhase: 'P1-E',
    });
  });
});


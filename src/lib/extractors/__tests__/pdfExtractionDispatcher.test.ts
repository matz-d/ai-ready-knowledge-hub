import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  extractPdfFromBufferMock,
  extractSlidePdfFromBufferMock,
  extractScanPdfFromBufferMock,
} = vi.hoisted(() => ({
  extractPdfFromBufferMock: vi.fn(),
  extractSlidePdfFromBufferMock: vi.fn(),
  extractScanPdfFromBufferMock: vi.fn(),
}));

vi.mock('../pdfDocumentExtractor', () => ({
  extractPdfFromBuffer: extractPdfFromBufferMock,
}));

vi.mock('../slidePdfDocumentExtractor', () => ({
  extractSlidePdfFromBuffer: extractSlidePdfFromBufferMock,
}));

vi.mock('../scanPdfDocumentExtractor', () => ({
  extractScanPdfFromBuffer: extractScanPdfFromBufferMock,
}));

import type { FeatureFlagId } from '../../featureFlags';
import { augmentOfficialDocWithTableAssist } from '../officialDocPdfTableAssist';
import {
  buildPdfCuratorContent,
  dispatchPdfExtraction,
  PDF_CONFLICTING_SUBTYPE_FLAGS_MESSAGE,
  PDF_SUBTYPE_PRE_FLIGHT_CONFIGS,
  PDF_UPLOAD_BETA_DISABLED_MESSAGE,
  type PdfExtractionResult,
} from '../pdfExtractionDispatcher';

const minimalPdfExtraction = {
  textContent: 'PDF body text',
  pageTexts: [{ pageNumber: 1, text: 'PDF body text' }],
  documentIr: {
    schemaVersion: 1 as const,
    source: {
      fileName: 'sample.pdf',
      mediaType: 'application/pdf',
      sourceKind: 'upload' as const,
      sourceSubtype: 'official-doc-pdf' as const,
    },
    pages: [
      {
        pageNumber: 1,
        blocks: [
          {
            blockId: 'p1-b0',
            kind: 'paragraph' as const,
            text: 'PDF body text',
          },
        ],
      },
    ],
  },
};

const minimalSlidePdfExtraction = {
  textContent: 'Slide PDF body text',
  documentIr: {
    schemaVersion: 1,
    source: {
      fileName: 'sample.pdf',
      mediaType: 'application/pdf',
      sourceKind: 'upload',
      sourceSubtype: 'slide-pdf',
    },
    pages: [
      {
        pageNumber: 1,
        blocks: [
          {
            blockId: 's1-b1',
            kind: 'paragraph',
            text: 'Slide PDF body text',
          },
        ],
      },
    ],
  },
  conversion: {
    converterId: 'gemini-direct-read' as const,
    calledVertex: true as const,
    model: 'gemini-3.5-flash',
    region: 'global',
  },
};

const minimalScanPdfExtraction = {
  textContent: 'Scan PDF OCR body text',
  documentIr: {
    schemaVersion: 1,
    source: {
      fileName: 'sample.pdf',
      mediaType: 'application/pdf',
      sourceKind: 'upload',
      sourceSubtype: 'scan-pdf',
    },
    pages: [
      {
        pageNumber: 1,
        blocks: [
          {
            blockId: 'p1-ocr1',
            kind: 'paragraph',
            text: 'Scan PDF OCR body text',
          },
        ],
      },
    ],
  },
  conversion: {
    converterId: 'gemini-vertex-ocr' as const,
    calledVertex: true as const,
    model: 'gemini-3.1-flash-lite',
    region: 'global',
    piiFindings: [
      {
        pageNumber: 1,
        category: 'person_name' as const,
        evidenceSnippet: '山田太郎',
        maskability: 'maskable' as const,
        reason: 'full name visible',
      },
      {
        pageNumber: 1,
        category: 'address' as const,
        evidenceSnippet: '東京都...',
        maskability: 'unmaskable' as const,
        reason: 'partial visibility',
      },
    ],
  },
};

function pdfBuffer(): Buffer {
  return Buffer.from('%PDF-1.4 fake');
}

/** Table-suspect raw page text so selectCandidatePages picks page 1. */
const TABLE_SUSPECT_PAGE_TEXT =
  'Monthly overtime cap   45 hours   Manager review\nAnnual cap   360 hours   HR';

function officialDocWithPageTexts(): PdfExtractionResult {
  return {
    textContent: TABLE_SUSPECT_PAGE_TEXT,
    documentIr: {
      schemaVersion: 1,
      source: {
        fileName: 'sample.pdf',
        mediaType: 'application/pdf',
        sourceKind: 'upload',
        sourceSubtype: 'official-doc-pdf',
      },
      pages: [
        {
          pageNumber: 1,
          blocks: [
            {
              blockId: 'p1-b0',
              kind: 'paragraph',
              text: TABLE_SUSPECT_PAGE_TEXT,
            },
          ],
        },
      ],
    },
    pageTexts: [{ pageNumber: 1, text: TABLE_SUSPECT_PAGE_TEXT }],
    conversion: { converterId: 'pdf-parse' },
  };
}

const subtype1InjectedConfig = {
  flagId: 'pdf-conversion-subtype-1' as const,
  extract: async () => officialDocWithPageTexts(),
};

function fakeSplitDeps() {
  return {
    splitPages: async ({
      pageNumbers,
    }: {
      pageNumbers: readonly number[];
    }) =>
      pageNumbers.map((pageNumber) => ({
        pageNumber,
        pdfBytes: new Uint8Array(),
      })),
  };
}

function isFlagEnabledFor(
  enabled: FeatureFlagId[]
): (flagId: FeatureFlagId) => Promise<boolean> {
  const enabledSet = new Set(enabled);
  return async (flagId) => enabledSet.has(flagId);
}

describe('dispatchPdfExtraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extractPdfFromBufferMock.mockResolvedValue(minimalPdfExtraction);
    extractSlidePdfFromBufferMock.mockResolvedValue(minimalSlidePdfExtraction);
    extractScanPdfFromBufferMock.mockResolvedValue(minimalScanPdfExtraction);
  });

  it('returns no_flag_enabled when no subtype flag is on', async () => {
    const outcome = await dispatchPdfExtraction({
      buffer: pdfBuffer(),
      fileName: 'sample.pdf',
      isFlagEnabled: async () => false,
      configs: PDF_SUBTYPE_PRE_FLIGHT_CONFIGS,
    });

    expect(outcome).toEqual({ ok: false, failure: { code: 'no_flag_enabled' } });
    expect(extractPdfFromBufferMock).not.toHaveBeenCalled();
    expect(extractSlidePdfFromBufferMock).not.toHaveBeenCalled();
    expect(extractScanPdfFromBufferMock).not.toHaveBeenCalled();
    expect(PDF_UPLOAD_BETA_DISABLED_MESSAGE).toContain('ベータ機能');
  });

  it('extracts official-doc PDF when subtype-1 is enabled', async () => {
    const outcome = await dispatchPdfExtraction({
      buffer: pdfBuffer(),
      fileName: 'sample.pdf',
      isFlagEnabled: async (flagId) => flagId === 'pdf-conversion-subtype-1',
      configs: PDF_SUBTYPE_PRE_FLIGHT_CONFIGS,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(extractPdfFromBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'sample.pdf',
        sourceSubtype: 'official-doc-pdf',
      })
    );
    expect(extractSlidePdfFromBufferMock).not.toHaveBeenCalled();
    expect(extractScanPdfFromBufferMock).not.toHaveBeenCalled();
    expect(outcome.result).toEqual(
      expect.objectContaining({
        textContent: 'PDF body text',
        conversion: { converterId: 'pdf-parse' },
      })
    );
  });

  it('returns conflicting_flags when subtype-1 and subtype-2 are both enabled', async () => {
    const outcome = await dispatchPdfExtraction({
      buffer: pdfBuffer(),
      fileName: 'sample.pdf',
      isFlagEnabled: async (flagId) =>
        flagId === 'pdf-conversion-subtype-1' ||
        flagId === 'pdf-conversion-subtype-2',
      configs: PDF_SUBTYPE_PRE_FLIGHT_CONFIGS,
    });

    expect(outcome).toEqual({
      ok: false,
      failure: {
        code: 'conflicting_flags',
        enabledFlagIds: ['pdf-conversion-subtype-2', 'pdf-conversion-subtype-1'],
      },
    });
    expect(PDF_CONFLICTING_SUBTYPE_FLAGS_MESSAGE).toContain('feature flag が競合');
    expect(extractPdfFromBufferMock).not.toHaveBeenCalled();
  });

  it('uses slide-pdf extractor when subtype-2 is enabled', async () => {
    const outcome = await dispatchPdfExtraction({
      buffer: pdfBuffer(),
      fileName: 'sample.pdf',
      isFlagEnabled: async (flagId) => flagId === 'pdf-conversion-subtype-2',
      configs: PDF_SUBTYPE_PRE_FLIGHT_CONFIGS,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(extractSlidePdfFromBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'sample.pdf' })
    );
    expect(extractPdfFromBufferMock).not.toHaveBeenCalled();
    expect(extractScanPdfFromBufferMock).not.toHaveBeenCalled();
    expect(outcome.result.conversion).toEqual({
      converterId: 'gemini-direct-read',
      inferenceDestination: {
        vendor: 'vertex',
        region: 'global',
        model: 'gemini-3.5-flash',
      },
    });
  });

  it('uses scan-pdf extractor and counts unmaskable OCR findings when subtype-3 is enabled', async () => {
    const outcome = await dispatchPdfExtraction({
      buffer: pdfBuffer(),
      fileName: 'sample.pdf',
      isFlagEnabled: async (flagId) => flagId === 'pdf-conversion-subtype-3',
      configs: PDF_SUBTYPE_PRE_FLIGHT_CONFIGS,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(extractScanPdfFromBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'sample.pdf' })
    );
    expect(outcome.result.conversion).toEqual(
      expect.objectContaining({
        converterId: 'gemini-vertex-ocr',
        unmaskablePiiFindingsCount: 1,
      })
    );
  });

  it('returns extraction_failed when scan-pdf extraction throws', async () => {
    extractScanPdfFromBufferMock.mockRejectedValue(
      new Error('scan-pdf ocr fail-closed: gemini-output-empty')
    );

    const outcome = await dispatchPdfExtraction({
      buffer: pdfBuffer(),
      fileName: 'sample.pdf',
      isFlagEnabled: async (flagId) => flagId === 'pdf-conversion-subtype-3',
      configs: PDF_SUBTYPE_PRE_FLIGHT_CONFIGS,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure).toEqual(
      expect.objectContaining({
        code: 'extraction_failed',
        cause: expect.any(Error),
      })
    );
  });

  it('returns conflicting_flags when all three subtype flags are enabled', async () => {
    const outcome = await dispatchPdfExtraction({
      buffer: pdfBuffer(),
      fileName: 'sample.pdf',
      isFlagEnabled: async () => true,
      configs: PDF_SUBTYPE_PRE_FLIGHT_CONFIGS,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.code).toBe('conflicting_flags');
    if (outcome.failure.code !== 'conflicting_flags') return;
    expect(outcome.failure.enabledFlagIds).toHaveLength(3);
  });
});

describe('table-assist gating (WU-6b)', () => {
  it('does not run table-assist when tableAssistMode is disabled', async () => {
    const augmentTableAssist = vi.fn();

    const outcome = await dispatchPdfExtraction({
      buffer: pdfBuffer(),
      fileName: 'sample.pdf',
      isFlagEnabled: isFlagEnabledFor([
        'pdf-conversion-subtype-1',
        'pdf-table-assist',
      ]),
      tableAssistMode: 'disabled',
      configs: [subtype1InjectedConfig],
      augmentTableAssist,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(augmentTableAssist).not.toHaveBeenCalled();
    expect(outcome.result.conversion.tableAssist).toBeUndefined();
  });

  it('does not run table-assist when mode is async but pdf-table-assist flag is off', async () => {
    const augmentTableAssist = vi.fn();

    const outcome = await dispatchPdfExtraction({
      buffer: pdfBuffer(),
      fileName: 'sample.pdf',
      isFlagEnabled: isFlagEnabledFor(['pdf-conversion-subtype-1']),
      tableAssistMode: 'async',
      configs: [subtype1InjectedConfig],
      augmentTableAssist,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(augmentTableAssist).not.toHaveBeenCalled();
    expect(outcome.result.conversion.tableAssist).toBeUndefined();
  });

  it('merges table-assist blocks when mode is async and pdf-table-assist flag is on', async () => {
    const augmentWithMerge: typeof augmentOfficialDocWithTableAssist = (
      options
    ) =>
      augmentOfficialDocWithTableAssist({
        ...options,
        deps: {
          ...fakeSplitDeps(),
          extractTableRowsForPage: async ({ pageNumber }) => [
            { pageNumber, cells: ['Monthly overtime cap', '45 hours'] },
          ],
        },
      });

    const outcome = await dispatchPdfExtraction({
      buffer: pdfBuffer(),
      fileName: 'sample.pdf',
      isFlagEnabled: isFlagEnabledFor([
        'pdf-conversion-subtype-1',
        'pdf-table-assist',
      ]),
      tableAssistMode: 'async',
      configs: [subtype1InjectedConfig],
      augmentTableAssist: augmentWithMerge,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.conversion.tableAssist).toEqual(
      expect.objectContaining({
        status: 'merged',
        rowsMerged: 1,
      })
    );
    expect(
      outcome.result.documentIr.pages[0]!.blocks.some(
        (block) => block.kind === 'table'
      )
    ).toBe(true);
  });

  it('records when table-assist falls back because pageTexts are unavailable', async () => {
    const { pageTexts: _pageTexts, ...withoutPageTexts } =
      officialDocWithPageTexts();
    const augmentTableAssist = vi.fn<typeof augmentOfficialDocWithTableAssist>(
      async (options) => ({
        documentIr: options.documentIr,
        summary: {
          status: 'skipped',
          candidatePageCount: 0,
          pagesProcessed: 0,
          pagesFailed: 0,
          rawRowCount: 0,
          rowsMerged: 0,
          rowsRejected: 0,
          elapsedMs: 1,
        },
      })
    );

    const outcome = await dispatchPdfExtraction({
      buffer: pdfBuffer(),
      fileName: 'sample.pdf',
      isFlagEnabled: isFlagEnabledFor([
        'pdf-conversion-subtype-1',
        'pdf-table-assist',
      ]),
      tableAssistMode: 'async',
      configs: [
        {
          flagId: 'pdf-conversion-subtype-1',
          extract: async () => withoutPageTexts,
        },
      ],
      augmentTableAssist,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(augmentTableAssist).toHaveBeenCalledWith(
      expect.objectContaining({
        pageRawTexts: expect.any(Map),
      })
    );
    expect(
      outcome.result.conversion.tableAssist?.reason
    ).toBe('pageTexts unavailable; used DocumentIR block text fallback');
  });

  it('keeps pdf-parse IR and records skipped when page extraction throws (fail-soft)', async () => {
    const base = officialDocWithPageTexts();
    const augmentWithThrow: typeof augmentOfficialDocWithTableAssist = (
      options
    ) =>
      augmentOfficialDocWithTableAssist({
        ...options,
        deps: {
          ...fakeSplitDeps(),
          extractTableRowsForPage: async () => {
            throw new Error('gemini boom');
          },
        },
      });

    const outcome = await dispatchPdfExtraction({
      buffer: pdfBuffer(),
      fileName: 'sample.pdf',
      isFlagEnabled: isFlagEnabledFor([
        'pdf-conversion-subtype-1',
        'pdf-table-assist',
      ]),
      tableAssistMode: 'async',
      configs: [subtype1InjectedConfig],
      augmentTableAssist: augmentWithThrow,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.documentIr).toEqual(base.documentIr);
    expect(outcome.result.conversion.tableAssist).toEqual(
      expect.objectContaining({
        status: 'skipped',
        rowsMerged: 0,
        pagesFailed: 1,
      })
    );
    expect(outcome.result.conversion.tableAssist?.reason).toContain('failed');
  });

  it('drops ungrounded cells and does not merge hallucinated rows (content-neutral)', async () => {
    const base = officialDocWithPageTexts();
    const augmentWithHallucination: typeof augmentOfficialDocWithTableAssist = (
      options
    ) =>
      augmentOfficialDocWithTableAssist({
        ...options,
        deps: {
          ...fakeSplitDeps(),
          extractTableRowsForPage: async ({ pageNumber }) => [
            { pageNumber, cells: ['Fabricated item', '999 widgets'] },
          ],
        },
      });

    const outcome = await dispatchPdfExtraction({
      buffer: pdfBuffer(),
      fileName: 'sample.pdf',
      isFlagEnabled: isFlagEnabledFor([
        'pdf-conversion-subtype-1',
        'pdf-table-assist',
      ]),
      tableAssistMode: 'async',
      configs: [subtype1InjectedConfig],
      augmentTableAssist: augmentWithHallucination,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.documentIr).toEqual(base.documentIr);
    expect(outcome.result.conversion.tableAssist).toEqual(
      expect.objectContaining({
        status: 'skipped',
        rawRowCount: 1,
        rowsMerged: 0,
        rowsRejected: 1,
      })
    );
  });

  it.each([
    ['pdf-conversion-subtype-2', extractSlidePdfFromBufferMock],
    ['pdf-conversion-subtype-3', extractScanPdfFromBufferMock],
  ] as const)(
    'does not run table-assist for %s even when mode is async and pdf-table-assist is on',
    async (subtypeFlag, extractorMock) => {
      const augmentTableAssist = vi.fn();

      const outcome = await dispatchPdfExtraction({
        buffer: pdfBuffer(),
        fileName: 'sample.pdf',
        isFlagEnabled: isFlagEnabledFor([
          subtypeFlag,
          'pdf-table-assist',
        ]),
        tableAssistMode: 'async',
        augmentTableAssist,
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(extractorMock).toHaveBeenCalled();
      expect(augmentTableAssist).not.toHaveBeenCalled();
      expect(outcome.result.conversion.tableAssist).toBeUndefined();
    }
  );

  it('omits tableAssist from conversion when tableAssistMode is omitted (backward compat)', async () => {
    const outcome = await dispatchPdfExtraction({
      buffer: pdfBuffer(),
      fileName: 'sample.pdf',
      isFlagEnabled: async (flagId) => flagId === 'pdf-conversion-subtype-1',
      configs: PDF_SUBTYPE_PRE_FLIGHT_CONFIGS,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result).toEqual(
      expect.objectContaining({
        textContent: 'PDF body text',
        conversion: { converterId: 'pdf-parse' },
      })
    );
    expect(outcome.result.conversion.tableAssist).toBeUndefined();
  });
});

describe('buildPdfCuratorContent', () => {
  it('returns full extracted text when no page-group plan is present', () => {
    expect(
      buildPdfCuratorContent({
        ...minimalPdfExtraction,
        conversion: { converterId: 'pdf-parse' },
      })
    ).toBe('PDF body text');
  });

  it('renders a bounded page-group manifest when a large PDF split plan exists', () => {
    const content = buildPdfCuratorContent({
      ...minimalPdfExtraction,
      textContent: 'FULL PDF BODY',
      preflightReport: {
        fileType: 'pdf',
        pageCount: 51,
        estimatedChars: 200000,
        chunkEstimate: 50,
        recommendedSplitUnit: 'page_group',
        reasons: ['pageCount>50'],
        suggestedPageGroupSize: 25,
      },
      pageGroupPlan: {
        splitUnit: 'page_group',
        pageGroupSize: 25,
        groups: [
          {
            groupIndex: 1,
            startPage: 1,
            endPage: 25,
            pageCount: 25,
            estimatedChars: 120000,
            preview: 'first group preview',
          },
        ],
      },
      conversion: { converterId: 'pdf-parse' },
    });

    expect(content).toContain('PDF preflight page-group manifest');
    expect(content).toContain('### Group 1: pages 1-25');
    expect(content).toContain('first group preview');
    expect(content).not.toContain('FULL PDF BODY');
  });
});

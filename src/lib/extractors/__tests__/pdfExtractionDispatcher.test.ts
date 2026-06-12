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

import {
  buildPdfCuratorContent,
  dispatchPdfExtraction,
  PDF_CONFLICTING_SUBTYPE_FLAGS_MESSAGE,
  PDF_SUBTYPE_PRE_FLIGHT_CONFIGS,
  PDF_UPLOAD_BETA_DISABLED_MESSAGE,
} from '../pdfExtractionDispatcher';

const minimalPdfExtraction = {
  textContent: 'PDF body text',
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

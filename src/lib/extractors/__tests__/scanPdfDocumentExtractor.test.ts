/**
 * Tests for scanPdfDocumentExtractor — Phase 3-H-3 M6 W1.
 *
 * Genkit's `ai.generate` is mocked at the module boundary so no Vertex AI
 * credentials or `GOOGLE_CLOUD_PROJECT` are required for these tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCUMENT_IR_SCHEMA_VERSION } from '../../../eval/conversion/documentIr';

const DEFAULT_MOCK_PAGES = {
  pages: [
    {
      pageNumber: 1,
      blocks: [{ kind: 'paragraph' as const, text: 'default scan text' }],
    },
  ],
  piiFindings: [
    {
      pageNumber: 1,
      category: 'person_name' as const,
      evidenceSnippet: '山田太郎',
      maskability: 'maskable' as const,
      reason: 'full name visible',
    },
  ],
};

let _mockResponse: { output: unknown; text?: string } = {
  output: DEFAULT_MOCK_PAGES,
};
let _mockError: Error | null = null;
let _mockNeverResolve = false;
let _lastAbortSignal: AbortSignal | undefined;

vi.mock('../../../agents/_shared/genkitClient', () => ({
  ai: {
    generate: async (opts?: { abortSignal?: AbortSignal }) => {
      _lastAbortSignal = opts?.abortSignal;
      if (_mockError) throw _mockError;
      if (_mockNeverResolve) {
        return new Promise((_, reject) => {
          const signal = opts?.abortSignal;
          if (!signal) return;
          const onAbort = () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          };
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      return _mockResponse;
    },
  },
  modelRef: () => 'mock-model-ref',
  modelId: 'gemini-test-model',
  location: 'asia-test-1',
}));

import {
  SCAN_PDF_GEMINI_TIMEOUT_MS,
  ScanPdfExtractorError,
  extractScanPdfFromBuffer,
} from '../scanPdfDocumentExtractor';

function setResponse(output: unknown, text?: string): void {
  _mockResponse = { output, text };
  _mockError = null;
  _mockNeverResolve = false;
}

function setError(err: Error): void {
  _mockError = err;
  _mockNeverResolve = false;
}

function setNeverResolve(): void {
  _mockNeverResolve = true;
  _mockError = null;
}

beforeEach(() => {
  _mockResponse = { output: DEFAULT_MOCK_PAGES };
  _mockError = null;
  _mockNeverResolve = false;
  _lastAbortSignal = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

const FAKE_BUFFER = Buffer.from('fake-scan-pdf-bytes');

describe('extractScanPdfFromBuffer — success', () => {
  it('returns schemaVersion / sourceKind=upload / sourceSubtype=scan-pdf', async () => {
    setResponse({
      pages: [
        {
          pageNumber: 1,
          blocks: [{ kind: 'paragraph', text: 'スキャン本文' }],
        },
      ],
      piiFindings: [],
    });
    const { documentIr } = await extractScanPdfFromBuffer({
      buffer: FAKE_BUFFER,
      fileName: 'invoice-scan.pdf',
    });
    expect(documentIr.schemaVersion).toBe(DOCUMENT_IR_SCHEMA_VERSION);
    expect(documentIr.source.sourceKind).toBe('upload');
    expect(documentIr.source.sourceSubtype).toBe('scan-pdf');
    expect(documentIr.source.mediaType).toBe('application/pdf');
    expect(documentIr.source.fileName).toBe('invoice-scan.pdf');
  });

  it('never returns sourceKind="poc" (PoC contamination guard)', async () => {
    const { documentIr } = await extractScanPdfFromBuffer({
      buffer: FAKE_BUFFER,
      fileName: 'scan.pdf',
    });
    expect(documentIr.source.sourceKind).not.toBe('poc');
  });

  it('creates one page per OCR page with locator pageNumber and blockIds p{N}-ocr{seq}', async () => {
    setResponse({
      pages: [
        {
          pageNumber: 2,
          blocks: [
            { kind: 'paragraph', text: 'line one' },
            { kind: 'table', text: 'A\tB' },
          ],
        },
      ],
      piiFindings: [],
    });
    const { documentIr } = await extractScanPdfFromBuffer({
      buffer: FAKE_BUFFER,
      fileName: 'scan.pdf',
    });
    expect(documentIr.pages).toHaveLength(1);
    expect(documentIr.pages[0].pageNumber).toBe(2);
    expect(documentIr.pages[0].blocks.map((b) => b.blockId)).toEqual([
      'p2-ocr1',
      'p2-ocr2',
    ]);
    expect(documentIr.pages[0].blocks[0].locator?.pageNumber).toBe(2);
    expect(documentIr.pages[0].blocks[0].metadata?.extractionProvider).toBe(
      'gemini-vertex-ocr'
    );
  });

  it('joins block text into textContent with "\\n"', async () => {
    setResponse({
      pages: [
        {
          pageNumber: 1,
          blocks: [{ kind: 'paragraph', text: 'page1' }],
        },
        {
          pageNumber: 2,
          blocks: [{ kind: 'paragraph', text: 'page2' }],
        },
      ],
      piiFindings: [],
    });
    const { textContent } = await extractScanPdfFromBuffer({
      buffer: FAKE_BUFFER,
      fileName: 'scan.pdf',
    });
    expect(textContent).toBe('page1\npage2');
  });

  it('returns conversion metadata with converterId, calledVertex, model, region, piiFindings', async () => {
    const piiFindings = [
      {
        pageNumber: 1,
        category: 'phone' as const,
        evidenceSnippet: '03-1234-5678',
        maskability: 'unmaskable' as const,
        reason: 'fragmented digits',
      },
    ];
    setResponse({
      pages: [
        {
          pageNumber: 1,
          blocks: [{ kind: 'paragraph', text: 'x' }],
        },
      ],
      piiFindings,
    });
    const { conversion } = await extractScanPdfFromBuffer({
      buffer: FAKE_BUFFER,
      fileName: 'scan.pdf',
    });
    expect(conversion.converterId).toBe('gemini-vertex-ocr');
    expect(conversion.calledVertex).toBe(true);
    expect(conversion.model).toBe('gemini-test-model');
    expect(conversion.region).toBe('asia-test-1');
    expect(conversion.piiFindings).toEqual(piiFindings);
  });
});

describe('extractScanPdfFromBuffer — schema recovery', () => {
  it('falls back to parsing JSON from response.text when output is invalid', async () => {
    setResponse(
      { not: 'scan schema' },
      JSON.stringify({
        pages: [
          {
            pageNumber: 1,
            blocks: [{ kind: 'paragraph', text: 'from text' }],
          },
        ],
        piiFindings: [],
      })
    );
    const { documentIr } = await extractScanPdfFromBuffer({
      buffer: FAKE_BUFFER,
      fileName: 'scan.pdf',
    });
    expect(documentIr.pages[0].blocks[0].text).toBe('from text');
  });
});

describe('extractScanPdfFromBuffer — error classification', () => {
  it('classifies ai.generate() throws as gemini-call-failed and preserves cause', async () => {
    const cause = new Error('429 quota exceeded');
    setError(cause);
    try {
      await extractScanPdfFromBuffer({ buffer: FAKE_BUFFER, fileName: 'scan.pdf' });
      throw new Error('expected extractor to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ScanPdfExtractorError);
      const err = e as ScanPdfExtractorError;
      expect(err.kind).toBe('gemini-call-failed');
      expect(err.cause).toBe(cause);
    }
  });

  it(`classifies ${SCAN_PDF_GEMINI_TIMEOUT_MS}ms timeout as gemini-call-timeout`, async () => {
    vi.useFakeTimers();
    setNeverResolve();
    const promise = extractScanPdfFromBuffer({
      buffer: FAKE_BUFFER,
      fileName: 'scan.pdf',
    });
    const assertion = expect(promise).rejects.toMatchObject({
      kind: 'gemini-call-timeout',
    });
    await vi.advanceTimersByTimeAsync(SCAN_PDF_GEMINI_TIMEOUT_MS);
    await assertion;
    expect(_lastAbortSignal?.aborted).toBe(true);
  });

  it('classifies missing output AND missing text as gemini-output-empty', async () => {
    setResponse(null, undefined);
    await expect(
      extractScanPdfFromBuffer({ buffer: FAKE_BUFFER, fileName: 'scan.pdf' })
    ).rejects.toMatchObject({ kind: 'gemini-output-empty' });
  });

  it('classifies zero pages as gemini-output-empty (fail-closed)', async () => {
    setResponse({ pages: [], piiFindings: [] });
    await expect(
      extractScanPdfFromBuffer({ buffer: FAKE_BUFFER, fileName: 'scan.pdf' })
    ).rejects.toMatchObject({
      kind: 'gemini-output-empty',
      message: expect.stringContaining('zero pages'),
    });
  });

  it('classifies pages with only whitespace blocks as gemini-output-empty (fail-closed)', async () => {
    setResponse({
      pages: [
        {
          pageNumber: 1,
          blocks: [{ kind: 'paragraph', text: '   ' }],
        },
      ],
      piiFindings: [],
    });
    await expect(
      extractScanPdfFromBuffer({ buffer: FAKE_BUFFER, fileName: 'scan.pdf' })
    ).rejects.toMatchObject({
      kind: 'gemini-output-empty',
      message: expect.stringContaining('no extractable text'),
    });
  });

  it('classifies invalid output without text as gemini-schema-validation-failed', async () => {
    setResponse({ wrong: true });
    await expect(
      extractScanPdfFromBuffer({ buffer: FAKE_BUFFER, fileName: 'scan.pdf' })
    ).rejects.toMatchObject({ kind: 'gemini-schema-validation-failed' });
  });

  it('classifies invalid output and invalid text JSON as gemini-schema-validation-failed', async () => {
    setResponse({ wrong: true }, 'not json');
    await expect(
      extractScanPdfFromBuffer({ buffer: FAKE_BUFFER, fileName: 'scan.pdf' })
    ).rejects.toMatchObject({ kind: 'gemini-schema-validation-failed' });
  });
});

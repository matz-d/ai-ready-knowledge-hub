/**
 * Tests for slidePdfDocumentExtractor — Phase 3-H-3 M1.
 *
 * Genkit's `ai.generate` is mocked at the module boundary so no Vertex AI
 * credentials or `GOOGLE_CLOUD_PROJECT` are required for these tests.
 *
 * Coverage:
 *   - DocumentIr shape (schemaVersion, sourceKind=upload, sourceSubtype=slide-pdf)
 *   - title → heading block with `s{N}-title` blockId and headingLevel=1
 *   - block sequencing `s{N}-b{n}` and empty-text skipping
 *   - locator: both pageNumber and slideNumber set to slide.slideNumber
 *   - metadata: `extractionProvider: 'gemini-direct'` injected on every block
 *   - conversion metadata: converterId / calledVertex / model / region propagated
 *   - error classification: gemini-call-failed / gemini-output-empty /
 *     gemini-schema-validation-failed are distinguishable via `error.kind`
 *   - schema recovery: invalid `output` + valid JSON `text` is parsed successfully
 *   - textContent: concatenation of all block text joined with '\n'
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCUMENT_IR_SCHEMA_VERSION } from '../../../eval/conversion/documentIr';

// ── Genkit mock ────────────────────────────────────────────────────────────────
// vi.mock factories cannot reference outer scope at hoist time, so the mock
// reads module-level mutable state set via setResponse / setError helpers.

const DEFAULT_MOCK_SLIDES = {
  slides: [{ slideNumber: 1, blocks: [{ kind: 'paragraph' as const, text: 'default' }] }],
};

let _mockResponse: { output: unknown; text?: string } = {
  output: DEFAULT_MOCK_SLIDES,
};
let _mockError: Error | null = null;

vi.mock('../../../agents/_shared/genkitClient', () => ({
  ai: {
    generate: async () => {
      if (_mockError) throw _mockError;
      return _mockResponse;
    },
  },
  modelRef: () => 'mock-model-ref',
  modelId: 'gemini-test-model',
  location: 'asia-test-1',
}));

import {
  SlidePdfExtractorError,
  extractSlidePdfFromBuffer,
} from '../slidePdfDocumentExtractor';

function setResponse(output: unknown, text?: string): void {
  _mockResponse = { output, text };
  _mockError = null;
}

function setError(err: Error): void {
  _mockError = err;
}

beforeEach(() => {
  _mockResponse = { output: DEFAULT_MOCK_SLIDES };
  _mockError = null;
});

const FAKE_BUFFER = Buffer.from('fake-pdf-bytes');

// ── Valid output → DocumentIr shape ────────────────────────────────────────────

describe('extractSlidePdfFromBuffer — DocumentIr shape', () => {
  it('returns schemaVersion / sourceKind=upload / sourceSubtype=slide-pdf', async () => {
    setResponse({
      slides: [{ slideNumber: 1, title: 'タイトル', blocks: [] }],
    });
    const { documentIr } = await extractSlidePdfFromBuffer({
      buffer: FAKE_BUFFER,
      fileName: 'deck.pdf',
    });
    expect(documentIr.schemaVersion).toBe(DOCUMENT_IR_SCHEMA_VERSION);
    expect(documentIr.source.sourceKind).toBe('upload');
    expect(documentIr.source.sourceSubtype).toBe('slide-pdf');
    expect(documentIr.source.mediaType).toBe('application/pdf');
    expect(documentIr.source.fileName).toBe('deck.pdf');
  });

  it('never returns sourceKind="poc" (PoC contamination guard)', async () => {
    setResponse({
      slides: [
        { slideNumber: 1, blocks: [{ kind: 'paragraph', text: 'guard' }] },
      ],
    });
    const { documentIr } = await extractSlidePdfFromBuffer({
      buffer: FAKE_BUFFER,
      fileName: 'deck.pdf',
    });
    expect(documentIr.source.sourceKind).not.toBe('poc');
  });

  it('creates one page per slide and preserves slideNumber', async () => {
    setResponse({
      slides: [
        { slideNumber: 1, blocks: [{ kind: 'paragraph', text: 's1' }] },
        { slideNumber: 2, blocks: [{ kind: 'paragraph', text: 's2' }] },
      ],
    });
    const { documentIr } = await extractSlidePdfFromBuffer({
      buffer: FAKE_BUFFER,
      fileName: 'deck.pdf',
    });
    expect(documentIr.pages).toHaveLength(2);
    expect(documentIr.pages[0].pageNumber).toBe(1);
    expect(documentIr.pages[1].pageNumber).toBe(2);
  });
});

// ── Title → heading block ──────────────────────────────────────────────────────

describe('extractSlidePdfFromBuffer — title handling', () => {
  it('emits a heading block with blockId s{N}-title when title is present', async () => {
    setResponse({
      slides: [{ slideNumber: 3, title: '会社概要', blocks: [] }],
    });
    const { documentIr } = await extractSlidePdfFromBuffer({
      buffer: FAKE_BUFFER,
      fileName: 'deck.pdf',
    });
    const block = documentIr.pages[0].blocks[0];
    expect(block.blockId).toBe('s3-title');
    expect(block.kind).toBe('heading');
    expect(block.text).toBe('会社概要');
    expect(block.metadata?.headingLevel).toBe(1);
    expect(block.metadata?.extractionProvider).toBe('gemini-direct');
    expect(block.locator?.pageNumber).toBe(3);
    expect(block.locator?.slideNumber).toBe(3);
  });

  it('omits the title block when title is missing or whitespace-only', async () => {
    setResponse({
      slides: [
        {
          slideNumber: 1,
          title: '   ',
          blocks: [{ kind: 'paragraph', text: 'body on slide 1' }],
        },
        { slideNumber: 2, blocks: [] },
      ],
    });
    const { documentIr } = await extractSlidePdfFromBuffer({
      buffer: FAKE_BUFFER,
      fileName: 'deck.pdf',
    });
    expect(documentIr.pages[0].blocks.map((b) => b.blockId)).toEqual(['s1-b1']);
    expect(documentIr.pages[0].blocks[0].kind).toBe('paragraph');
    expect(documentIr.pages[1].blocks).toHaveLength(0);
  });
});

// ── Block sequencing & metadata ────────────────────────────────────────────────

describe('extractSlidePdfFromBuffer — block sequencing', () => {
  it('assigns deterministic blockIds s{N}-b{seq} and skips empty text', async () => {
    setResponse({
      slides: [
        {
          slideNumber: 1,
          blocks: [
            { kind: 'paragraph', text: '本文1' },
            { kind: 'paragraph', text: '   ' }, // skipped
            { kind: 'table', text: 'A\tB' },
          ],
        },
      ],
    });
    const { documentIr } = await extractSlidePdfFromBuffer({
      buffer: FAKE_BUFFER,
      fileName: 'deck.pdf',
    });
    const ids = documentIr.pages[0].blocks.map((b) => b.blockId);
    expect(ids).toEqual(['s1-b1', 's1-b2']);
    expect(documentIr.pages[0].blocks[0].kind).toBe('paragraph');
    expect(documentIr.pages[0].blocks[1].kind).toBe('table');
  });

  it('injects extractionProvider=gemini-direct into every block metadata', async () => {
    setResponse({
      slides: [
        {
          slideNumber: 1,
          title: 'T',
          blocks: [
            {
              kind: 'paragraph',
              text: '本文',
              metadata: { confidence: 0.9 },
            },
          ],
        },
      ],
    });
    const { documentIr } = await extractSlidePdfFromBuffer({
      buffer: FAKE_BUFFER,
      fileName: 'deck.pdf',
    });
    for (const block of documentIr.pages[0].blocks) {
      expect(block.metadata?.extractionProvider).toBe('gemini-direct');
    }
    const paragraph = documentIr.pages[0].blocks.find(
      (b) => b.kind === 'paragraph'
    );
    expect(paragraph?.metadata?.confidence).toBe(0.9);
  });

  it('sets both pageNumber and slideNumber in locator', async () => {
    setResponse({
      slides: [
        { slideNumber: 7, blocks: [{ kind: 'paragraph', text: 'x' }] },
      ],
    });
    const { documentIr } = await extractSlidePdfFromBuffer({
      buffer: FAKE_BUFFER,
      fileName: 'deck.pdf',
    });
    const block = documentIr.pages[0].blocks[0];
    expect(block.locator?.pageNumber).toBe(7);
    expect(block.locator?.slideNumber).toBe(7);
  });
});

// ── textContent ────────────────────────────────────────────────────────────────

describe('extractSlidePdfFromBuffer — textContent', () => {
  it('joins block text across all slides with "\\n"', async () => {
    setResponse({
      slides: [
        {
          slideNumber: 1,
          title: 'Slide 1',
          blocks: [{ kind: 'paragraph', text: '本文1' }],
        },
        {
          slideNumber: 2,
          blocks: [{ kind: 'paragraph', text: '本文2' }],
        },
      ],
    });
    const { textContent } = await extractSlidePdfFromBuffer({
      buffer: FAKE_BUFFER,
      fileName: 'deck.pdf',
    });
    expect(textContent).toBe('Slide 1\n本文1\n本文2');
  });
});

// ── Conversion metadata (audit handoff) ────────────────────────────────────────

describe('extractSlidePdfFromBuffer — conversion metadata', () => {
  it('returns converterId=gemini-direct-read and calledVertex=true on success', async () => {
    setResponse({
      slides: [{ slideNumber: 1, blocks: [{ kind: 'paragraph', text: 'x' }] }],
    });
    const { conversion } = await extractSlidePdfFromBuffer({
      buffer: FAKE_BUFFER,
      fileName: 'deck.pdf',
    });
    expect(conversion.converterId).toBe('gemini-direct-read');
    expect(conversion.calledVertex).toBe(true);
  });

  it('forwards model/region from genkitClient so the orchestrator can build inferenceDestination', async () => {
    setResponse({
      slides: [{ slideNumber: 1, blocks: [{ kind: 'paragraph', text: 'x' }] }],
    });
    const { conversion } = await extractSlidePdfFromBuffer({
      buffer: FAKE_BUFFER,
      fileName: 'deck.pdf',
    });
    expect(conversion.model).toBe('gemini-test-model');
    expect(conversion.region).toBe('asia-test-1');
  });
});

// ── Schema-recovery (success-via-text) ─────────────────────────────────────────

describe('extractSlidePdfFromBuffer — schema recovery', () => {
  it('falls back to parsing JSON from response.text when output is invalid', async () => {
    setResponse(
      { not: 'a slide schema' },
      JSON.stringify({
        slides: [
          { slideNumber: 1, blocks: [{ kind: 'paragraph', text: 'x' }] },
        ],
      })
    );
    const { documentIr } = await extractSlidePdfFromBuffer({
      buffer: FAKE_BUFFER,
      fileName: 'deck.pdf',
    });
    expect(documentIr.pages).toHaveLength(1);
    expect(documentIr.pages[0].blocks[0].text).toBe('x');
  });

  it('strips ```json``` fences from response.text before parsing', async () => {
    setResponse(
      null,
      '```json\n{"slides":[{"slideNumber":1,"blocks":[{"kind":"paragraph","text":"fenced"}]}]}\n```'
    );
    const { documentIr } = await extractSlidePdfFromBuffer({
      buffer: FAKE_BUFFER,
      fileName: 'deck.pdf',
    });
    expect(documentIr.pages[0].blocks[0].text).toBe('fenced');
  });
});

// ── Error classification (fail-closed) ─────────────────────────────────────────

describe('extractSlidePdfFromBuffer — error classification', () => {
  it('classifies ai.generate() throws as gemini-call-failed and preserves cause', async () => {
    const cause = new Error('429 quota exceeded');
    setError(cause);
    try {
      await extractSlidePdfFromBuffer({
        buffer: FAKE_BUFFER,
        fileName: 'deck.pdf',
      });
      throw new Error('expected extractor to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SlidePdfExtractorError);
      const err = e as SlidePdfExtractorError;
      expect(err.kind).toBe('gemini-call-failed');
      expect(err.message).toContain('429 quota exceeded');
      expect(err.cause).toBe(cause);
    }
  });

  it('classifies missing output AND missing text as gemini-output-empty', async () => {
    setResponse(null, undefined);
    try {
      await extractSlidePdfFromBuffer({
        buffer: FAKE_BUFFER,
        fileName: 'deck.pdf',
      });
      throw new Error('expected extractor to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SlidePdfExtractorError);
      expect((e as SlidePdfExtractorError).kind).toBe('gemini-output-empty');
    }
  });

  it('classifies zero slides as gemini-output-empty (fail-closed)', async () => {
    setResponse({ slides: [] });
    try {
      await extractSlidePdfFromBuffer({
        buffer: FAKE_BUFFER,
        fileName: 'deck.pdf',
      });
      throw new Error('expected extractor to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SlidePdfExtractorError);
      const err = e as SlidePdfExtractorError;
      expect(err.kind).toBe('gemini-output-empty');
      expect(err.message).toContain('zero slides');
    }
  });

  it('classifies slides with no title or block text as gemini-output-empty (fail-closed)', async () => {
    setResponse({
      slides: [
        { slideNumber: 1, title: '   ', blocks: [{ kind: 'paragraph', text: ' ' }] },
        { slideNumber: 2, blocks: [] },
      ],
    });
    try {
      await extractSlidePdfFromBuffer({
        buffer: FAKE_BUFFER,
        fileName: 'deck.pdf',
      });
      throw new Error('expected extractor to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SlidePdfExtractorError);
      const err = e as SlidePdfExtractorError;
      expect(err.kind).toBe('gemini-output-empty');
      expect(err.message).toContain('no extractable text');
    }
  });

  it('classifies output present but invalid AND text absent as schema-validation-failed', async () => {
    setResponse({ wrong: true });
    try {
      await extractSlidePdfFromBuffer({
        buffer: FAKE_BUFFER,
        fileName: 'deck.pdf',
      });
      throw new Error('expected extractor to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SlidePdfExtractorError);
      const err = e as SlidePdfExtractorError;
      expect(err.kind).toBe('gemini-schema-validation-failed');
      expect(err.attempts?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('classifies non-JSON text as schema-validation-failed (does NOT leak JSON.parse error)', async () => {
    setResponse({ wrong: true }, 'not json at all');
    try {
      await extractSlidePdfFromBuffer({
        buffer: FAKE_BUFFER,
        fileName: 'deck.pdf',
      });
      throw new Error('expected extractor to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SlidePdfExtractorError);
      expect((e as SlidePdfExtractorError).kind).toBe(
        'gemini-schema-validation-failed'
      );
    }
  });

  it('classifies output invalid AND text JSON-parses-but-fails-schema as schema-validation-failed', async () => {
    setResponse({ wrong: true }, JSON.stringify({ also: 'wrong' }));
    try {
      await extractSlidePdfFromBuffer({
        buffer: FAKE_BUFFER,
        fileName: 'deck.pdf',
      });
      throw new Error('expected extractor to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SlidePdfExtractorError);
      expect((e as SlidePdfExtractorError).kind).toBe(
        'gemini-schema-validation-failed'
      );
    }
  });
});

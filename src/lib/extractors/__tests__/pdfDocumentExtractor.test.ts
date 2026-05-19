/**
 * Tests for pdfDocumentExtractor — Phase 3-H-2 M1.
 *
 * pdf-parse is mocked via a class-based factory inside vi.mock.
 * Per-test state is controlled via module-level variables that the class
 * delegates to — this avoids the `vi.fn()-as-constructor` issue where
 * arrow function mockImplementations cannot be called with `new`.
 *
 * Coverage:
 *   - DocumentIr shape (schemaVersion, source fields, pages)
 *   - textContent extraction
 *   - Heading detection for all 4 inlined patterns (第N章, 第N節, 1., (1))
 *   - Paragraph fallback (single + multi-line)
 *   - Table row blocks (non-empty cells)
 *   - Empty table row skipping
 *   - destroy() cleanup is called
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCUMENT_IR_SCHEMA_VERSION } from '../../../eval/conversion/documentIr';
import {
  extractPdfFromBuffer,
  type ExtractPdfFromBufferOptions,
} from '../pdfDocumentExtractor';

// ── pdf-parse class mock ───────────────────────────────────────────────────────
//
// We use a plain class (not vi.fn()) inside vi.mock because arrow-function
// mockImplementations cannot be called with `new`.  Per-test behaviour is
// driven by module-level variables read at call time.

type MockPage = { num: number; text: string };
type MockTablePage = {
  num: number;
  tables: Array<Array<Array<string | null>>>;
};

let _mockPages: MockPage[] = [];
let _mockTablePages: MockTablePage[] = [];
let _destroyCallCount = 0;
let _getTextError: Error | null = null;

vi.mock('pdf-parse', () => ({
  PDFParse: class MockPDFParse {
    async getText() {
      if (_getTextError) throw _getTextError;
      return { total: _mockPages.length, pages: _mockPages };
    }
    async getTable() {
      return { pages: _mockTablePages };
    }
    async destroy() {
      _destroyCallCount++;
    }
  },
}));

// ── per-test helpers ───────────────────────────────────────────────────────────

function setMock(
  pages: MockPage[],
  tablePagesRaw: MockTablePage[] = []
): void {
  _mockPages = pages;
  _mockTablePages = tablePagesRaw;
  _destroyCallCount = 0;
  _getTextError = null;
}

function setGetTextError(err: Error): void {
  _getTextError = err;
  _destroyCallCount = 0;
}

beforeEach(() => {
  _mockPages = [];
  _mockTablePages = [];
  _destroyCallCount = 0;
  _getTextError = null;
});

function makeOptions(
  overrides: Partial<ExtractPdfFromBufferOptions> = {}
): ExtractPdfFromBufferOptions {
  return {
    buffer: Buffer.from('fake-pdf'),
    fileName: 'test.pdf',
    ...overrides,
  };
}

// ── DocumentIr shape ───────────────────────────────────────────────────────────

describe('extractPdfFromBuffer — DocumentIr shape', () => {
  it('returns the correct schemaVersion', async () => {
    setMock([{ num: 1, text: 'Hello world.' }]);
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    expect(documentIr.schemaVersion).toBe(DOCUMENT_IR_SCHEMA_VERSION);
  });

  it('sets source.sourceKind to "upload"', async () => {
    setMock([{ num: 1, text: 'Some text.' }]);
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    expect(documentIr.source.sourceKind).toBe('upload');
  });

  it('sets source.mediaType to "application/pdf"', async () => {
    setMock([{ num: 1, text: 'Some text.' }]);
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    expect(documentIr.source.mediaType).toBe('application/pdf');
  });

  it('sets source.fileName from the options', async () => {
    setMock([{ num: 1, text: 'Some text.' }]);
    const { documentIr } = await extractPdfFromBuffer(
      makeOptions({ fileName: 'mhlw-guide.pdf' })
    );
    expect(documentIr.source.fileName).toBe('mhlw-guide.pdf');
  });

  it('defaults sourceSubtype to "official-doc-pdf"', async () => {
    setMock([{ num: 1, text: 'Some text.' }]);
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    expect(documentIr.source.sourceSubtype).toBe('official-doc-pdf');
  });

  it('forwards an explicit sourceSubtype', async () => {
    setMock([{ num: 1, text: 'Some text.' }]);
    const { documentIr } = await extractPdfFromBuffer(
      makeOptions({ sourceSubtype: 'slide-pdf' })
    );
    expect(documentIr.source.sourceSubtype).toBe('slide-pdf');
  });

  it('creates one page per pdf-parse page', async () => {
    setMock([
      { num: 1, text: 'Page one.' },
      { num: 2, text: 'Page two.' },
    ]);
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    expect(documentIr.pages).toHaveLength(2);
    expect(documentIr.pages[0].pageNumber).toBe(1);
    expect(documentIr.pages[1].pageNumber).toBe(2);
  });

  it('returns empty pages array for a zero-page document', async () => {
    setMock([]);
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    expect(documentIr.pages).toHaveLength(0);
  });
});

// ── textContent ────────────────────────────────────────────────────────────────

describe('extractPdfFromBuffer — textContent', () => {
  it('concatenates page texts joined by "\\n"', async () => {
    setMock([
      { num: 1, text: 'Page one.' },
      { num: 2, text: 'Page two.' },
    ]);
    const { textContent } = await extractPdfFromBuffer(makeOptions());
    expect(textContent).toBe('Page one.\nPage two.');
  });

  it('returns an empty string when there are no pages', async () => {
    setMock([]);
    const { textContent } = await extractPdfFromBuffer(makeOptions());
    expect(textContent).toBe('');
  });
});

// ── Heading detection (all 4 patterns) ────────────────────────────────────────

describe('extractPdfFromBuffer — heading detection', () => {
  it('detects 第N章 as heading level 1', async () => {
    setMock([{ num: 1, text: '第1章 背景と目的' }]);
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    const block = documentIr.pages[0].blocks[0];
    expect(block.kind).toBe('heading');
    expect(block.metadata?.headingLevel).toBe(1);
    expect(block.text).toBe('第1章 背景と目的');
  });

  it('detects 第N節 as heading level 2', async () => {
    setMock([{ num: 1, text: '第2節 適用範囲' }]);
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    const block = documentIr.pages[0].blocks[0];
    expect(block.kind).toBe('heading');
    expect(block.metadata?.headingLevel).toBe(2);
  });

  it('detects "1." numeric prefix as heading level 2', async () => {
    setMock([{ num: 1, text: '1. 概要' }]);
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    const block = documentIr.pages[0].blocks[0];
    expect(block.kind).toBe('heading');
    expect(block.metadata?.headingLevel).toBe(2);
  });

  it('detects "(1)" sub-section marker as heading level 3', async () => {
    setMock([{ num: 1, text: '(1) 定義' }]);
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    const block = documentIr.pages[0].blocks[0];
    expect(block.kind).toBe('heading');
    expect(block.metadata?.headingLevel).toBe(3);
  });

  it('treats a long single-line as paragraph even if it starts with 第N章 pattern', async () => {
    // 61+ chars → HEADING_MAX_CHARS exceeded → falls back to paragraph
    const longLine = '第1章 ' + 'あ'.repeat(60);
    setMock([{ num: 1, text: longLine }]);
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    const block = documentIr.pages[0].blocks[0];
    expect(block.kind).toBe('paragraph');
  });
});

// ── Paragraph handling ─────────────────────────────────────────────────────────

describe('extractPdfFromBuffer — paragraph handling', () => {
  it('emits a paragraph block for plain body text', async () => {
    setMock([
      { num: 1, text: 'この規制は労働基準法の改正によって導入された。' },
    ]);
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    const block = documentIr.pages[0].blocks[0];
    expect(block.kind).toBe('paragraph');
    expect(block.text).toBe('この規制は労働基準法の改正によって導入された。');
  });

  it('merges multi-line paragraphs (separated by single newline) into one block', async () => {
    setMock([{ num: 1, text: '行一\n行二\n行三' }]);
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    // single blank-line split → all three lines are one paragraph
    const block = documentIr.pages[0].blocks[0];
    expect(block.kind).toBe('paragraph');
    expect(block.text).toBe('行一 行二 行三');
  });

  it('splits on blank lines into separate blocks', async () => {
    setMock([{ num: 1, text: '第1章 概要\n\n本文テキスト。' }]);
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    expect(documentIr.pages[0].blocks).toHaveLength(2);
    expect(documentIr.pages[0].blocks[0].kind).toBe('heading');
    expect(documentIr.pages[0].blocks[1].kind).toBe('paragraph');
  });

  it('emits no blocks for a page with only whitespace text', async () => {
    setMock([{ num: 1, text: '   \n\n   \n' }]);
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    expect(documentIr.pages[0].blocks).toHaveLength(0);
  });
});

// ── Table blocks ───────────────────────────────────────────────────────────────

describe('extractPdfFromBuffer — table blocks', () => {
  it('emits one table block per non-empty row', async () => {
    setMock(
      [{ num: 1, text: '' }],
      [
        {
          num: 1,
          tables: [[['セル1', 'セル2'], ['セル3', 'セル4']]],
        },
      ]
    );
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    const tableBlocks = documentIr.pages[0].blocks.filter(
      (b) => b.kind === 'table'
    );
    expect(tableBlocks).toHaveLength(2);
  });

  it('skips table rows where all cells are empty', async () => {
    setMock(
      [{ num: 1, text: '' }],
      [
        {
          num: 1,
          tables: [
            [
              ['セル1', 'セル2'],
              ['', ''], // all-empty row → skipped
              ['セル3', null],
            ],
          ],
        },
      ]
    );
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    const tableBlocks = documentIr.pages[0].blocks.filter(
      (b) => b.kind === 'table'
    );
    expect(tableBlocks).toHaveLength(2); // 3 rows - 1 empty = 2
  });

  it('marks the first row as the header row', async () => {
    setMock(
      [{ num: 1, text: '' }],
      [{ num: 1, tables: [[['ヘッダー'], ['データ']]] }]
    );
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    const tableBlocks = documentIr.pages[0].blocks.filter(
      (b) => b.kind === 'table'
    );
    expect(tableBlocks[0].metadata?.isHeaderRow).toBe(true);
    expect(tableBlocks[1].metadata?.isHeaderRow).toBe(false);
  });

  it('places table blocks before prose blocks on the same page', async () => {
    setMock(
      [{ num: 1, text: '本文テキスト。' }],
      [{ num: 1, tables: [[['表のセル']]] }]
    );
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    expect(documentIr.pages[0].blocks[0].kind).toBe('table');
    expect(documentIr.pages[0].blocks[1].kind).toBe('paragraph');
  });

  it('uses tab-separated text for table rows', async () => {
    setMock(
      [{ num: 1, text: '' }],
      [{ num: 1, tables: [[['A', 'B', 'C']]] }]
    );
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    expect(documentIr.pages[0].blocks[0].text).toBe('A\tB\tC');
  });
});

// ── Block IDs and locators ─────────────────────────────────────────────────────

describe('extractPdfFromBuffer — blockId and locator', () => {
  it('assigns deterministic blockIds for prose blocks', async () => {
    setMock([{ num: 1, text: '第1章 概要\n\n本文。' }]);
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    const ids = documentIr.pages[0].blocks.map((b) => b.blockId);
    expect(ids[0]).toBe('p1-b1');
    expect(ids[1]).toBe('p1-b2');
  });

  it('assigns table blockIds with tableIndex and rowIndex', async () => {
    setMock(
      [{ num: 1, text: '' }],
      [{ num: 1, tables: [[['A'], ['B']]] }]
    );
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    const ids = documentIr.pages[0].blocks.map((b) => b.blockId);
    expect(ids[0]).toBe('p1-t0-r0');
    expect(ids[1]).toBe('p1-t0-r1');
  });

  it('sets pageNumber in all block locators', async () => {
    setMock([{ num: 3, text: '本文テキスト。' }]);
    const { documentIr } = await extractPdfFromBuffer(makeOptions());
    const block = documentIr.pages[0].blocks[0];
    expect(block.locator?.pageNumber).toBe(3);
  });
});

// ── Resource cleanup ───────────────────────────────────────────────────────────

describe('extractPdfFromBuffer — cleanup', () => {
  it('calls parser.destroy() even on success', async () => {
    setMock([{ num: 1, text: 'Hello.' }]);
    await extractPdfFromBuffer(makeOptions());
    expect(_destroyCallCount).toBe(1);
  });

  it('calls parser.destroy() when getText throws', async () => {
    setGetTextError(new Error('parse error'));

    await expect(extractPdfFromBuffer(makeOptions())).rejects.toThrow(
      'parse error'
    );
    expect(_destroyCallCount).toBe(1);
  });
});

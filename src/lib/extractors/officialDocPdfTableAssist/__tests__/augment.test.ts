import { describe, expect, it, vi } from 'vitest';
import { parseDocumentIr, type DocumentIr } from '../../../../eval/conversion/documentIr';
import { augmentOfficialDocWithTableAssist } from '../index';
import type { RawTableRow } from '../types';

function doc(): DocumentIr {
  return parseDocumentIr({
    schemaVersion: 1,
    source: {
      fileName: 'x.pdf',
      mediaType: 'application/pdf',
      sourceKind: 'upload',
      sourceSubtype: 'official-doc-pdf',
    },
    pages: [
      {
        pageNumber: 1,
        blocks: [
          {
            blockId: 'p1-b1',
            kind: 'paragraph',
            text: 'Monthly overtime cap 45 hours Manager review',
            locator: { pageNumber: 1 },
          },
        ],
      },
      {
        pageNumber: 2,
        blocks: [
          {
            blockId: 'p2-b1',
            kind: 'paragraph',
            text: 'just prose, no tables here',
            locator: { pageNumber: 2 },
          },
        ],
      },
    ],
  });
}

// Page 1 raw text is table-suspect; page 2 is prose → only page 1 is a candidate.
const PAGE_RAW_TEXTS = new Map<number, string>([
  [1, 'Monthly overtime cap   45 hours   Manager review\nAnnual cap   360 hours   HR'],
  [2, 'just prose, no tables here'],
]);

function fakeSplit() {
  return vi.fn(
    async (args: { buffer: Buffer; pageNumbers: readonly number[] }) =>
      args.pageNumbers.map((pageNumber) => ({
        pageNumber,
        pdfBytes: new Uint8Array(),
      }))
  );
}

describe('augmentOfficialDocWithTableAssist', () => {
  it('is disabled outside the async context and calls no I/O', async () => {
    const splitPages = fakeSplit();
    const extractTableRowsForPage = vi.fn(async () => [] as RawTableRow[]);
    const result = await augmentOfficialDocWithTableAssist({
      mode: 'disabled',
      buffer: Buffer.alloc(0),
      documentIr: doc(),
      pageRawTexts: PAGE_RAW_TEXTS,
      deps: { splitPages, extractTableRowsForPage },
    });
    expect(result.summary.status).toBe('disabled');
    expect(splitPages).not.toHaveBeenCalled();
    expect(extractTableRowsForPage).not.toHaveBeenCalled();
  });

  it('skips when there are no table-suspect pages', async () => {
    const splitPages = fakeSplit();
    const result = await augmentOfficialDocWithTableAssist({
      mode: 'async',
      buffer: Buffer.alloc(0),
      documentIr: doc(),
      pageRawTexts: new Map([
        [1, 'prose only'],
        [2, 'prose only'],
      ]),
      deps: {
        splitPages,
        extractTableRowsForPage: vi.fn(async () => [] as RawTableRow[]),
      },
    });
    expect(result.summary.status).toBe('skipped');
    expect(result.summary.candidatePageCount).toBe(0);
    expect(splitPages).not.toHaveBeenCalled();
  });

  it('merges grounded rows on the happy path', async () => {
    const result = await augmentOfficialDocWithTableAssist({
      mode: 'async',
      buffer: Buffer.alloc(0),
      documentIr: doc(),
      pageRawTexts: PAGE_RAW_TEXTS,
      deps: {
        splitPages: fakeSplit(),
        extractTableRowsForPage: vi.fn(async ({ pageNumber }) => [
          { pageNumber, cells: ['Monthly overtime cap', '45 hours'] },
        ]),
      },
    });
    expect(result.summary).toMatchObject({
      status: 'merged',
      candidatePageCount: 1,
      pagesProcessed: 1,
      pagesFailed: 0,
      rowsMerged: 1,
      rowsRejected: 0,
    });
    const page1 = result.documentIr.pages[0];
    expect(page1.blocks).toHaveLength(2); // original paragraph + 1 merged table row
    expect(page1.blocks[1].metadata).toMatchObject({
      extractionProvider: 'gemini-table-assist',
    });
  });

  it('skips an already table-assist augmented IR without running I/O', async () => {
    const first = await augmentOfficialDocWithTableAssist({
      mode: 'async',
      buffer: Buffer.alloc(0),
      documentIr: doc(),
      pageRawTexts: PAGE_RAW_TEXTS,
      deps: {
        splitPages: fakeSplit(),
        extractTableRowsForPage: vi.fn(async ({ pageNumber }) => [
          { pageNumber, cells: ['Monthly overtime cap', '45 hours'] },
        ]),
      },
    });
    const splitPages = fakeSplit();
    const extractTableRowsForPage = vi.fn(async () => [] as RawTableRow[]);

    const second = await augmentOfficialDocWithTableAssist({
      mode: 'async',
      buffer: Buffer.alloc(0),
      documentIr: first.documentIr,
      pageRawTexts: PAGE_RAW_TEXTS,
      deps: { splitPages, extractTableRowsForPage },
    });

    expect(second.documentIr).toBe(first.documentIr);
    expect(second.summary).toMatchObject({
      status: 'skipped',
      reason: 'document already contains table-assist blocks',
      candidatePageCount: 0,
      rowsMerged: 0,
    });
    expect(splitPages).not.toHaveBeenCalled();
    expect(extractTableRowsForPage).not.toHaveBeenCalled();
  });

  it('rejects ungrounded (hallucinated) rows and skips', async () => {
    const result = await augmentOfficialDocWithTableAssist({
      mode: 'async',
      buffer: Buffer.alloc(0),
      documentIr: doc(),
      pageRawTexts: PAGE_RAW_TEXTS,
      deps: {
        splitPages: fakeSplit(),
        extractTableRowsForPage: vi.fn(async ({ pageNumber }) => [
          { pageNumber, cells: ['Fabricated item', '999 widgets'] },
        ]),
      },
    });
    expect(result.summary.status).toBe('skipped');
    expect(result.summary.rawRowCount).toBe(1);
    expect(result.summary.rowsMerged).toBe(0);
    expect(result.summary.rowsRejected).toBe(1);
    expect(result.documentIr.pages[0].blocks).toHaveLength(1); // unchanged
  });

  it('is fail-soft when a page extraction throws (skips that page)', async () => {
    const result = await augmentOfficialDocWithTableAssist({
      mode: 'async',
      buffer: Buffer.alloc(0),
      documentIr: doc(),
      pageRawTexts: PAGE_RAW_TEXTS,
      deps: {
        splitPages: fakeSplit(),
        extractTableRowsForPage: vi.fn(async () => {
          throw new Error('gemini boom');
        }),
      },
    });
    expect(result.summary.status).toBe('skipped');
    expect(result.summary.pagesFailed).toBe(1);
    expect(result.summary.pagesProcessed).toBe(0);
    expect(result.summary.rowsMerged).toBe(0);
    expect(result.summary.reason).toContain('failed');
  });

  it('is fail-soft when splitting throws (returns the original DocumentIR)', async () => {
    const original = doc();
    const result = await augmentOfficialDocWithTableAssist({
      mode: 'async',
      buffer: Buffer.alloc(0),
      documentIr: original,
      pageRawTexts: PAGE_RAW_TEXTS,
      deps: {
        splitPages: vi.fn(async () => {
          throw new Error('bad pdf');
        }),
        extractTableRowsForPage: vi.fn(async () => [] as RawTableRow[]),
      },
    });
    expect(result.summary.status).toBe('skipped');
    expect(result.summary.reason).toContain('table-assist failed');
    expect(result.documentIr).toBe(original);
  });
});

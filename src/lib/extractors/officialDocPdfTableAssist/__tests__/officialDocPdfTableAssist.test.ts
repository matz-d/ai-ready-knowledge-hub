import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocumentIr, type DocumentIr } from '../../../../eval/conversion/documentIr';
import { buildCandidatePageInputs } from '../index';
import { selectCandidatePages } from '../selectCandidatePages';
import { groundTableRows } from '../groundCells';
import { mergeGroundedRowsIntoDocumentIr } from '../mergeDocumentIr';
import type { CandidatePageInput, RawTableRow } from '../types';

const SUSPECT_TEXT = '契約期間  3年\n賃金  300000円';
const PROSE_TEXT = 'これは説明のための文章であり、表ではありません。';

function page(
  pageNumber: number,
  rawText: string,
  pdfTableRowCount: number
): CandidatePageInput {
  return { pageNumber, rawText, pdfTableRowCount };
}

describe('selectCandidatePages', () => {
  it('returns nothing for empty input or non-positive budget', () => {
    expect(selectCandidatePages({ pages: [] })).toEqual([]);
    expect(
      selectCandidatePages({ pages: [page(1, SUSPECT_TEXT, 0)], pageBudget: 0 })
    ).toEqual([]);
  });

  it('excludes pages that are not table-suspect', () => {
    expect(
      selectCandidatePages({ pages: [page(1, PROSE_TEXT, 0)] })
    ).toEqual([]);
  });

  it('tiers suspect pages: no_pdf_table > sparse_pdf_table > uncaptured_cells', () => {
    const selected = selectCandidatePages({
      pages: [
        page(1, PROSE_TEXT, 0), // not suspect → excluded
        page(2, SUSPECT_TEXT, 0), // no_pdf_table
        page(3, SUSPECT_TEXT, 2), // sparse_pdf_table
        page(4, SUSPECT_TEXT, 50), // uncaptured_cells
      ],
    });
    expect(selected.map((p) => p.pageNumber)).toEqual([2, 3, 4]);
    expect(selected.map((p) => p.tier)).toEqual([
      'no_pdf_table',
      'sparse_pdf_table',
      'uncaptured_cells',
    ]);
  });

  it('caps at the page budget, keeping the highest-priority pages', () => {
    const selected = selectCandidatePages({
      pages: [
        page(2, SUSPECT_TEXT, 50), // uncaptured
        page(3, SUSPECT_TEXT, 0), // no_pdf_table (highest priority)
      ],
      pageBudget: 1,
    });
    expect(selected.map((p) => p.pageNumber)).toEqual([3]);
  });

  it('breaks ties on equal tier+score by page number ascending (deterministic)', () => {
    const selected = selectCandidatePages({
      pages: [page(5, SUSPECT_TEXT, 0), page(2, SUSPECT_TEXT, 0)],
    });
    expect(selected.map((p) => p.pageNumber)).toEqual([2, 5]);
  });

  it('defaults the budget to 6', () => {
    const pages = Array.from({ length: 9 }, (_, i) => page(i + 1, SUSPECT_TEXT, 0));
    expect(selectCandidatePages({ pages })).toHaveLength(6);
  });

  it('keeps MHLW overtime table-assist golden pages 14 and 15 within the default budget', () => {
    const fixture = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'sample-data/document-conversion/official-doc-pdf/mhlw-overtime-limit-guide.document-ir.json'
        ),
        'utf8'
      )
    ) as DocumentIr;
    const pages = buildCandidatePageInputs({
      documentIr: fixture,
      pageRawTexts: new Map(),
    });

    const selected = selectCandidatePages({ pages });
    expect(selected).toHaveLength(6);
    expect(selected.map((p) => p.pageNumber)).toEqual(
      expect.arrayContaining([14, 15])
    );
  });
});

const GROUNDING_DOC: DocumentIr = parseDocumentIr({
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
        {
          blockId: 'p1-b2',
          kind: 'paragraph',
          text: '月 45時間 上限',
          locator: { pageNumber: 1 },
        },
      ],
    },
  ],
});

describe('groundTableRows (cell-level, content-neutral)', () => {
  it('keeps rows whose cells all appear in the same page text', () => {
    const rawRows: RawTableRow[] = [
      { pageNumber: 1, cells: ['Monthly overtime cap', '45 hours'] },
    ];
    expect(groundTableRows({ documentIr: GROUNDING_DOC, rawRows })).toEqual([
      { pageNumber: 1, cells: ['Monthly overtime cap', '45 hours'] },
    ]);
  });

  it('drops a fully hallucinated row', () => {
    const rawRows: RawTableRow[] = [
      { pageNumber: 1, cells: ['Hallucinated', '999 widgets'] },
    ];
    expect(groundTableRows({ documentIr: GROUNDING_DOC, rawRows })).toEqual([]);
  });

  it('drops a row to <2 cells when a cell is ungrounded (removes the injected cell)', () => {
    const rawRows: RawTableRow[] = [
      { pageNumber: 1, cells: ['45 hours', 'Totally made up'] },
    ];
    // '45 hours' grounds but 'Totally made up' does not → only 1 cell survives.
    expect(groundTableRows({ documentIr: GROUNDING_DOC, rawRows })).toEqual([]);
  });

  it('keeps a short label cell when paired with a substantive grounded cell', () => {
    const rawRows: RawTableRow[] = [
      { pageNumber: 1, cells: ['月', '45時間'] },
    ];
    expect(groundTableRows({ documentIr: GROUNDING_DOC, rawRows })).toEqual([
      { pageNumber: 1, cells: ['月', '45時間'] },
    ]);
  });

  it('skips rows for pages absent from the DocumentIR', () => {
    const rawRows: RawTableRow[] = [
      { pageNumber: 9, cells: ['Monthly overtime cap', '45 hours'] },
    ];
    expect(groundTableRows({ documentIr: GROUNDING_DOC, rawRows })).toEqual([]);
  });

  it('does not ground against prior table-assist blocks', () => {
    const augmentedOnlyDoc: DocumentIr = parseDocumentIr({
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
              blockId: 'p1-tableassist-0-r0',
              kind: 'table',
              text: 'Prior assist\tOnly here',
              locator: { pageNumber: 1, tableIndex: 0, rowIndex: 0 },
              metadata: {
                tableAssist: true,
                extractionProvider: 'gemini-table-assist',
              },
            },
          ],
        },
      ],
    });

    expect(
      groundTableRows({
        documentIr: augmentedOnlyDoc,
        rawRows: [{ pageNumber: 1, cells: ['Prior assist', 'Only here'] }],
      })
    ).toEqual([]);
  });
});

describe('buildCandidatePageInputs', () => {
  it('ignores existing table-assist blocks for fallback text and pdf table row counts', () => {
    const augmentedDoc: DocumentIr = parseDocumentIr({
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
              text: 'plain prose',
              locator: { pageNumber: 1 },
            },
            {
              blockId: 'p1-tableassist-0-r0',
              kind: 'table',
              text: 'Injected score\t300円',
              locator: { pageNumber: 1, tableIndex: 0, rowIndex: 0 },
              metadata: {
                tableAssist: true,
                extractionProvider: 'gemini-table-assist',
              },
            },
          ],
        },
      ],
    });

    expect(
      buildCandidatePageInputs({
        documentIr: augmentedDoc,
        pageRawTexts: new Map(),
      })
    ).toEqual([
      {
        pageNumber: 1,
        rawText: 'plain prose',
        pdfTableRowCount: 0,
      },
    ]);
  });
});

describe('mergeGroundedRowsIntoDocumentIr', () => {
  const baseDoc: DocumentIr = parseDocumentIr({
    schemaVersion: 1,
    source: {
      fileName: 'y.pdf',
      mediaType: 'application/pdf',
      sourceKind: 'upload',
      sourceSubtype: 'official-doc-pdf',
    },
    pages: [
      {
        pageNumber: 1,
        blocks: [
          {
            blockId: 'p1-t0-r0',
            kind: 'table',
            text: 'a\tb',
            locator: { pageNumber: 1, tableIndex: 0, rowIndex: 0 },
          },
          {
            blockId: 'p1-b1',
            kind: 'paragraph',
            text: 'prose',
            locator: { pageNumber: 1 },
          },
        ],
      },
      { pageNumber: 2, blocks: [] },
    ],
  });

  it('appends grounded rows as table blocks above the existing tableIndex', () => {
    const { documentIr, stats } = mergeGroundedRowsIntoDocumentIr({
      documentIr: baseDoc,
      groundedRows: [
        { pageNumber: 1, cells: ['月', '45時間'] },
        { pageNumber: 1, cells: ['年', '360時間'] },
      ],
    });

    expect(stats).toEqual({ rowsMerged: 2, pagesAugmented: 1 });

    const page1 = documentIr.pages[0];
    expect(page1.blocks).toHaveLength(4); // 2 original + 2 merged
    // Originals untouched.
    expect(page1.blocks[0].blockId).toBe('p1-t0-r0');
    expect(page1.blocks[1].blockId).toBe('p1-b1');

    const merged = page1.blocks.slice(2);
    expect(merged.map((b) => b.blockId)).toEqual([
      'p1-tableassist-1-r0',
      'p1-tableassist-1-r1',
    ]);
    expect(merged.map((b) => b.text)).toEqual(['月\t45時間', '年\t360時間']);
    expect(merged[0].locator).toEqual({
      pageNumber: 1,
      tableIndex: 1,
      rowIndex: 0,
    });
    expect(merged[0].metadata).toMatchObject({
      extractionProvider: 'gemini-table-assist',
      tableAssist: true,
      columnCount: 2,
    });
    // Stays schema-valid.
    expect(() => parseDocumentIr(documentIr)).not.toThrow();
  });

  it('leaves pages without grounded rows unchanged and skips unknown pages', () => {
    const { documentIr, stats } = mergeGroundedRowsIntoDocumentIr({
      documentIr: baseDoc,
      groundedRows: [{ pageNumber: 99, cells: ['x', 'y'] }],
    });
    expect(stats).toEqual({ rowsMerged: 0, pagesAugmented: 0 });
    expect(documentIr.pages[0].blocks).toHaveLength(2);
    expect(documentIr.pages[1].blocks).toHaveLength(0);
  });

  it('does not append duplicate table-assist rows already present on the page', () => {
    const once = mergeGroundedRowsIntoDocumentIr({
      documentIr: baseDoc,
      groundedRows: [{ pageNumber: 1, cells: ['月', '45時間'] }],
    }).documentIr;

    const twice = mergeGroundedRowsIntoDocumentIr({
      documentIr: once,
      groundedRows: [{ pageNumber: 1, cells: ['月', '45時間'] }],
    });

    expect(twice.stats).toEqual({ rowsMerged: 0, pagesAugmented: 0 });
    expect(twice.documentIr.pages[0].blocks).toHaveLength(3);
  });
});

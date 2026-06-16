import { describe, expect, it } from 'vitest';
import { parseDocumentIr, type DocumentIr } from '../documentIr';
import { mergePdfParseWithGeminiTables } from '../../../../poc/document-conversion/official-doc-pdf/compare/groundGeminiTables';

function baseDocumentIr(pages: DocumentIr['pages']): DocumentIr {
  return parseDocumentIr({
    schemaVersion: 1,
    source: {
      fileName: 'x.pdf',
      mediaType: 'application/pdf',
      sourceKind: 'poc',
      sourceSubtype: 'official-doc-pdf',
    },
    pages,
  });
}

describe('compare harness Gemini table grounding', () => {
  it('rebuilds Gemini rows from grounded cells and drops fabricated cells before merge', () => {
    const pdfParseDocumentIr = baseDocumentIr([
      {
        pageNumber: 1,
        blocks: [
          {
            blockId: 'p1-b1',
            kind: 'paragraph',
            text: 'grounded A grounded B',
            locator: { pageNumber: 1 },
          },
        ],
      },
    ]);
    const geminiTableDocumentIr = baseDocumentIr([
      {
        pageNumber: 1,
        blocks: [
          {
            blockId: 'g1',
            kind: 'table',
            text: 'grounded A\tgrounded B\tfabricated C',
            locator: { pageNumber: 1, tableIndex: 0, rowIndex: 0 },
            metadata: { columnCount: 3 },
          },
        ],
      },
    ]);

    const merged = mergePdfParseWithGeminiTables({
      pdfParseDocumentIr,
      geminiTableDocumentIr,
    });

    expect(merged.grounding).toMatchObject({
      rawTableRows: 1,
      groundedTableRows: 1,
      rejectedTableRows: 0,
    });
    const tableBlocks = merged.documentIr.pages[0].blocks.filter(
      (block) => block.kind === 'table'
    );
    expect(tableBlocks).toHaveLength(1);
    expect(tableBlocks[0].text).toBe('grounded A\tgrounded B');
    expect(tableBlocks[0].text).not.toContain('fabricated C');
    expect(tableBlocks[0].metadata).toMatchObject({ columnCount: 2 });
  });

  it('rejects rows that have fewer than 2 grounded cells after cell filtering', () => {
    const pdfParseDocumentIr = baseDocumentIr([
      {
        pageNumber: 1,
        blocks: [
          {
            blockId: 'p1-b1',
            kind: 'paragraph',
            text: 'grounded A only',
            locator: { pageNumber: 1 },
          },
        ],
      },
    ]);
    const geminiTableDocumentIr = baseDocumentIr([
      {
        pageNumber: 1,
        blocks: [
          {
            blockId: 'g1',
            kind: 'table',
            text: 'grounded A\tfabricated C',
            locator: { pageNumber: 1, tableIndex: 0, rowIndex: 0 },
          },
        ],
      },
    ]);

    const merged = mergePdfParseWithGeminiTables({
      pdfParseDocumentIr,
      geminiTableDocumentIr,
    });

    expect(merged.grounding).toMatchObject({
      rawTableRows: 1,
      groundedTableRows: 0,
      rejectedTableRows: 1,
    });
    expect(
      merged.documentIr.pages[0].blocks.filter((block) => block.kind === 'table')
    ).toEqual([]);
  });
});

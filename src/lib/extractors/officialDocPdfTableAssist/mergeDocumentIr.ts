/**
 * P1-E Step 1 — pure merge of grounded table rows into the DocumentIR.
 *
 * Grounded rows become new `kind: 'table'` blocks appended to their page, with a
 * fresh per-page `tableIndex` (above any existing pdf-parse table index) and
 * `extractionProvider: 'gemini-table-assist'` provenance. The original pdf-parse
 * blocks are left untouched; downstream the chunk adapter emits one chunk per
 * block, so these rows become groundable table chunks with pdf locators.
 */
import type {
  DocumentIr,
  DocumentIrBlock,
} from '../../../eval/conversion/documentIr';
import type { GroundedTableRow, MergeGroundedRowsResult } from './types';
import { isTableAssistBlock } from './tableAssistBlocks';

function maxTableIndexOnPage(blocks: readonly DocumentIrBlock[]): number {
  return blocks.reduce((max, block) => {
    if (block.kind !== 'table') return max;
    const tableIndex = block.locator?.tableIndex;
    return tableIndex === undefined ? max : Math.max(max, tableIndex);
  }, -1);
}

/**
 * Returns a new DocumentIR with grounded rows merged in, plus merge stats.
 * Rows whose `pageNumber` is not present in the DocumentIR are skipped.
 */
export function mergeGroundedRowsIntoDocumentIr(options: {
  documentIr: DocumentIr;
  groundedRows: readonly GroundedTableRow[];
}): MergeGroundedRowsResult {
  const rowsByPage = new Map<number, GroundedTableRow[]>();
  for (const row of options.groundedRows) {
    const existing = rowsByPage.get(row.pageNumber);
    if (existing) {
      existing.push(row);
    } else {
      rowsByPage.set(row.pageNumber, [row]);
    }
  }

  let rowsMerged = 0;
  let pagesAugmented = 0;

  const pages = options.documentIr.pages.map((page) => {
    const rows = rowsByPage.get(page.pageNumber);
    if (rows === undefined || rows.length === 0) return page;

    const existingTableAssistRowText = new Set(
      page.blocks
        .filter((block) => block.kind === 'table' && isTableAssistBlock(block))
        .map((block) => block.text)
    );
    const rowsToMerge = rows.filter(
      (row) => !existingTableAssistRowText.has(row.cells.join('\t'))
    );
    if (rowsToMerge.length === 0) return page;

    const tableIndex = maxTableIndexOnPage(page.blocks) + 1;
    const newBlocks: DocumentIrBlock[] = rowsToMerge.map((row, rowIndex) => ({
      blockId: `p${page.pageNumber}-tableassist-${tableIndex}-r${rowIndex}`,
      kind: 'table',
      text: row.cells.join('\t'),
      locator: {
        pageNumber: page.pageNumber,
        tableIndex,
        rowIndex,
      },
      metadata: {
        columnCount: row.cells.length,
        isHeaderRow: false,
        extractionProvider: 'gemini-table-assist',
        tableAssist: true,
      },
    }));

    rowsMerged += newBlocks.length;
    pagesAugmented += 1;
    return { ...page, blocks: [...page.blocks, ...newBlocks] };
  });

  return {
    documentIr: { ...options.documentIr, pages },
    stats: { rowsMerged, pagesAugmented },
  };
}

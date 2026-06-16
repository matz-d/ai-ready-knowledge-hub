/**
 * P1-E Step 1 — pure cell-level grounding (Decision 2).
 *
 * Content-neutral guarantee: a Gemini-emitted cell is kept only when its
 * normalized text already appears in the *same page's* pdf-parse text. The row
 * is rebuilt from surviving cells and dropped unless at least
 * {@link MIN_GROUNDED_CELLS_PER_ROW} cells survive (with ≥1 substantive cell).
 * Therefore every character table-assist merges was already in pdf-parse output:
 * it adds table structure, never new content, so it introduces no new PII
 * surface and flows through the existing Masker unchanged.
 */
import { groundRowCells } from '../../../eval/conversion/tableCellGrounding';
import type { DocumentIr } from '../../../eval/conversion/documentIr';
import {
  MIN_GROUNDED_CELLS_PER_ROW,
  type GroundedTableRow,
  type RawTableRow,
} from './types';
import { withoutTableAssistBlocks } from './tableAssistBlocks';

function buildPageTextByPage(documentIr: DocumentIr): Map<number, string> {
  const byPage = new Map<number, string>();
  for (const page of documentIr.pages) {
    const pageText = withoutTableAssistBlocks(page.blocks)
      .map((block) => block.text)
      .join('\n');
    byPage.set(page.pageNumber, pageText);
  }
  return byPage;
}

/**
 * Filters raw Gemini table rows down to same-page-grounded rows.
 *
 * @returns one {@link GroundedTableRow} per raw row that keeps ≥
 *   `minGroundedCells` grounded cells including at least one substantive cell.
 */
export function groundTableRows(options: {
  documentIr: DocumentIr;
  rawRows: readonly RawTableRow[];
  minGroundedCells?: number;
}): GroundedTableRow[] {
  const minCells = options.minGroundedCells ?? MIN_GROUNDED_CELLS_PER_ROW;
  const pageTextByPage = buildPageTextByPage(options.documentIr);

  const grounded: GroundedTableRow[] = [];
  for (const row of options.rawRows) {
    const pageText = pageTextByPage.get(row.pageNumber);
    if (pageText === undefined || pageText.length === 0) continue;

    const keptCells = groundRowCells({
      cells: row.cells,
      pageText,
      minGroundedCells: minCells,
    });

    if (keptCells.length > 0) {
      grounded.push({ pageNumber: row.pageNumber, cells: keptCells });
    }
  }

  return grounded;
}

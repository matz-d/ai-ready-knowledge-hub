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
import { normalizeForSubstringMatch } from '../../../eval/conversion/golden';
import type { DocumentIr } from '../../../eval/conversion/documentIr';
import {
  MIN_GROUNDED_CELLS_PER_ROW,
  type GroundedTableRow,
  type RawTableRow,
} from './types';
import { withoutTableAssistBlocks } from './tableAssistBlocks';

/** A cell is "substantive" when its normalized form is at least 2 chars. */
const SUBSTANTIVE_CELL_MIN_CHARS = 2;

function buildNormalizedPageText(documentIr: DocumentIr): Map<number, string> {
  const byPage = new Map<number, string>();
  for (const page of documentIr.pages) {
    const pageText = withoutTableAssistBlocks(page.blocks)
      .map((block) => block.text)
      .join('\n');
    byPage.set(page.pageNumber, normalizeForSubstringMatch(pageText));
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
  const normalizedPageText = buildNormalizedPageText(options.documentIr);

  const grounded: GroundedTableRow[] = [];
  for (const row of options.rawRows) {
    const pageText = normalizedPageText.get(row.pageNumber);
    if (pageText === undefined || pageText.length === 0) continue;

    const keptCells: string[] = [];
    let hasSubstantiveCell = false;
    for (const cell of row.cells) {
      const trimmed = cell.trim();
      if (trimmed.length === 0) continue;
      const normalized = normalizeForSubstringMatch(trimmed);
      if (normalized.length === 0) continue;
      if (!pageText.includes(normalized)) continue;
      keptCells.push(trimmed);
      if (normalized.length >= SUBSTANTIVE_CELL_MIN_CHARS) {
        hasSubstantiveCell = true;
      }
    }

    if (keptCells.length >= minCells && hasSubstantiveCell) {
      grounded.push({ pageNumber: row.pageNumber, cells: keptCells });
    }
  }

  return grounded;
}

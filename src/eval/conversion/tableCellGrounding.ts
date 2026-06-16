/**
 * Shared cell-level grounding for Gemini table-assist (PoC compare + production).
 *
 * A cell is kept only when its normalized text appears in the same page's
 * pdf-parse text. Single-character cells use standalone boundary matching on
 * NFKC page text with whitespace preserved so `月` grounds in `月 45時間` but
 * `時` does not ground inside `45時間`.
 */
import { normalizeForSubstringMatch } from './golden';

export const SUBSTANTIVE_CELL_MIN_CHARS = 2;
export const MIN_GROUNDED_CELLS_PER_ROW = 2;

const CONTINUATION_CHAR = /[\p{L}\p{N}]/u;

function normalizePageTextForCharBoundaryMatch(pageText: string): string {
  return pageText.normalize('NFKC');
}

function isContinuationChar(char: string): boolean {
  return CONTINUATION_CHAR.test(char);
}

/** Whether a 1-char value appears as a standalone token in boundary page text. */
export function isStandaloneCharInNormalizedText(
  boundaryPageText: string,
  normalizedChar: string
): boolean {
  if (normalizedChar.length !== 1) return false;

  const ch = normalizedChar;
  for (let index = 0; index < boundaryPageText.length; index += 1) {
    if (boundaryPageText[index] !== ch) continue;
    const before = index > 0 ? boundaryPageText[index - 1] : '';
    const after =
      index < boundaryPageText.length - 1
        ? boundaryPageText[index + 1]
        : '';
    const beforeOk = before === '' || !isContinuationChar(before);
    const afterOk = after === '' || !isContinuationChar(after);
    if (beforeOk && afterOk) return true;
  }
  return false;
}

export function isNormalizedCellGroundedInPageText(
  normalizedPageText: string,
  normalizedCell: string,
  boundaryPageText?: string
): boolean {
  if (normalizedCell.length === 0) return false;
  if (normalizedCell.length >= SUBSTANTIVE_CELL_MIN_CHARS) {
    return normalizedPageText.includes(normalizedCell);
  }
  const boundaryText =
    boundaryPageText ?? normalizePageTextForCharBoundaryMatch(normalizedPageText);
  return isStandaloneCharInNormalizedText(boundaryText, normalizedCell);
}

export function isCellGroundedInPageText(
  pageText: string,
  cell: string
): boolean {
  const trimmed = cell.trim();
  if (trimmed.length === 0) return false;
  const normalizedPage = normalizeForSubstringMatch(pageText);
  const normalizedCell = normalizeForSubstringMatch(trimmed);
  if (normalizedCell.length >= SUBSTANTIVE_CELL_MIN_CHARS) {
    return normalizedPage.includes(normalizedCell);
  }
  const boundaryPage = normalizePageTextForCharBoundaryMatch(pageText);
  return isStandaloneCharInNormalizedText(boundaryPage, normalizedCell);
}

/**
 * Filters a row's cells down to same-page-grounded survivors.
 * Returns an empty array when fewer than `minGroundedCells` survive or no
 * substantive (≥2 char) cell grounds.
 */
export function groundRowCells(options: {
  cells: readonly string[];
  pageText: string;
  minGroundedCells?: number;
}): string[] {
  const minCells = options.minGroundedCells ?? MIN_GROUNDED_CELLS_PER_ROW;
  if (options.pageText.trim().length === 0) return [];

  const keptCells: string[] = [];
  let hasSubstantiveCell = false;
  for (const cell of options.cells) {
    const trimmed = cell.trim();
    if (trimmed.length === 0) continue;
    const normalized = normalizeForSubstringMatch(trimmed);
    if (normalized.length === 0) continue;
    if (!isCellGroundedInPageText(options.pageText, trimmed)) continue;
    keptCells.push(trimmed);
    if (normalized.length >= SUBSTANTIVE_CELL_MIN_CHARS) {
      hasSubstantiveCell = true;
    }
  }

  if (keptCells.length >= minCells && hasSubstantiveCell) {
    return keptCells;
  }
  return [];
}

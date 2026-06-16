/**
 * P1-E Step 1 — pure page selection for the Gemini table-assist second pass.
 *
 * Decides which (at most `pageBudget`) pages are worth a Gemini table-only call.
 * This is a *ranking/gating* function only: it never changes content, and the
 * downstream cell-level grounding is the correctness backstop, so the heuristic
 * is deliberately simple and tunable (Decision 1).
 */
import {
  DEFAULT_TABLE_ASSIST_PAGE_BUDGET,
  type CandidatePageInput,
  type TableAssistCandidatePage,
  type TableAssistCandidateTier,
} from './types';

/** A page needs at least this many row-like lines to count as "table-suspect". */
export const MIN_ROW_LIKE_LINES = 2;

/** Upper bound on pdf-parse table rows for the `sparse_pdf_table` tier. */
export const SPARSE_PDF_TABLE_MAX = 4;

const TIER_PRIORITY: Record<TableAssistCandidateTier, number> = {
  no_pdf_table: 0,
  sparse_pdf_table: 1,
  uncaptured_cells: 2,
};

// Unit/counter tokens common in tabular official-doc rows (limits, amounts,
// durations). Date-only tokens (年/月/日) are included but never sufficient on
// their own — a line must also carry a digit run or a column gap.
const UNIT_TOKEN = /[¥$€£%％]|円|時間|時|分|秒|日|月|年|週|人|件|名|歳|割|倍|個|回|号|歩|㎡|kg|km/u;
const DIGIT_RUN = /\d[\d,]*(?:\.\d+)?/gu;
// A "column gap": non-space, then 2+ spaces (incl. full-width), then non-space.
const COLUMN_GAP = /\S[\s　]{2,}\S/u;

/**
 * Counts lines that look like table rows. A line qualifies when it has:
 *  - two or more digit runs, OR
 *  - a digit run together with a unit token, OR
 *  - a column gap together with a digit run or unit token.
 */
export function countRowLikeLines(rawText: string): number {
  const lines = rawText.replace(/\r\n?/gu, '\n').split('\n');
  let count = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const digitRuns = trimmed.match(DIGIT_RUN) ?? [];
    const hasUnit = UNIT_TOKEN.test(trimmed);
    const hasColumnGap = COLUMN_GAP.test(line);
    if (digitRuns.length >= 2) {
      count += 1;
    } else if (digitRuns.length >= 1 && hasUnit) {
      count += 1;
    } else if (hasColumnGap && (digitRuns.length >= 1 || hasUnit)) {
      count += 1;
    }
  }
  return count;
}

function classifyTier(
  pdfTableRowCount: number,
  suspectScore: number
): TableAssistCandidateTier | null {
  if (suspectScore < MIN_ROW_LIKE_LINES) return null;
  if (pdfTableRowCount === 0) return 'no_pdf_table';
  if (pdfTableRowCount <= SPARSE_PDF_TABLE_MAX) return 'sparse_pdf_table';
  // v1 approximation of "many candidates but uncaptured cells": a table-heavy
  // page that still shows row-like prose lines. Refinement (compare row-like
  // lines against existing table block cells) is a follow-up.
  return 'uncaptured_cells';
}

/**
 * Selects the pages to send to the Gemini table-only pass, capped at
 * `pageBudget` (default {@link DEFAULT_TABLE_ASSIST_PAGE_BUDGET}). Deterministic:
 * sorted by tier priority, then suspect score (desc), then page number (asc).
 */
export function selectCandidatePages(options: {
  pages: readonly CandidatePageInput[];
  pageBudget?: number;
}): TableAssistCandidatePage[] {
  const budget = options.pageBudget ?? DEFAULT_TABLE_ASSIST_PAGE_BUDGET;
  if (budget <= 0) return [];

  const candidates: TableAssistCandidatePage[] = [];
  for (const page of options.pages) {
    const suspectScore = countRowLikeLines(page.rawText);
    const tier = classifyTier(page.pdfTableRowCount, suspectScore);
    if (tier === null) continue;
    candidates.push({
      pageNumber: page.pageNumber,
      tier,
      suspectScore,
      pdfTableRowCount: page.pdfTableRowCount,
    });
  }

  candidates.sort((a, b) => {
    if (TIER_PRIORITY[a.tier] !== TIER_PRIORITY[b.tier]) {
      return TIER_PRIORITY[a.tier] - TIER_PRIORITY[b.tier];
    }
    if (a.suspectScore !== b.suspectScore) {
      return b.suspectScore - a.suspectScore;
    }
    return a.pageNumber - b.pageNumber;
  });

  return candidates.slice(0, budget);
}

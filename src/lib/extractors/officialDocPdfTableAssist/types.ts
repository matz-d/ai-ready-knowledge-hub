/**
 * P1-E Step 1 — grounded Gemini table-assist for born-digital official-doc-pdf.
 *
 * Shared types for the bounded, fail-soft second pass that adds table structure
 * pdf-parse missed, without adding any new text content (see groundCells:
 * content-neutral guarantee). See docs/p1-e-large-file-pre-splitting.md §6
 * "2026-06-14: P1-E Step 1 design (locked)".
 */
import type { DocumentIr } from '../../../eval/conversion/documentIr';

/** Default per-document page budget for the table-assist second pass (Decision 1). */
export const DEFAULT_TABLE_ASSIST_PAGE_BUDGET = 6;

/** Minimum same-page-grounded cells required to keep a synthesized table row. */
export const MIN_GROUNDED_CELLS_PER_ROW = 2;

/**
 * Execution context gate (Decision 4). The dispatcher must pass `'async'` only
 * from the async worker path; `'disabled'` everywhere else. Combined with the
 * `pdf-table-assist` feature flag this double-gates the second pass so a flag
 * alone can never run it on the synchronous upload path.
 */
export type TableAssistMode = 'disabled' | 'async';

/**
 * Candidate-page priority tier (lower index = higher priority). See Decision 1.
 *  - `no_pdf_table`: pdf-parse found no table grid on a table-suspect page
 *    (e.g. the labor-notice 2-column form). Cleanest, most demo-able win.
 *  - `sparse_pdf_table`: a few pdf-parse table rows on a table-suspect page.
 *  - `uncaptured_cells`: many pdf-parse table rows, but the page still shows
 *    row-like content suggesting cells the grid did not capture.
 */
export type TableAssistCandidateTier =
  | 'no_pdf_table'
  | 'sparse_pdf_table'
  | 'uncaptured_cells';

/** Per-page input to {@link selectCandidatePages} (decoupled from extractor I/O). */
export type CandidatePageInput = {
  pageNumber: number;
  /** Raw pdf-parse page text (line structure preserved — needed for suspect scoring). */
  rawText: string;
  /** Count of pdf-parse `kind: 'table'` blocks already on this page. */
  pdfTableRowCount: number;
};

/** A page selected for the Gemini table-assist second pass. */
export type TableAssistCandidatePage = {
  pageNumber: number;
  tier: TableAssistCandidateTier;
  suspectScore: number;
  pdfTableRowCount: number;
};

/** A raw table row emitted by the Gemini table-only pass, before grounding. */
export type RawTableRow = {
  pageNumber: number;
  cells: string[];
};

/** A table row whose cells all survived same-page pdf-parse grounding. */
export type GroundedTableRow = {
  pageNumber: number;
  cells: string[];
};

export type TableAssistMergeStats = {
  rowsMerged: number;
  pagesAugmented: number;
};

export type MergeGroundedRowsResult = {
  documentIr: DocumentIr;
  stats: TableAssistMergeStats;
};

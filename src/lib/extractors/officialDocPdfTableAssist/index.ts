/**
 * P1-E Step 1 — grounded Gemini table-assist orchestration (fail-soft, bounded).
 *
 * Pipeline: selectCandidatePages → splitPages → extractTables → groundCells →
 * mergeDocumentIr. Double-gated (Decision 4): only runs when `mode === 'async'`
 * (the dispatcher passes that only from the async worker, behind the
 * `pdf-table-assist` flag). Any failure / per-page timeout / empty grounding
 * returns the unchanged pdf-parse DocumentIR plus a `tableAssist` audit summary.
 *
 * See docs/p1-e-large-file-pre-splitting.md §6 "2026-06-14: P1-E Step 1 design".
 */
import type { DocumentIr } from '../../../eval/conversion/documentIr';
import { groundTableRows } from './groundCells';
import { mergeGroundedRowsIntoDocumentIr } from './mergeDocumentIr';
import { selectCandidatePages } from './selectCandidatePages';
import {
  splitPagesToSinglePagePdfs,
  type SplitPageResult,
} from './splitPages';
import { extractTableRowsForPage } from './extractTables';
import {
  DEFAULT_TABLE_ASSIST_PAGE_BUDGET,
  type CandidatePageInput,
  type RawTableRow,
  type TableAssistMode,
} from './types';

export const DEFAULT_TABLE_ASSIST_CONCURRENCY = 4;
export const DEFAULT_TABLE_ASSIST_PER_CALL_TIMEOUT_MS = 45_000;

export type TableAssistStatus = 'disabled' | 'skipped' | 'merged';

/** Audit summary threaded into the conversion audit (metadata only). */
export type TableAssistSummary = {
  status: TableAssistStatus;
  candidatePageCount: number;
  pagesProcessed: number;
  pagesFailed: number;
  rawRowCount: number;
  rowsMerged: number;
  rowsRejected: number;
  reason?: string;
  elapsedMs: number;
};

export type TableAssistOutcome = {
  documentIr: DocumentIr;
  summary: TableAssistSummary;
};

type SplitPagesFn = typeof splitPagesToSinglePagePdfs;
type ExtractTableRowsFn = typeof extractTableRowsForPage;

/** Builds per-page selection inputs from the pdf-parse DocumentIR + raw page text. */
export function buildCandidatePageInputs(options: {
  documentIr: DocumentIr;
  pageRawTexts: ReadonlyMap<number, string>;
}): CandidatePageInput[] {
  return options.documentIr.pages.map((page) => ({
    pageNumber: page.pageNumber,
    rawText:
      options.pageRawTexts.get(page.pageNumber) ??
      page.blocks.map((block) => block.text).join('\n'),
    pdfTableRowCount: page.blocks.filter((block) => block.kind === 'table')
      .length,
  }));
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(concurrency, 1), items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

async function extractWithTimeout(options: {
  extract: ExtractTableRowsFn;
  split: SplitPageResult;
  perCallTimeoutMs: number;
}): Promise<{ ok: boolean; rows: RawTableRow[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.perCallTimeoutMs);
  try {
    const rows = await options.extract({
      pdfBytes: options.split.pdfBytes,
      pageNumber: options.split.pageNumber,
      abortSignal: controller.signal,
    });
    return { ok: true, rows };
  } catch {
    return { ok: false, rows: [] };
  } finally {
    clearTimeout(timer);
  }
}

export async function augmentOfficialDocWithTableAssist(options: {
  mode: TableAssistMode;
  buffer: Buffer;
  documentIr: DocumentIr;
  pageRawTexts: ReadonlyMap<number, string>;
  pageBudget?: number;
  concurrency?: number;
  perCallTimeoutMs?: number;
  deps?: {
    splitPages?: SplitPagesFn;
    extractTableRowsForPage?: ExtractTableRowsFn;
  };
}): Promise<TableAssistOutcome> {
  const startedAt = Date.now();
  const elapsed = (): number => Date.now() - startedAt;

  const baseSummary = {
    candidatePageCount: 0,
    pagesProcessed: 0,
    pagesFailed: 0,
    rawRowCount: 0,
    rowsMerged: 0,
    rowsRejected: 0,
  };

  if (options.mode !== 'async') {
    return {
      documentIr: options.documentIr,
      summary: {
        ...baseSummary,
        status: 'disabled',
        reason: 'table-assist not enabled for this execution context',
        elapsedMs: elapsed(),
      },
    };
  }

  const splitPages = options.deps?.splitPages ?? splitPagesToSinglePagePdfs;
  const extract =
    options.deps?.extractTableRowsForPage ?? extractTableRowsForPage;
  const perCallTimeoutMs =
    options.perCallTimeoutMs ?? DEFAULT_TABLE_ASSIST_PER_CALL_TIMEOUT_MS;
  const concurrency = options.concurrency ?? DEFAULT_TABLE_ASSIST_CONCURRENCY;

  try {
    const candidates = selectCandidatePages({
      pages: buildCandidatePageInputs({
        documentIr: options.documentIr,
        pageRawTexts: options.pageRawTexts,
      }),
      pageBudget: options.pageBudget ?? DEFAULT_TABLE_ASSIST_PAGE_BUDGET,
    });

    if (candidates.length === 0) {
      return {
        documentIr: options.documentIr,
        summary: {
          ...baseSummary,
          status: 'skipped',
          reason: 'no table-suspect pages',
          elapsedMs: elapsed(),
        },
      };
    }

    const split = await splitPages({
      buffer: options.buffer,
      pageNumbers: candidates.map((page) => page.pageNumber),
    });

    const perPage = await mapWithConcurrency(split, concurrency, (s) =>
      extractWithTimeout({ extract, split: s, perCallTimeoutMs })
    );

    const rawRows = perPage.flatMap((result) => result.rows);
    const pagesProcessed = perPage.filter((result) => result.ok).length;
    const pagesFailed = perPage.length - pagesProcessed;

    const grounded = groundTableRows({
      documentIr: options.documentIr,
      rawRows,
    });
    const merged = mergeGroundedRowsIntoDocumentIr({
      documentIr: options.documentIr,
      groundedRows: grounded,
    });

    return {
      documentIr: merged.documentIr,
      summary: {
        status: merged.stats.rowsMerged > 0 ? 'merged' : 'skipped',
        candidatePageCount: candidates.length,
        pagesProcessed,
        pagesFailed,
        rawRowCount: rawRows.length,
        rowsMerged: merged.stats.rowsMerged,
        rowsRejected: rawRows.length - grounded.length,
        ...(pagesFailed > 0
          ? { reason: `${pagesFailed} page(s) failed table-assist` }
          : {}),
        elapsedMs: elapsed(),
      },
    };
  } catch (error) {
    // Fail-soft: never break extraction because of the optional second pass.
    return {
      documentIr: options.documentIr,
      summary: {
        ...baseSummary,
        status: 'skipped',
        reason: `table-assist failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        elapsedMs: elapsed(),
      },
    };
  }
}

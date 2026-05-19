/**
 * pdf-parse v2 wrapper for the official-doc-pdf first-choice runner.
 *
 * Goals (Phase 3-H §5):
 * - Pure local extraction (no Vertex AI).
 * - Preserve page-level locators (always) and table row locators (when pdf-parse
 *   detects table grids from vector operators).
 * - Return a normalised intermediate shape decoupled from pdf-parse's internal
 *   types so the assembler / segmenter stay testable.
 */
import { readFile } from 'node:fs/promises';
import { PDFParse } from 'pdf-parse';

export type ExtractedTableRow = ReadonlyArray<string>;

export type ExtractedTable = {
  /** 0-based index of the table on its page (mirrors `DocumentIrLocator.tableIndex`). */
  tableIndex: number;
  rows: ExtractedTableRow[];
};

export type ExtractedPage = {
  /** 1-based, matches `DocumentIrPage.pageNumber`. */
  pageNumber: number;
  rawText: string;
  tables: ExtractedTable[];
};

export type ExtractedPdf = {
  totalPages: number;
  pages: ExtractedPage[];
};

export type ExtractPdfOptions = {
  /** Path to a local PDF file. */
  inputPath: string;
};

/**
 * Reads a PDF from disk and runs pdf-parse's `getText` + `getTable` passes.
 *
 * The two passes are intentionally separate calls (rather than one combined
 * traversal) because pdf-parse exposes them as independent APIs; the
 * `pageJoiner: ''` option suppresses the default `-- page_number of total --`
 * marker so the raw text we hand to the segmenter is uncontaminated.
 */
export async function extractPdf(
  options: ExtractPdfOptions
): Promise<ExtractedPdf> {
  const buffer = await readFile(options.inputPath);
  // Copy into a freshly-allocated ArrayBuffer. pdfjs-dist transfers the data
  // to its worker via `structuredClone`; a Buffer-backed view over Node's
  // shared pool isn't transferable and throws `DataCloneError`.
  const data = new Uint8Array(buffer.byteLength);
  data.set(buffer);
  const parser = new PDFParse({ data });
  try {
    // Sequential, not Promise.all: pdf-parse's `load()` caches the parsed
    // doc on the instance, but two concurrent first-callers each try to
    // create a fresh pdfjs document and transfer the *same* `data.buffer`,
    // which fails with `DataCloneError`. Awaiting in order primes the cache.
    const textResult = await parser.getText({ pageJoiner: '' });
    const tableResult = await parser.getTable();

    const tablesByPage = new Map<number, ExtractedTable[]>();
    for (const page of tableResult.pages) {
      tablesByPage.set(
        page.num,
        page.tables.map((rows, tableIndex) => ({
          tableIndex,
          rows: rows.map((row) => row.map((cell) => cell ?? '')),
        }))
      );
    }

    const pages: ExtractedPage[] = textResult.pages.map((page) => ({
      pageNumber: page.num,
      rawText: page.text,
      tables: tablesByPage.get(page.num) ?? [],
    }));

    return {
      totalPages: textResult.total,
      pages,
    };
  } finally {
    await parser.destroy();
  }
}

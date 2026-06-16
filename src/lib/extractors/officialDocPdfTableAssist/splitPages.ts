/**
 * P1-E Step 1 — page splitting via pdf-lib (Decision 3: pure JS, no Ghostscript).
 *
 * Produces a single-page PDF per requested page so the Gemini table-only pass is
 * page-scoped and bounded. Page numbers are caller-assigned and authoritative;
 * the model is never trusted to report its own page number.
 */
import { PDFDocument } from 'pdf-lib';

export type SplitPageResult = {
  /** 1-based source page number (authoritative — assigned by the caller). */
  pageNumber: number;
  pdfBytes: Uint8Array;
};

/**
 * Extracts each requested 1-based page into its own single-page PDF.
 * Out-of-range page numbers are skipped. Duplicate page numbers are de-duped.
 */
export async function splitPagesToSinglePagePdfs(options: {
  buffer: Buffer;
  pageNumbers: readonly number[];
}): Promise<SplitPageResult[]> {
  const uniquePageNumbers = [...new Set(options.pageNumbers)].sort(
    (a, b) => a - b
  );
  if (uniquePageNumbers.length === 0) return [];

  const source = await PDFDocument.load(options.buffer, {
    ignoreEncryption: true,
  });
  const pageCount = source.getPageCount();

  const results: SplitPageResult[] = [];
  for (const pageNumber of uniquePageNumbers) {
    if (pageNumber < 1 || pageNumber > pageCount) continue;
    const single = await PDFDocument.create();
    const [copied] = await single.copyPages(source, [pageNumber - 1]);
    single.addPage(copied);
    results.push({ pageNumber, pdfBytes: await single.save() });
  }
  return results;
}

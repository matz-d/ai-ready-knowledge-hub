import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { splitPagesToSinglePagePdfs } from '../splitPages';

const FIXTURE = resolve(
  process.cwd(),
  'sample-data/document-conversion/official-doc-pdf/synthetic-official-doc-table-assist-golden.pdf'
);

function loadFixture(): Buffer {
  return readFileSync(FIXTURE);
}

describe('splitPagesToSinglePagePdfs', () => {
  it('returns an empty array when no pages are requested', async () => {
    expect(
      await splitPagesToSinglePagePdfs({ buffer: loadFixture(), pageNumbers: [] })
    ).toEqual([]);
  });

  it('extracts a real single-page PDF for page 1', async () => {
    const result = await splitPagesToSinglePagePdfs({
      buffer: loadFixture(),
      pageNumbers: [1],
    });
    expect(result).toHaveLength(1);
    expect(result[0].pageNumber).toBe(1);
    // Valid PDF header.
    expect(Buffer.from(result[0].pdfBytes.slice(0, 5)).toString()).toBe('%PDF-');
    // Re-loadable, and contains exactly one page.
    const reloaded = await PDFDocument.load(result[0].pdfBytes);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it('skips out-of-range and de-dupes page numbers', async () => {
    const result = await splitPagesToSinglePagePdfs({
      buffer: loadFixture(),
      pageNumbers: [1, 1, 9999],
    });
    expect(result.map((r) => r.pageNumber)).toEqual([1]);
  });
});

/**
 * Assembles a {@link DocumentIr} from the pdf-parse extractor output.
 *
 * Block ordering per page (Phase 3-H §5):
 *   1. Tables (each cell-row → one `table` block) — placed first because
 *      `pdf-parse.getText` may *also* emit the table's text as prose; downstream
 *      chunkers can dedup on locator.
 *   2. Paragraph / heading blocks from `segmentPageText`.
 *
 * Locator policy:
 *   - Tables: { pageNumber, tableIndex, rowIndex } — the adapter
 *     `buildPdfParagraphId` already converts this to `table-{i}-row-{j}`.
 *   - Paragraph/heading: { pageNumber } only (no bbox available from the
 *     plain-text pass).
 *
 * Block IDs are deterministic (`p{page}-{kind}-{seq}`) so re-running the
 * extractor on the same PDF produces stable artifacts.
 */
import type {
  DocumentIr,
  DocumentIrBlock,
  DocumentIrPage,
} from '../../shared/documentIr';
import { DOCUMENT_IR_SCHEMA_VERSION } from '../../shared/documentIr';
import type { ExtractedPdf } from './pdfParseExtractor';
import { segmentPageText } from './segmentPageText';

const SUBTYPE = 'official-doc-pdf' as const;

export type BuildDocumentIrOptions = {
  fileName: string;
  extracted: ExtractedPdf;
};

export function buildDocumentIr(options: BuildDocumentIrOptions): DocumentIr {
  const pages: DocumentIrPage[] = options.extracted.pages.map((page) => {
    const blocks: DocumentIrBlock[] = [];
    let blockSeq = 0;

    for (const table of page.tables) {
      for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
        const row = table.rows[rowIndex];
        const trimmedCells = row.map((cell) => cell.trim());
        // pdf-parse's grid detection sometimes finds layout rectangles whose
        // cells are empty; skip those so they don't pollute the chunk health
        // check with hundreds of `\t\t`-only "empty chunks".
        if (trimmedCells.every((cell) => cell.length === 0)) continue;
        const text = trimmedCells.join('\t');
        blockSeq += 1;
        blocks.push({
          blockId: `p${page.pageNumber}-t${table.tableIndex}-r${rowIndex}`,
          kind: 'table',
          text,
          locator: {
            pageNumber: page.pageNumber,
            tableIndex: table.tableIndex,
            rowIndex,
          },
          metadata: {
            columnCount: row.length,
            isHeaderRow: rowIndex === 0,
          },
        });
      }
    }

    for (const segment of segmentPageText(page.rawText)) {
      blockSeq += 1;
      const block: DocumentIrBlock = {
        blockId: `p${page.pageNumber}-b${blockSeq}`,
        kind: segment.kind,
        text: segment.text,
        locator: { pageNumber: page.pageNumber },
      };
      if (segment.kind === 'heading' && segment.headingLevel !== undefined) {
        block.metadata = { headingLevel: segment.headingLevel };
      }
      blocks.push(block);
    }

    return { pageNumber: page.pageNumber, blocks };
  });

  return {
    schemaVersion: DOCUMENT_IR_SCHEMA_VERSION,
    source: {
      fileName: options.fileName,
      mediaType: 'application/pdf',
      sourceKind: 'poc',
      sourceSubtype: SUBTYPE,
    },
    pages,
  };
}

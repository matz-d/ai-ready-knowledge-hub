import type {
  DocumentIr,
  DocumentIrBlock,
  DocumentIrPage,
} from '../../shared/documentIr';
import { DOCUMENT_IR_SCHEMA_VERSION } from '../../shared/documentIr';
import type { ExtractedPdf } from '../../official-doc-pdf/extract/pdfParseExtractor';
import { segmentPageText } from '../../official-doc-pdf/extract/segmentPageText';
import type { GeminiSlidePdfOutput } from './geminiDirectExtractor';

const SUBTYPE = 'slide-pdf' as const;

export type BuildGeminiDocumentIrOptions = {
  fileName: string;
  extracted: GeminiSlidePdfOutput;
};

export type BuildPdfParseDocumentIrOptions = {
  fileName: string;
  extracted: ExtractedPdf;
};

export function buildDocumentIrFromGemini(
  options: BuildGeminiDocumentIrOptions
): DocumentIr {
  const pages: DocumentIrPage[] = options.extracted.slides.map((slide) => {
    const blocks: DocumentIrBlock[] = [];
    let blockSeq = 0;

    if (slide.title?.trim()) {
      blocks.push({
        blockId: `s${slide.slideNumber}-title`,
        kind: 'heading',
        text: slide.title.trim(),
        locator: {
          pageNumber: slide.slideNumber,
          slideNumber: slide.slideNumber,
        },
        metadata: { headingLevel: 1, extractionProvider: 'gemini-direct' },
      });
    }

    for (const block of slide.blocks) {
      const text = block.text.trim();
      if (!text) continue;
      blockSeq += 1;
      blocks.push({
        blockId: `s${slide.slideNumber}-b${blockSeq}`,
        kind: block.kind,
        text,
        locator: {
          pageNumber: slide.slideNumber,
          slideNumber: slide.slideNumber,
        },
        metadata: {
          ...block.metadata,
          extractionProvider: 'gemini-direct',
        },
      });
    }

    return { pageNumber: slide.slideNumber, blocks };
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

export function buildDocumentIrFromPdfParse(
  options: BuildPdfParseDocumentIrOptions
): DocumentIr {
  const pages: DocumentIrPage[] = options.extracted.pages.map((page) => {
    const blocks: DocumentIrBlock[] = [];
    let blockSeq = 0;

    for (const table of page.tables) {
      for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
        const row = table.rows[rowIndex];
        const trimmedCells = row.map((cell) => cell.trim());
        if (trimmedCells.every((cell) => cell.length === 0)) continue;
        blocks.push({
          blockId: `s${page.pageNumber}-t${table.tableIndex}-r${rowIndex}`,
          kind: 'table',
          text: trimmedCells.join('\t'),
          locator: {
            pageNumber: page.pageNumber,
            slideNumber: page.pageNumber,
            tableIndex: table.tableIndex,
            rowIndex,
          },
          metadata: {
            columnCount: row.length,
            isHeaderRow: rowIndex === 0,
            extractionProvider: 'pdf-parse-fallback',
          },
        });
      }
    }

    for (const segment of segmentPageText(page.rawText)) {
      blockSeq += 1;
      const block: DocumentIrBlock = {
        blockId: `s${page.pageNumber}-b${blockSeq}`,
        kind: segment.kind,
        text: segment.text,
        locator: {
          pageNumber: page.pageNumber,
          slideNumber: page.pageNumber,
        },
        metadata: { extractionProvider: 'pdf-parse-fallback' },
      };
      if (segment.kind === 'heading' && segment.headingLevel !== undefined) {
        block.metadata = {
          ...block.metadata,
          headingLevel: segment.headingLevel,
        };
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

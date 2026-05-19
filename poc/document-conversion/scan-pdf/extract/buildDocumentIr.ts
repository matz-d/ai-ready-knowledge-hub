import type {
  DocumentIr,
  DocumentIrBlock,
  DocumentIrPage,
} from '../../shared/documentIr';
import { DOCUMENT_IR_SCHEMA_VERSION } from '../../shared/documentIr';
import type { GeminiScanPdfOutput } from './geminiOcrExtractor';

const SUBTYPE = 'scan-pdf' as const;

function toBboxTuple(
  bbox: number[] | undefined
): [number, number, number, number] | undefined {
  if (!bbox) return undefined;
  return [bbox[0] ?? 0, bbox[1] ?? 0, bbox[2] ?? 0, bbox[3] ?? 0];
}

export type BuildScanPdfDocumentIrOptions = {
  fileName: string;
  extracted: GeminiScanPdfOutput;
};

export function buildDocumentIrFromGeminiOcr(
  options: BuildScanPdfDocumentIrOptions
): DocumentIr {
  const pages: DocumentIrPage[] = options.extracted.pages.map((page) => {
    const blocks: DocumentIrBlock[] = [];
    let blockSeq = 0;

    for (const block of page.blocks) {
      const text = block.text.trim();
      if (!text) continue;
      blockSeq += 1;
      blocks.push({
        blockId: `p${page.pageNumber}-ocr${blockSeq}`,
        kind: block.kind,
        text,
        locator: {
          pageNumber: page.pageNumber,
          bbox: toBboxTuple(block.bbox),
        },
        metadata: {
          ...block.metadata,
          extractionProvider: 'gemini-vertex-ocr',
          ocrConfidence: block.confidence,
        },
      });
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

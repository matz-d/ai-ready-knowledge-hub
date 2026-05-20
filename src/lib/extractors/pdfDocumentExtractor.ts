/**
 * Mainline PDF extractor — Phase 3-H-2 M1.
 *
 * Wraps pdf-parse v2 and produces a validated {@link DocumentIr} without any
 * external network calls, suitable for the Cloud Run upload path.
 *
 * Key design decisions:
 *   - `segmentPageText` is inlined (cannot import from `poc/` — one-way boundary).
 *   - `new Uint8Array(buffer.byteLength)` copy prevents DataCloneError when
 *     pdf-parse transfers data to its pdfjs worker via structuredClone.
 *   - Tables are placed before prose per page so downstream chunkers can dedup
 *     text that pdf-parse emits both as grid cells and as raw prose.
 *   - `sourceKind: 'upload'` is hardcoded — this extractor is only for uploaded files.
 */
import {
  DOCUMENT_IR_SCHEMA_VERSION,
  type DocumentIr,
  type DocumentIrBlock,
  type DocumentSourceSubtype,
} from '../../eval/conversion/documentIr';

// ── Inlined segmentPageText ────────────────────────────────────────────────────
// Source: poc/document-conversion/official-doc-pdf/extract/segmentPageText.ts
// Cannot import from poc/ — one-way dependency boundary.

type SegmentedTextBlock = {
  kind: 'paragraph' | 'heading';
  text: string;
  headingLevel?: number;
};

const HEADING_PREFIX_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  level: number;
}> = [
  // 第1章 / 第 1 章 / 第１章 etc.
  { pattern: /^第\s*[0-9０-９一二三四五六七八九十]+\s*章/u, level: 1 },
  // 第1節
  { pattern: /^第\s*[0-9０-９一二三四五六七八九十]+\s*節/u, level: 2 },
  // "1." / "1．" / "1、" at line start (top-level numbered headings).
  { pattern: /^[0-9０-９]+\s*[.．、]\s*\S/u, level: 2 },
  // "(1)" / "（1）" — sub-section markers.
  { pattern: /^[（(]\s*[0-9０-９]+\s*[)）]/u, level: 3 },
];

const HEADING_MAX_CHARS = 60;

async function ensurePdfCanvasPolyfills(): Promise<void> {
  const canvas = await import('@napi-rs/canvas');
  const target = globalThis as Record<string, unknown>;
  target.DOMMatrix ??= canvas.DOMMatrix;
  target.ImageData ??= canvas.ImageData;
  target.Path2D ??= canvas.Path2D;
}

function classifyLine(line: string): SegmentedTextBlock | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > HEADING_MAX_CHARS) {
    return { kind: 'paragraph', text: trimmed };
  }
  for (const { pattern, level } of HEADING_PREFIX_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { kind: 'heading', text: trimmed, headingLevel: level };
    }
  }
  return null;
}

function segmentPageText(rawText: string): SegmentedTextBlock[] {
  //   = non-breaking space (common in PDF text extraction)
  const normalised = rawText.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  const paragraphs = normalised
    .split(/\n{2,}/u)
    .map((chunk) => chunk.replace(/[ \t]+\n/g, '\n').trim())
    .filter((chunk) => chunk.length > 0);

  const blocks: SegmentedTextBlock[] = [];
  for (const para of paragraphs) {
    const lines = para
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    if (lines.length === 1) {
      const heading = classifyLine(lines[0]);
      if (heading && heading.kind === 'heading') {
        blocks.push(heading);
        continue;
      }
      blocks.push({ kind: 'paragraph', text: lines[0] });
      continue;
    }

    blocks.push({ kind: 'paragraph', text: lines.join(' ') });
  }

  return blocks;
}

// ── Public types / API ─────────────────────────────────────────────────────────

export type ExtractPdfFromBufferOptions = {
  buffer: Buffer;
  fileName: string;
  /**
   * PDF subtype classification.
   * Defaults to `'official-doc-pdf'` for uploaded files in M1.
   */
  sourceSubtype?: DocumentSourceSubtype;
};

export type ExtractPdfFromBufferResult = {
  documentIr: DocumentIr;
  /**
   * Concatenation of all page text (joined with '\n').
   * Used as `extractorInput` for KnowledgeChunk source-hash computation.
   */
  textContent: string;
};

/**
 * Extracts a {@link DocumentIr} from a PDF buffer.
 *
 * Block ordering per page:
 *   1. Table row blocks (pdf-parse grid detection).
 *   2. Paragraph / heading blocks from `segmentPageText`.
 *
 * @throws if pdf-parse fails to parse the buffer (bad PDF, encrypted, etc.)
 */
export async function extractPdfFromBuffer(
  options: ExtractPdfFromBufferOptions
): Promise<ExtractPdfFromBufferResult> {
  const { buffer, fileName, sourceSubtype = 'official-doc-pdf' } = options;
  await ensurePdfCanvasPolyfills();
  const { PDFParse } = await import('pdf-parse');

  // Copy into a fresh ArrayBuffer to avoid DataCloneError.
  // pdf-parse's pdfjs worker uses structuredClone to transfer data;
  // a Buffer-backed view over Node's shared pool is not transferable.
  const data = new Uint8Array(buffer.byteLength);
  data.set(buffer);
  const parser = new PDFParse({ data });

  try {
    // Sequential — not Promise.all — to avoid DataCloneError on concurrent
    // first-callers both trying to transfer the same data.buffer.
    const textResult = await parser.getText({ pageJoiner: '' });
    const tableResult = await parser.getTable();

    // Build page-number → tables index for O(1) lookup.
    const tablesByPage = new Map<
      number,
      Array<{ tableIndex: number; rows: string[][] }>
    >();
    for (const page of tableResult.pages as Array<{
      num: number;
      tables: Array<Array<Array<string | null>>>;
    }>) {
      tablesByPage.set(
        page.num,
        page.tables.map(
          (rows: Array<Array<string | null>>, tableIndex: number) => ({
            tableIndex,
            rows: rows.map((row: Array<string | null>) =>
              row.map((cell) => cell ?? '')
            ),
          })
        )
      );
    }

    const pageTexts: string[] = [];

    const irPages = (
      textResult.pages as Array<{ num: number; text: string }>
    ).map((page) => {
      const blocks: DocumentIrBlock[] = [];
      let blockSeq = 0;

      // 1. Table blocks — placed first so downstream dedup can match prose.
      const tables = tablesByPage.get(page.num) ?? [];
      for (const table of tables) {
        for (
          let rowIndex = 0;
          rowIndex < table.rows.length;
          rowIndex += 1
        ) {
          const row = table.rows[rowIndex];
          const trimmedCells = row.map((cell) => cell.trim());
          // Skip layout rectangles whose cells are all empty.
          if (trimmedCells.every((cell) => cell.length === 0)) continue;
          const text = trimmedCells.join('\t');
          blockSeq += 1;
          blocks.push({
            blockId: `p${page.num}-t${table.tableIndex}-r${rowIndex}`,
            kind: 'table',
            text,
            locator: {
              pageNumber: page.num,
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

      // 2. Paragraph / heading blocks.
      for (const segment of segmentPageText(page.text)) {
        blockSeq += 1;
        const block: DocumentIrBlock = {
          blockId: `p${page.num}-b${blockSeq}`,
          kind: segment.kind,
          text: segment.text,
          locator: { pageNumber: page.num },
        };
        if (segment.kind === 'heading' && segment.headingLevel !== undefined) {
          block.metadata = { headingLevel: segment.headingLevel };
        }
        blocks.push(block);
      }

      pageTexts.push(page.text);
      return { pageNumber: page.num, blocks };
    });

    const documentIr: DocumentIr = {
      schemaVersion: DOCUMENT_IR_SCHEMA_VERSION,
      source: {
        fileName,
        mediaType: 'application/pdf',
        sourceKind: 'upload',
        sourceSubtype,
      },
      pages: irPages,
    };

    return {
      documentIr,
      textContent: pageTexts.join('\n'),
    };
  } finally {
    await parser.destroy();
  }
}

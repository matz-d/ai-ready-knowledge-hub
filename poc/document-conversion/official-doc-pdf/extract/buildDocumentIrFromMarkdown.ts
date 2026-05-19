/**
 * Maps MarkItDown markdown into the same {@link DocumentIr} shape used by pdf-parse.
 *
 * MarkItDown does not emit reliable page boundaries for official PDFs, so content
 * lands on page 1 unless a form-feed (`\f`) separator is present.
 */
import type {
  DocumentIr,
  DocumentIrBlock,
  DocumentIrPage,
} from '../../shared/documentIr';
import { DOCUMENT_IR_SCHEMA_VERSION } from '../../shared/documentIr';
import { segmentPageText } from './segmentPageText';

const SUBTYPE = 'official-doc-pdf' as const;

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.includes('|', 1);
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return false;
  return /^\|[\s\-:|]+\|?\s*$/u.test(trimmed);
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/u, '').replace(/\|$/u, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function parseMarkdownTable(
  lines: string[],
  startIndex: number
): { rows: string[][]; nextIndex: number } {
  const rows: string[][] = [];
  let i = startIndex;
  while (i < lines.length && isTableRow(lines[i])) {
    if (!isTableSeparator(lines[i])) {
      rows.push(parseTableRow(lines[i]));
    }
    i += 1;
  }
  return { rows, nextIndex: i };
}

function tableRowsToBlocks(
  rows: string[][],
  pageNumber: number,
  tableIndex: number,
  blockSeqStart: number
): { blocks: DocumentIrBlock[]; nextSeq: number } {
  const blocks: DocumentIrBlock[] = [];
  let blockSeq = blockSeqStart;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const trimmedCells = rows[rowIndex].map((cell) => cell.trim());
    if (trimmedCells.every((cell) => cell.length === 0)) continue;
    const text = trimmedCells.join('\t');
    blockSeq += 1;
    blocks.push({
      blockId: `p${pageNumber}-t${tableIndex}-r${rowIndex}`,
      kind: 'table',
      text,
      locator: {
        pageNumber,
        tableIndex,
        rowIndex,
      },
      metadata: {
        columnCount: rows[rowIndex].length,
        isHeaderRow: rowIndex === 0,
        converter: 'markitdown',
      },
    });
  }

  return { blocks, nextSeq: blockSeq };
}

function parseAtxHeading(line: string): Omit<DocumentIrBlock, 'blockId'> | null {
  const match = /^(#{1,6})\s+(.+)$/u.exec(line.trim());
  if (!match) return null;
  const level = Math.min(match[1].length, 6);
  const text = match[2].trim();
  if (text.length === 0) return null;
  return {
    kind: 'heading',
    text,
    locator: { pageNumber: 1 },
    metadata: { headingLevel: level, converter: 'markitdown' },
  };
}

function parseMarkdownPage(
  pageMarkdown: string,
  pageNumber: number
): DocumentIrPage {
  const lines = pageMarkdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: DocumentIrBlock[] = [];
  let blockSeq = 0;
  let tableIndex = 0;
  const proseChunks: string[] = [];

  const flushProse = (): void => {
    if (proseChunks.length === 0) return;
    const rawText = proseChunks.join('\n\n');
    proseChunks.length = 0;
    for (const segment of segmentPageText(rawText)) {
      blockSeq += 1;
      const block: DocumentIrBlock = {
        blockId: `p${pageNumber}-b${blockSeq}`,
        kind: segment.kind,
        text: segment.text,
        locator: { pageNumber },
        metadata: { converter: 'markitdown' },
      };
      if (segment.kind === 'heading' && segment.headingLevel !== undefined) {
        block.metadata = {
          ...block.metadata,
          headingLevel: segment.headingLevel,
        };
      }
      blocks.push(block);
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      flushProse();
      i += 1;
      continue;
    }

    const atx = parseAtxHeading(line);
    if (atx) {
      flushProse();
      blockSeq += 1;
      blocks.push({
        ...atx,
        blockId: `p${pageNumber}-b${blockSeq}`,
        locator: { pageNumber },
      });
      i += 1;
      continue;
    }

    if (isTableRow(line)) {
      flushProse();
      const { rows, nextIndex } = parseMarkdownTable(lines, i);
      if (rows.length > 0) {
        const { blocks: tableBlocks, nextSeq } = tableRowsToBlocks(
          rows,
          pageNumber,
          tableIndex,
          blockSeq
        );
        blocks.push(...tableBlocks);
        blockSeq = nextSeq;
        tableIndex += 1;
      }
      i = nextIndex;
      continue;
    }

    proseChunks.push(trimmed);
    i += 1;
  }

  flushProse();
  return { pageNumber, blocks };
}

export type BuildDocumentIrFromMarkdownOptions = {
  fileName: string;
  markdown: string;
};

export function buildDocumentIrFromMarkdown(
  options: BuildDocumentIrFromMarkdownOptions
): DocumentIr {
  const pageTexts = options.markdown.includes('\f')
    ? options.markdown.split('\f')
    : [options.markdown];

  const pages: DocumentIrPage[] = pageTexts
    .map((text, index) => parseMarkdownPage(text, index + 1))
    .filter((page) => page.blocks.length > 0);

  if (pages.length === 0) {
    pages.push({ pageNumber: 1, blocks: [] });
  }

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

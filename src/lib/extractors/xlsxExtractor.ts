import * as XLSX from 'xlsx';
import type { AiUsePolicy, Sensitivity } from '../../agents/curator/schema';
import {
  DEFAULT_COLUMN_SENSITIVITY_RULES,
  upgradeChunkSensitivityFromColumnHeader,
} from '../columnSensitivityRules';
import {
  computeChunkSourceHash,
  KNOWLEDGE_CHUNK_SCHEMA_VERSION,
  type KnowledgeChunk,
} from '../knowledgeChunkSchema';

export type XlsxExtractionResult = {
  /** Curator/masker input: normalized markdown table for the whole document. */
  normalizedMarkdown: string;
  chunks: KnowledgeChunk[];
};

const CHUNK_WARNING_THRESHOLD = 200;

function normalizeCellForMarkdown(cell: string): string {
  return cell
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, ' ')
    .replace(/\|/g, '\uFF5C');
}

function rowsToMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) {
    return '';
  }

  const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (colCount === 0) {
    return '';
  }

  const padRow = (row: string[]): string[] => {
    const next = [...row];
    while (next.length < colCount) {
      next.push('');
    }
    return next.slice(0, colCount);
  };

  const formatRow = (cells: string[]): string =>
    `| ${cells.map(normalizeCellForMarkdown).join(' | ')} |`;

  const normalizedRows = rows.map(padRow);
  const header = formatRow(normalizedRows[0]);
  const separator = `| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`;
  const body = normalizedRows.slice(1).map(formatRow);

  return [header, separator, ...body].join('\n');
}

function toBuffer(content: Buffer | Uint8Array): Buffer {
  if (Buffer.isBuffer(content)) {
    return content;
  }
  return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
}

function normalizedUsedRangeA1(worksheet: XLSX.WorkSheet): string {
  const ref = worksheet['!ref'];
  if (typeof ref !== 'string' || ref.trim() === '') {
    return 'A1:A1';
  }
  const decoded = XLSX.utils.decode_range(ref);
  return XLSX.utils.encode_range(decoded);
}

function rowsFromUsedRange(
  worksheet: XLSX.WorkSheet,
  usedRangeA1: string
): string[][] {
  const ref = worksheet['!ref'];
  if (typeof ref !== 'string' || ref.trim() === '') {
    return [];
  }

  const range = XLSX.utils.decode_range(usedRangeA1);
  const rows: string[][] = [];

  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = worksheet[address] as XLSX.CellObject | undefined;
      if (cell === undefined) {
        row.push('');
        continue;
      }

      const formatted = XLSX.utils.format_cell(cell);
      if (formatted !== undefined && formatted !== null) {
        row.push(String(formatted));
        continue;
      }

      row.push(cell.v == null ? '' : String(cell.v));
    }
    rows.push(row);
  }

  return rows;
}

function chunkTextForSheet(sheetName: string, markdownTable: string): string {
  if (markdownTable.length === 0) {
    return `## ${sheetName}`;
  }
  return `## ${sheetName}\n\n${markdownTable}`;
}

function stableChunkId(docId: string, sheetName: string, range: string): string {
  return `${docId}:xlsx:${sheetName}:${range}`;
}

export function extractXlsx(input: {
  docId: string;
  fileName: string;
  content: Buffer | Uint8Array;
  documentSensitivity: Sensitivity;
  documentAiUsePolicy: AiUsePolicy;
}): XlsxExtractionResult {
  const now = new Date().toISOString();
  const binary = toBuffer(input.content);
  const workbook = XLSX.read(binary, {
    type: 'buffer',
    cellDates: false,
    raw: false,
  });
  const extractorInput = binary.toString('base64');
  const warnings =
    workbook.SheetNames.length > CHUNK_WARNING_THRESHOLD
      ? [`sheet count exceeded ${CHUNK_WARNING_THRESHOLD}; evaluate chunk strategy.`]
      : [];

  const chunks = workbook.SheetNames.map((sheetName, index) => {
    const worksheet = workbook.Sheets[sheetName];
    const effectiveSheetName = sheetName.trim() || `Sheet${index + 1}`;
    const range = normalizedUsedRangeA1(worksheet);
    const rows = rowsFromUsedRange(worksheet, range);
    const markdownTable = rowsToMarkdownTable(rows);
    const locator = {
      kind: 'spreadsheet' as const,
      sheetName: effectiveSheetName,
      range,
    };

    const baseChunk: KnowledgeChunk = {
      id: stableChunkId(input.docId, effectiveSheetName, range),
      docId: input.docId,
      schemaVersion: KNOWLEDGE_CHUNK_SCHEMA_VERSION,
      sourceType: 'spreadsheet',
      structureType: 'table',
      locator,
      title: input.fileName,
      text: chunkTextForSheet(effectiveSheetName, markdownTable),
      sensitivity: input.documentSensitivity,
      aiUsePolicy: input.documentAiUsePolicy,
      sensitivitySource: 'inherited',
      extractionProvider: 'xlsx',
      extractionWarnings: warnings,
      sourceHash: computeChunkSourceHash({
        extractorInput,
        locator,
      }),
      createdAt: now,
      updatedAt: now,
    };

    return upgradeChunkSensitivityFromColumnHeader(
      baseChunk,
      DEFAULT_COLUMN_SENSITIVITY_RULES
    );
  });

  return {
    normalizedMarkdown: chunks.map((chunk) => chunk.text).join('\n\n'),
    chunks,
  };
}

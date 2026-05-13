import ExcelJS from 'exceljs';
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

export type XlsxMarkdownSheet = {
  sheetName: string;
  range: string;
  markdownTable: string;
  text: string;
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

function encodeColumnName(columnNumber: number): string {
  let dividend = columnNumber;
  let columnName = '';

  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnName = String.fromCharCode(65 + modulo) + columnName;
    dividend = Math.floor((dividend - modulo) / 26);
  }

  return columnName;
}

function cellAddress(rowNumber: number, columnNumber: number): string {
  return `${encodeColumnName(columnNumber)}${rowNumber}`;
}

function normalizedUsedRangeA1(worksheet: ExcelJS.Worksheet): string {
  if (worksheet.actualRowCount === 0 || worksheet.actualColumnCount === 0) {
    return 'A1:A1';
  }

  let minRow = Number.POSITIVE_INFINITY;
  let minColumn = Number.POSITIVE_INFINITY;
  let maxRow = 0;
  let maxColumn = 0;

  worksheet.eachRow((row, rowNumber) => {
    row.eachCell((cell, columnNumber) => {
      if (cell.type === ExcelJS.ValueType.Null) {
        return;
      }
      minRow = Math.min(minRow, rowNumber);
      minColumn = Math.min(minColumn, columnNumber);
      maxRow = Math.max(maxRow, rowNumber);
      maxColumn = Math.max(maxColumn, columnNumber);
    });
  });

  if (!Number.isFinite(minRow) || !Number.isFinite(minColumn)) {
    return 'A1:A1';
  }

  return `${cellAddress(minRow, minColumn)}:${cellAddress(maxRow, maxColumn)}`;
}

function decodedRangeFromA1(range: string): {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
} {
  const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!match) {
    throw new Error(`Invalid worksheet range: ${range}`);
  }

  const decodeColumn = (columnName: string): number =>
    [...columnName].reduce(
      (sum, char) => sum * 26 + char.charCodeAt(0) - 64,
      0
    );

  return {
    startColumn: decodeColumn(match[1]),
    startRow: Number(match[2]),
    endColumn: decodeColumn(match[3]),
    endRow: Number(match[4]),
  };
}

function formatDateCell(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function excelCellValueToString(cell: ExcelJS.Cell): string {
  if (cell.type === ExcelJS.ValueType.Null || cell.type === ExcelJS.ValueType.Merge) {
    return '';
  }

  const value = cell.value;
  if (value == null) {
    return '';
  }
  if (value instanceof Date) {
    return formatDateCell(value);
  }
  if (typeof value === 'object') {
    if ('result' in value) {
      const result = value.result;
      if (result instanceof Date) {
        return formatDateCell(result);
      }
      return result == null ? '' : String(result);
    }
    if ('text' in value && typeof value.text === 'string') {
      return value.text;
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    if ('error' in value && typeof value.error === 'string') {
      return value.error;
    }
  }

  return String(value);
}

function rowsFromUsedRange(
  worksheet: ExcelJS.Worksheet,
  usedRangeA1: string
): string[][] {
  if (worksheet.actualRowCount === 0 || worksheet.actualColumnCount === 0) {
    return [];
  }

  const range = decodedRangeFromA1(usedRangeA1);
  const rows: string[][] = [];

  for (let r = range.startRow; r <= range.endRow; r += 1) {
    const row: string[] = [];
    for (let c = range.startColumn; c <= range.endColumn; c += 1) {
      row.push(excelCellValueToString(worksheet.getCell(r, c)));
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

async function readWorkbookFromXlsxContent(
  content: Buffer | Uint8Array
): Promise<ExcelJS.Workbook> {
  const binary = toBuffer(content);
  if (binary[0] !== 0x50 || binary[1] !== 0x4b) {
    throw new Error('XLSX content must be an OOXML zip package.');
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    binary as unknown as Parameters<typeof workbook.xlsx.load>[0]
  );
  return workbook;
}

export async function xlsxToMarkdownSheets(
  content: Buffer | Uint8Array
): Promise<XlsxMarkdownSheet[]> {
  const workbook = await readWorkbookFromXlsxContent(content);

  return workbook.worksheets.map((worksheet, index) => {
    const effectiveSheetName = worksheet.name.trim() || `Sheet${index + 1}`;
    const range = normalizedUsedRangeA1(worksheet);
    const rows = rowsFromUsedRange(worksheet, range);
    const markdownTable = rowsToMarkdownTable(rows);

    return {
      sheetName: effectiveSheetName,
      range,
      markdownTable,
      text: chunkTextForSheet(effectiveSheetName, markdownTable),
    };
  });
}

export async function xlsxToNormalizedMarkdown(
  content: Buffer | Uint8Array
): Promise<string> {
  return (await xlsxToMarkdownSheets(content))
    .map((sheet) => sheet.text)
    .join('\n\n');
}

export async function extractXlsx(input: {
  docId: string;
  fileName: string;
  content: Buffer | Uint8Array;
  documentSensitivity: Sensitivity;
  documentAiUsePolicy: AiUsePolicy;
}): Promise<XlsxExtractionResult> {
  const now = new Date().toISOString();
  const binary = toBuffer(input.content);
  const sheets = await xlsxToMarkdownSheets(binary);
  const extractorInput = binary.toString('base64');
  const warnings =
    sheets.length > CHUNK_WARNING_THRESHOLD
      ? [`sheet count exceeded ${CHUNK_WARNING_THRESHOLD}; evaluate chunk strategy.`]
      : [];

  const chunks = sheets.map((sheet) => {
    const locator = {
      kind: 'spreadsheet' as const,
      sheetName: sheet.sheetName,
      range: sheet.range,
    };

    const baseChunk: KnowledgeChunk = {
      id: stableChunkId(input.docId, sheet.sheetName, sheet.range),
      docId: input.docId,
      schemaVersion: KNOWLEDGE_CHUNK_SCHEMA_VERSION,
      sourceType: 'spreadsheet',
      structureType: 'table',
      locator,
      title: input.fileName,
      text: sheet.text,
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
    normalizedMarkdown: sheets.map((sheet) => sheet.text).join('\n\n'),
    chunks,
  };
}

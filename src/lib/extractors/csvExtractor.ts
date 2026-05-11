import { parse } from 'csv-parse/sync';
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

export type CsvExtractionResult = {
  /** Curator/masker input: normalized markdown table for the whole document. */
  normalizedMarkdown: string;
  chunks: KnowledgeChunk[];
};

const DEFAULT_SHEET_NAME = 'Sheet1';

function excelColumnLetters(columnIndex1Based: number): string {
  let n = columnIndex1Based;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function usedRangeA1Notation(rowCount: number, colCount: number): string {
  if (rowCount <= 0 || colCount <= 0) {
    return 'A1:A1';
  }
  const lastCol = excelColumnLetters(colCount);
  return `A1:${lastCol}${rowCount}`;
}

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

type ParseCsvRecordsResult = {
  rows: string[][];
  /** Present when csv-parse threw (e.g. unclosed quotes). */
  parseError?: string;
};

function parseCsvRecords(content: string): ParseCsvRecordsResult {
  try {
    const records = parse(content, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: true,
      cast: false,
    }) as string[][];

    return {
      rows: records.map((row) =>
        row.map((cell) => (cell == null ? '' : String(cell)))
      ),
    };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      rows: [],
      parseError: `CSV parse failed: ${detail}`,
    };
  }
}

function stableChunkId(docId: string): string {
  return `${docId}:csv:${DEFAULT_SHEET_NAME}`;
}

export function extractCsv(input: {
  docId: string;
  fileName: string;
  content: string;
  documentSensitivity: Sensitivity;
  documentAiUsePolicy: AiUsePolicy;
}): CsvExtractionResult {
  const now = new Date().toISOString();
  const { rows: rawRows, parseError } = parseCsvRecords(input.content);
  const extractionWarnings = parseError ? [parseError] : [];

  const colCount =
    rawRows.length === 0
      ? 0
      : rawRows.reduce((max, row) => Math.max(max, row.length), 0);
  const rowCount = rawRows.length;

  const normalizedRows =
    colCount === 0
      ? []
      : rawRows.map((row) => {
          const padded = [...row];
          while (padded.length < colCount) {
            padded.push('');
          }
          return padded.slice(0, colCount);
        });

  const normalizedMarkdown = rowsToMarkdownTable(normalizedRows);
  const range = usedRangeA1Notation(rowCount, colCount);

  const locator = {
    kind: 'spreadsheet' as const,
    sheetName: DEFAULT_SHEET_NAME,
    range,
  };

  const baseChunk: KnowledgeChunk = {
    id: stableChunkId(input.docId),
    docId: input.docId,
    schemaVersion: KNOWLEDGE_CHUNK_SCHEMA_VERSION,
    sourceType: 'spreadsheet',
    structureType: 'table',
    locator,
    title: input.fileName,
    text: normalizedMarkdown,
    sensitivity: input.documentSensitivity,
    aiUsePolicy: input.documentAiUsePolicy,
    sensitivitySource: 'inherited',
    extractionProvider: 'csv',
    extractionWarnings,
    sourceHash: computeChunkSourceHash({
      extractorInput: input.content,
      locator,
    }),
    createdAt: now,
    updatedAt: now,
  };

  const chunk = upgradeChunkSensitivityFromColumnHeader(
    baseChunk,
    DEFAULT_COLUMN_SENSITIVITY_RULES
  );

  return {
    normalizedMarkdown,
    chunks: [chunk],
  };
}

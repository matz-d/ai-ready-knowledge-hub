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
import {
  buildCsvPreflightReport,
  formatPreflightWarning,
  renderTableManifest,
  tableManifestPreviewRowLimit,
  type DocumentPreflightReport,
} from './preflight';

export type CsvExtractionResult = {
  /** Curator/masker input: normalized markdown table for the whole document. */
  normalizedMarkdown: string;
  chunks: KnowledgeChunk[];
  preflightReport: DocumentPreflightReport;
};

export type CsvCuratorInput = {
  content: string;
  inputMode: 'full_text' | 'table_manifest';
  preflightReport: DocumentPreflightReport;
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

function stableChunkId(docId: string, range: string, role?: string): string {
  const rolePart = role === undefined ? '' : `:${role}`;
  return `${docId}:csv:${DEFAULT_SHEET_NAME}:${range}${rolePart}`;
}

function buildChunk(input: {
  docId: string;
  fileName: string;
  text: string;
  locator: KnowledgeChunk['locator'];
  extractorInput: string;
  documentSensitivity: Sensitivity;
  documentAiUsePolicy: AiUsePolicy;
  extractionWarnings: string[];
  createdAt: string;
  role?: string;
}): KnowledgeChunk {
  const locator = input.locator;
  const baseChunk: KnowledgeChunk = {
    id:
      locator.kind === 'spreadsheet'
        ? stableChunkId(input.docId, locator.range, input.role)
        : `${input.docId}:csv:${input.role ?? 'chunk'}`,
    docId: input.docId,
    schemaVersion: KNOWLEDGE_CHUNK_SCHEMA_VERSION,
    sourceType: 'spreadsheet',
    structureType: 'table',
    locator,
    title: input.fileName,
    text: input.text,
    sensitivity: input.documentSensitivity,
    aiUsePolicy: input.documentAiUsePolicy,
    sensitivitySource: 'inherited',
    extractionProvider: 'csv',
    extractionWarnings: input.extractionWarnings,
    sourceHash: computeChunkSourceHash({
      extractorInput: input.extractorInput,
      locator,
    }),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };

  return upgradeChunkSensitivityFromColumnHeader(
    baseChunk,
    DEFAULT_COLUMN_SENSITIVITY_RULES
  );
}

function buildSummaryText(input: {
  fileName: string;
  rowCount: number;
  columnCount: number;
  headerRows: string[][];
}): string {
  return [
    `## ${input.fileName}`,
    '',
    `Rows: ${input.rowCount}`,
    `Columns: ${input.columnCount}`,
    '',
    rowsToMarkdownTable(input.headerRows),
  ]
    .filter((part) => part.length > 0)
    .join('\n');
}

function buildRowWindowChunks(input: {
  docId: string;
  fileName: string;
  normalizedRows: string[][];
  columnCount: number;
  fullRange: string;
  rowGroupSize: number;
  documentSensitivity: Sensitivity;
  documentAiUsePolicy: AiUsePolicy;
  extractionWarnings: string[];
  extractorInput: string;
  createdAt: string;
}): KnowledgeChunk[] {
  const header = input.normalizedRows[0];
  if (header === undefined || input.normalizedRows.length <= 1) {
    return [];
  }

  const chunks: KnowledgeChunk[] = [
    buildChunk({
      docId: input.docId,
      fileName: input.fileName,
      text: buildSummaryText({
        fileName: input.fileName,
        rowCount: input.normalizedRows.length,
        columnCount: input.columnCount,
        headerRows: [header],
      }),
      locator: {
        kind: 'spreadsheet',
        sheetName: DEFAULT_SHEET_NAME,
        range: input.fullRange,
      },
      extractorInput: input.extractorInput,
      documentSensitivity: input.documentSensitivity,
      documentAiUsePolicy: input.documentAiUsePolicy,
      extractionWarnings: input.extractionWarnings,
      createdAt: input.createdAt,
      role: 'summary',
    }),
  ];

  for (
    let startIndex = 1;
    startIndex < input.normalizedRows.length;
    startIndex += input.rowGroupSize
  ) {
    const endIndexExclusive = Math.min(
      startIndex + input.rowGroupSize,
      input.normalizedRows.length
    );
    const startRow = startIndex + 1;
    const endRow = endIndexExclusive;
    const range = `A${startRow}:${excelColumnLetters(input.columnCount)}${endRow}`;
    const markdownTable = rowsToMarkdownTable([
      header,
      ...input.normalizedRows.slice(startIndex, endIndexExclusive),
    ]);
    const text = `## ${input.fileName} rows ${startRow}-${endRow}\n\n${markdownTable}`;

    chunks.push(
      buildChunk({
        docId: input.docId,
        fileName: input.fileName,
        text,
        locator: {
          kind: 'spreadsheet',
          sheetName: DEFAULT_SHEET_NAME,
          range,
        },
        extractorInput: input.extractorInput,
        documentSensitivity: input.documentSensitivity,
        documentAiUsePolicy: input.documentAiUsePolicy,
        extractionWarnings: [
          ...input.extractionWarnings,
          `rowWindow=${startRow}-${endRow}`,
        ],
        createdAt: input.createdAt,
      })
    );
  }

  return chunks;
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
  const preflightReport = buildCsvPreflightReport({
    rowCount,
    columnCount: colCount,
    estimatedChars: normalizedMarkdown.length,
  });
  const preflightWarning = formatPreflightWarning(preflightReport);
  if (preflightWarning) {
    extractionWarnings.push(preflightWarning);
  }

  const shouldSplitRows =
    preflightReport.recommendedSplitUnit === 'row_group' &&
    normalizedRows.length > 1;
  const chunks = shouldSplitRows
    ? buildRowWindowChunks({
        docId: input.docId,
        fileName: input.fileName,
        normalizedRows,
        columnCount: colCount,
        fullRange: range,
        rowGroupSize: preflightReport.suggestedRowGroupSize ?? 500,
        documentSensitivity: input.documentSensitivity,
        documentAiUsePolicy: input.documentAiUsePolicy,
        extractionWarnings,
        extractorInput: input.content,
        createdAt: now,
      })
    : [
        buildChunk({
          docId: input.docId,
          fileName: input.fileName,
          text: normalizedMarkdown,
          locator: {
            kind: 'spreadsheet',
            sheetName: DEFAULT_SHEET_NAME,
            range,
          },
          extractorInput: input.content,
          documentSensitivity: input.documentSensitivity,
          documentAiUsePolicy: input.documentAiUsePolicy,
          extractionWarnings,
          createdAt: now,
        }),
      ];

  return {
    normalizedMarkdown,
    chunks,
    preflightReport,
  };
}

export function buildCsvCuratorInput(input: {
  fileName: string;
  content: string;
}): CsvCuratorInput {
  const { rows: rawRows } = parseCsvRecords(input.content);
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
  const preflightReport = buildCsvPreflightReport({
    rowCount,
    columnCount: colCount,
    estimatedChars: normalizedMarkdown.length,
  });

  const content = renderTableManifest({
    fileName: input.fileName,
    preflightReport,
    fallbackText: input.content,
    sheets: [
      {
        sheetName: DEFAULT_SHEET_NAME,
        rowCount,
        columnCount: colCount,
        range,
        previewMarkdown: rowsToMarkdownTable(
          normalizedRows.slice(0, tableManifestPreviewRowLimit())
        ),
      },
    ],
  });

  return {
    content,
    inputMode:
      preflightReport.recommendedSplitUnit === 'none'
        ? 'full_text'
        : 'table_manifest',
    preflightReport,
  };
}

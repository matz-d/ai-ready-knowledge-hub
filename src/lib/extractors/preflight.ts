export type PreflightFileType = 'csv' | 'xlsx' | 'pdf';

export type PreflightRecommendedSplitUnit =
  | 'none'
  | 'sheet'
  | 'row_group'
  | 'page_group';

export type DocumentPreflightReport = {
  fileType: PreflightFileType;
  pageCount?: number;
  sheetCount?: number;
  rowCount?: number;
  columnCount?: number;
  maxSheetRows?: number;
  estimatedChars: number;
  chunkEstimate: number;
  recommendedSplitUnit: PreflightRecommendedSplitUnit;
  reasons: string[];
  suggestedRowGroupSize?: number;
  suggestedPageGroupSize?: number;
};

export type PdfPageGroup = {
  groupIndex: number;
  startPage: number;
  endPage: number;
  pageCount: number;
  estimatedChars: number;
  preview: string;
};

export type PdfPageGroupSplitPlan = {
  splitUnit: 'page_group';
  pageGroupSize: number;
  groups: PdfPageGroup[];
};

const APPROX_CHARS_PER_CHUNK = 4_000;
const LARGE_TABLE_ROW_THRESHOLD = 1_000;
const LARGE_TABLE_CHAR_THRESHOLD = 100_000;
const MANY_SHEETS_THRESHOLD = 20;
const LARGE_PDF_PAGE_THRESHOLD = 50;
const LARGE_PDF_CHAR_THRESHOLD = 150_000;
const ROW_GROUP_SIZE = 500;
const PAGE_GROUP_SIZE = 25;
const PDF_GROUP_PREVIEW_CHARS = 600;

function estimateChunkCount(estimatedChars: number): number {
  if (estimatedChars <= 0) return 0;
  return Math.max(1, Math.ceil(estimatedChars / APPROX_CHARS_PER_CHUNK));
}

export function buildCsvPreflightReport(input: {
  rowCount: number;
  columnCount: number;
  estimatedChars: number;
}): DocumentPreflightReport {
  const chunkEstimate = estimateChunkCount(input.estimatedChars);
  const reasons: string[] = [];

  if (input.rowCount > LARGE_TABLE_ROW_THRESHOLD) {
    reasons.push(`rowCount>${LARGE_TABLE_ROW_THRESHOLD}`);
  }
  if (input.estimatedChars > LARGE_TABLE_CHAR_THRESHOLD) {
    reasons.push(`estimatedChars>${LARGE_TABLE_CHAR_THRESHOLD}`);
  }

  return {
    fileType: 'csv',
    rowCount: input.rowCount,
    columnCount: input.columnCount,
    estimatedChars: input.estimatedChars,
    chunkEstimate,
    recommendedSplitUnit: reasons.length > 0 ? 'row_group' : 'none',
    reasons,
    ...(reasons.length > 0 ? { suggestedRowGroupSize: ROW_GROUP_SIZE } : {}),
  };
}

export function buildXlsxPreflightReport(input: {
  sheetCount: number;
  rowCount: number;
  columnCount: number;
  maxSheetRows: number;
  estimatedChars: number;
}): DocumentPreflightReport {
  const chunkEstimate = estimateChunkCount(input.estimatedChars);
  const reasons: string[] = [];

  if (input.maxSheetRows > LARGE_TABLE_ROW_THRESHOLD) {
    reasons.push(`maxSheetRows>${LARGE_TABLE_ROW_THRESHOLD}`);
  }
  if (input.estimatedChars > LARGE_TABLE_CHAR_THRESHOLD) {
    reasons.push(`estimatedChars>${LARGE_TABLE_CHAR_THRESHOLD}`);
  }
  if (input.sheetCount > MANY_SHEETS_THRESHOLD) {
    reasons.push(`sheetCount>${MANY_SHEETS_THRESHOLD}`);
  }

  const recommendedSplitUnit =
    input.maxSheetRows > LARGE_TABLE_ROW_THRESHOLD ||
    input.estimatedChars > LARGE_TABLE_CHAR_THRESHOLD
      ? 'row_group'
      : input.sheetCount > MANY_SHEETS_THRESHOLD
        ? 'sheet'
        : 'none';

  return {
    fileType: 'xlsx',
    sheetCount: input.sheetCount,
    rowCount: input.rowCount,
    columnCount: input.columnCount,
    maxSheetRows: input.maxSheetRows,
    estimatedChars: input.estimatedChars,
    chunkEstimate,
    recommendedSplitUnit,
    reasons,
    ...(recommendedSplitUnit === 'row_group'
      ? { suggestedRowGroupSize: ROW_GROUP_SIZE }
      : {}),
  };
}

export function buildPdfPreflightReport(input: {
  pageCount: number;
  estimatedChars: number;
}): DocumentPreflightReport {
  const chunkEstimate = estimateChunkCount(input.estimatedChars);
  const reasons: string[] = [];

  if (input.pageCount > LARGE_PDF_PAGE_THRESHOLD) {
    reasons.push(`pageCount>${LARGE_PDF_PAGE_THRESHOLD}`);
  }
  if (input.estimatedChars > LARGE_PDF_CHAR_THRESHOLD) {
    reasons.push(`estimatedChars>${LARGE_PDF_CHAR_THRESHOLD}`);
  }

  return {
    fileType: 'pdf',
    pageCount: input.pageCount,
    estimatedChars: input.estimatedChars,
    chunkEstimate,
    recommendedSplitUnit: reasons.length > 0 ? 'page_group' : 'none',
    reasons,
    ...(reasons.length > 0 ? { suggestedPageGroupSize: PAGE_GROUP_SIZE } : {}),
  };
}

function normalizePreview(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, PDF_GROUP_PREVIEW_CHARS);
}

export function buildPdfPageGroupSplitPlan(input: {
  pages: readonly { pageNumber?: number; num?: number; text: string }[];
  preflightReport: DocumentPreflightReport;
}): PdfPageGroupSplitPlan | undefined {
  if (input.preflightReport.recommendedSplitUnit !== 'page_group') {
    return undefined;
  }

  const pageGroupSize = input.preflightReport.suggestedPageGroupSize ?? PAGE_GROUP_SIZE;
  const groups: PdfPageGroup[] = [];

  for (let i = 0; i < input.pages.length; i += pageGroupSize) {
    const pageGroup = input.pages.slice(i, i + pageGroupSize);
    if (pageGroup.length === 0) continue;
    const firstPageNumber = pageGroup[0].pageNumber ?? pageGroup[0].num ?? i + 1;
    const lastPage = pageGroup[pageGroup.length - 1];
    const lastPageNumber =
      lastPage.pageNumber ?? lastPage.num ?? i + pageGroup.length;
    const text = pageGroup.map((page) => page.text).join('\n');
    groups.push({
      groupIndex: groups.length + 1,
      startPage: firstPageNumber,
      endPage: lastPageNumber,
      pageCount: pageGroup.length,
      estimatedChars: text.length,
      preview: normalizePreview(text),
    });
  }

  return {
    splitUnit: 'page_group',
    pageGroupSize,
    groups,
  };
}

export function renderPdfPageGroupManifest(input: {
  fileName: string;
  preflightReport: DocumentPreflightReport;
  pageGroupPlan?: PdfPageGroupSplitPlan;
  fallbackText: string;
}): string {
  if (input.pageGroupPlan === undefined) {
    return input.fallbackText;
  }

  const lines = [
    `# ${input.fileName}`,
    '',
    'PDF preflight page-group manifest for document classification.',
    `Pages: ${input.preflightReport.pageCount ?? 0}`,
    `Estimated chars: ${input.preflightReport.estimatedChars}`,
    `Chunk estimate: ${input.preflightReport.chunkEstimate}`,
    `Recommended split unit: ${input.preflightReport.recommendedSplitUnit}`,
    `Reasons: ${input.preflightReport.reasons.join(', ')}`,
    '',
    '## Page Groups',
  ];

  for (const group of input.pageGroupPlan.groups) {
    lines.push(
      '',
      `### Group ${group.groupIndex}: pages ${group.startPage}-${group.endPage}`,
      `Pages: ${group.pageCount}`,
      `Estimated chars: ${group.estimatedChars}`,
      group.preview.length > 0 ? group.preview : '(no text preview)'
    );
  }

  return lines.join('\n');
}

export function formatPreflightWarning(
  report: DocumentPreflightReport
): string | undefined {
  if (report.reasons.length === 0) return undefined;

  const fields = [
    `fileType=${report.fileType}`,
    report.pageCount === undefined ? undefined : `pages=${report.pageCount}`,
    report.sheetCount === undefined ? undefined : `sheets=${report.sheetCount}`,
    report.rowCount === undefined ? undefined : `rows=${report.rowCount}`,
    report.columnCount === undefined ? undefined : `columns=${report.columnCount}`,
    report.maxSheetRows === undefined
      ? undefined
      : `maxSheetRows=${report.maxSheetRows}`,
    `estimatedChars=${report.estimatedChars}`,
    `chunkEstimate=${report.chunkEstimate}`,
    `recommendedSplitUnit=${report.recommendedSplitUnit}`,
    `reasons=${report.reasons.join(',')}`,
  ].filter((field): field is string => field !== undefined);

  return `preflight: ${fields.join(' ')}`;
}

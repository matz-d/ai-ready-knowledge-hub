import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DOCUMENT_IR_SCHEMA_VERSION,
  documentIrToKnowledgeChunks,
  type DocumentIr,
  type DocumentIrBlock,
} from '../src/eval/conversion';
import { evalContextPackageReadiness } from '../src/eval/conversion/heuristic';
import {
  buildP1dMixedPdfHandoffCases,
  classifyP1dMixedPdfExtraction,
  DEFAULT_P1D_MIXED_PDF_MAX_CHUNKS,
  P1D_MIXED_PDF_CHECK_SCHEMA_VERSION,
  type P1dMixedPdfFailureReason,
} from '../src/eval/conversion/p1dMixedPdfCheck';

type CliOptions = {
  inputPath: string;
  outPath: string;
  maxChunks: number;
  pretty: boolean;
};

type PdfTextPage = {
  num: number;
  text: string;
};

type PdfTextResult = {
  total: number;
  pages: PdfTextPage[];
};

type PdfTablePage = {
  num: number;
  tables: Array<Array<Array<string | null>>>;
};

type PdfTableResult = {
  pages: PdfTablePage[];
};

type P1dMixedPdfReport = {
  schemaVersion: typeof P1D_MIXED_PDF_CHECK_SCHEMA_VERSION;
  generatedAt: string;
  mode: 'local';
  liveCalls: false;
  input: {
    path: string;
    fileName: string;
    sizeBytes: number;
  };
  largeMixedPdfExtractionStatus: ReturnType<
    typeof classifyP1dMixedPdfExtraction
  >['largeMixedPdfExtractionStatus'];
  largeMixedPdfFailureReasons: P1dMixedPdfFailureReason[];
  textExtraction: {
    ok: boolean;
    totalPages: number;
    pagesWithText: number;
    charCount: number;
    error?: string;
  };
  tableExtraction: {
    ok: boolean;
    tableCount: number;
    tableRowCount: number;
    error?: string;
  };
  chunkReadiness: {
    chunkCount: number;
    averageChunkLength: number;
    emptyChunkCount: number;
    oversizedChunkCount: number;
    maxChunks: number;
  };
  p1eHandoffCases: ReturnType<typeof buildP1dMixedPdfHandoffCases>;
};

function parseArgs(argv: string[]): CliOptions {
  let inputPath: string | undefined;
  let outPath = 'tmp/p1d-mixed-pdf-check.json';
  let maxChunks = DEFAULT_P1D_MIXED_PDF_MAX_CHUNKS;
  let pretty = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--out') {
      const next = argv[index + 1];
      if (!next) throw new Error('--out requires a file path');
      outPath = next;
      index += 1;
      continue;
    }
    if (arg === '--max-chunks') {
      const next = argv[index + 1];
      if (!next) throw new Error('--max-chunks requires a number');
      maxChunks = Number.parseInt(next, 10);
      if (!Number.isFinite(maxChunks) || maxChunks < 1) {
        throw new Error('--max-chunks must be a positive integer');
      }
      index += 1;
      continue;
    }
    if (arg === '--no-pretty') {
      pretty = false;
      continue;
    }
    if (!inputPath) {
      inputPath = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!inputPath) {
    throw new Error(
      'Usage: pnpm eval:p1d:mixed-pdf -- <local-pdf-path> [--out tmp/p1d-mixed-pdf-check.json]'
    );
  }

  return {
    inputPath,
    outPath,
    maxChunks,
    pretty,
  };
}

async function ensurePdfCanvasPolyfills(): Promise<void> {
  const canvas = await import('@napi-rs/canvas');
  const target = globalThis as Record<string, unknown>;
  target.DOMMatrix ??= canvas.DOMMatrix;
  target.ImageData ??= canvas.ImageData;
  target.Path2D ??= canvas.Path2D;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildTextOnlyDocumentIr(options: {
  fileName: string;
  pages: readonly PdfTextPage[];
}): DocumentIr {
  return {
    schemaVersion: DOCUMENT_IR_SCHEMA_VERSION,
    source: {
      fileName: options.fileName,
      mediaType: 'application/pdf',
      sourceKind: 'poc',
      sourceSubtype: 'official-doc-pdf',
    },
    pages: options.pages.map((page) => {
      const text = page.text.trim();
      const blocks: DocumentIrBlock[] =
        text.length > 0
          ? [
              {
                blockId: `p${page.num}-b1`,
                kind: 'paragraph',
                text,
                locator: { pageNumber: page.num },
              },
            ]
          : [];
      return {
        pageNumber: page.num,
        blocks,
      };
    }),
  };
}

function buildDocumentIrWithTables(options: {
  fileName: string;
  pages: readonly PdfTextPage[];
  tableResult: PdfTableResult | null;
}): DocumentIr {
  const tablesByPage = new Map<number, PdfTablePage['tables']>();
  for (const page of options.tableResult?.pages ?? []) {
    tablesByPage.set(page.num, page.tables);
  }

  return {
    schemaVersion: DOCUMENT_IR_SCHEMA_VERSION,
    source: {
      fileName: options.fileName,
      mediaType: 'application/pdf',
      sourceKind: 'poc',
      sourceSubtype: 'official-doc-pdf',
    },
    pages: options.pages.map((page) => {
      const blocks: DocumentIrBlock[] = [];
      let blockSeq = 0;
      const tables = tablesByPage.get(page.num) ?? [];

      for (let tableIndex = 0; tableIndex < tables.length; tableIndex += 1) {
        const table = tables[tableIndex];
        for (let rowIndex = 0; rowIndex < table.length; rowIndex += 1) {
          const trimmedCells = table[rowIndex].map((cell) =>
            (cell ?? '').trim()
          );
          if (trimmedCells.every((cell) => cell.length === 0)) continue;
          blockSeq += 1;
          blocks.push({
            blockId: `p${page.num}-t${tableIndex}-r${rowIndex}`,
            kind: 'table',
            text: trimmedCells.join('\t'),
            locator: {
              pageNumber: page.num,
              tableIndex,
              rowIndex,
            },
            metadata: {
              columnCount: trimmedCells.length,
              isHeaderRow: rowIndex === 0,
            },
          });
        }
      }

      const text = page.text.trim();
      if (text.length > 0) {
        blockSeq += 1;
        blocks.push({
          blockId: `p${page.num}-b${blockSeq}`,
          kind: 'paragraph',
          text,
          locator: { pageNumber: page.num },
        });
      }

      return {
        pageNumber: page.num,
        blocks,
      };
    }),
  };
}

async function runLocalPdfParse(options: {
  inputPath: string;
  fileName: string;
}): Promise<{
  textResult: PdfTextResult | null;
  textError?: string;
  tableResult: PdfTableResult | null;
  tableError?: string;
}> {
  await ensurePdfCanvasPolyfills();
  const { PDFParse } = await import('pdf-parse');
  const buffer = await readFile(options.inputPath);
  const data = new Uint8Array(buffer.byteLength);
  data.set(buffer);
  const parser = new PDFParse({ data });

  let textResult: PdfTextResult | null = null;
  let tableResult: PdfTableResult | null = null;
  let textError: string | undefined;
  let tableError: string | undefined;

  try {
    try {
      textResult = (await parser.getText({ pageJoiner: '' })) as PdfTextResult;
    } catch (error: unknown) {
      textError = errorMessage(error);
    }

    try {
      tableResult = (await parser.getTable()) as PdfTableResult;
    } catch (error: unknown) {
      tableError = errorMessage(error);
    }
  } finally {
    await parser.destroy();
  }

  return { textResult, textError, tableResult, tableError };
}

async function buildReport(options: CliOptions): Promise<P1dMixedPdfReport> {
  const absolutePath = path.resolve(options.inputPath);
  const file = await stat(absolutePath);
  const fileName = path.basename(absolutePath);
  const { textResult, textError, tableResult, tableError } =
    await runLocalPdfParse({
      inputPath: absolutePath,
      fileName,
    });

  const textPages = textResult?.pages ?? [];
  const textCharCount = textPages.reduce(
    (sum, page) => sum + page.text.length,
    0
  );
  const pagesWithText = textPages.filter(
    (page) => page.text.trim().length > 0
  ).length;

  const documentIr = textResult
    ? buildDocumentIrWithTables({
        fileName,
        pages: textPages,
        tableResult,
      })
    : buildTextOnlyDocumentIr({ fileName, pages: [] });
  const chunks = documentIrToKnowledgeChunks({
    documentIr,
    docId: path.parse(fileName).name,
    extractorInput: textPages.map((page) => page.text).join('\n'),
    documentSensitivity: 'Internal',
    documentAiUsePolicy: 'direct',
    title: fileName,
  });
  const { contextPackageReadiness } = evalContextPackageReadiness({
    documentIr,
    chunks,
  });

  const tableCount =
    tableResult?.pages.reduce((sum, page) => sum + page.tables.length, 0) ?? 0;
  const tableRowCount =
    tableResult?.pages.reduce(
      (sum, page) =>
        sum +
        page.tables.reduce((tableSum, table) => tableSum + table.length, 0),
      0
    ) ?? 0;

  const classification = classifyP1dMixedPdfExtraction({
    textExtractionOk: textResult !== null,
    textCharCount,
    tableExtractionOk: tableResult !== null,
    oversizedChunkCount: contextPackageReadiness.oversizedChunks,
    emptyChunkCount: contextPackageReadiness.emptyChunks,
    chunkCount: contextPackageReadiness.chunkCount,
    maxChunks: options.maxChunks,
  });
  const command = `pnpm eval:p1d:mixed-pdf -- ${absolutePath}`;

  return {
    schemaVersion: P1D_MIXED_PDF_CHECK_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'local',
    liveCalls: false,
    input: {
      path: absolutePath,
      fileName,
      sizeBytes: file.size,
    },
    ...classification,
    textExtraction: {
      ok: textResult !== null,
      totalPages: textResult?.total ?? 0,
      pagesWithText,
      charCount: textCharCount,
      ...(textError !== undefined ? { error: textError } : {}),
    },
    tableExtraction: {
      ok: tableResult !== null,
      tableCount,
      tableRowCount,
      ...(tableError !== undefined ? { error: tableError } : {}),
    },
    chunkReadiness: {
      chunkCount: contextPackageReadiness.chunkCount,
      averageChunkLength: contextPackageReadiness.averageChunkLength,
      emptyChunkCount: contextPackageReadiness.emptyChunks,
      oversizedChunkCount: contextPackageReadiness.oversizedChunks,
      maxChunks: options.maxChunks,
    },
    p1eHandoffCases: buildP1dMixedPdfHandoffCases({
      localPath: absolutePath,
      command,
      reasons: classification.largeMixedPdfFailureReasons,
    }),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await buildReport(options);
  const json = JSON.stringify(report, null, options.pretty ? 2 : 0);
  const outPath = path.resolve(options.outPath);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${json}\n`, 'utf8');
  process.stdout.write(`${json}\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});


import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { ai, location, modelId, modelRefFor } from '../../../../src/agents/_shared/genkitClient';
import {
  DOCUMENT_IR_SCHEMA_VERSION,
  type DocumentIr,
  type DocumentIrBlock,
  type DocumentIrPage,
} from '../../shared/documentIr';

const SUBTYPE = 'official-doc-pdf' as const;
const execFileAsync = promisify(execFile);
type GeminiOfficialDocExtractionMode = 'full' | 'tables';

const GeminiOfficialDocBlockSchema = z.object({
  kind: z.enum(['paragraph', 'heading', 'table', 'image_text', 'note']),
  text: z.string(),
  headingLevel: z.number().int().min(1).max(6).optional(),
  tableIndex: z.number().int().nonnegative().optional(),
  rowIndex: z.number().int().nonnegative().optional(),
  columnCount: z.number().int().positive().optional(),
});

const GeminiOfficialDocPageSchema = z.object({
  pageNumber: z.number().int().min(1),
  blocks: z.array(GeminiOfficialDocBlockSchema),
});

export const GeminiOfficialDocPdfOutputSchema = z.object({
  pages: z.array(GeminiOfficialDocPageSchema),
  warnings: z.array(z.string()).optional(),
});

export type GeminiOfficialDocPdfOutput = z.infer<
  typeof GeminiOfficialDocPdfOutputSchema
>;

export type ExtractGeminiOfficialDocPdfResult = {
  documentIr: DocumentIr;
  model: string;
  region: string;
  pageGroupSize: number;
  concurrency: number;
  attemptsPerGroup: number;
  pageGroupCount: number;
  geminiCallCount: number;
  elapsedMs: number;
};

type GeminiGenerateResponse = Awaited<ReturnType<typeof ai.generate>>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function firstString(
  record: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function firstNumber(
  record: Record<string, unknown>,
  keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function normalizeKind(
  value: unknown
): z.infer<typeof GeminiOfficialDocBlockSchema>['kind'] {
  if (typeof value !== 'string') return 'paragraph';
  const normalized = value.toLowerCase().replace(/[-\s]/g, '_');
  if (normalized.includes('heading') || normalized.includes('title')) {
    return 'heading';
  }
  if (normalized.includes('table')) return 'table';
  if (normalized.includes('image') || normalized.includes('figure')) {
    return 'image_text';
  }
  if (normalized.includes('note')) return 'note';
  return 'paragraph';
}

function blockTextFromRecord(record: Record<string, unknown>): string {
  const direct = firstString(record, ['text', 'content', 'markdown', 'value']);
  if (direct !== undefined) return direct;

  const cells = record.cells;
  if (Array.isArray(cells)) {
    return cells
      .map((cell) => {
        if (typeof cell === 'string' || typeof cell === 'number') {
          return String(cell);
        }
        const cellRecord = asRecord(cell);
        return cellRecord
          ? firstString(cellRecord, ['text', 'content', 'value']) ?? ''
          : '';
      })
      .filter((cell) => cell.trim().length > 0)
      .join('\t');
  }

  return '';
}

function normalizeGeminiOfficialDocOutput(value: unknown): unknown {
  const root = asRecord(value);
  if (!root || !Array.isArray(root.pages)) return value;

  return {
    ...root,
    pages: root.pages.map((pageValue, pageIndex) => {
      const page = asRecord(pageValue);
      if (!page) {
        return {
          pageNumber: pageIndex + 1,
          blocks: [],
        };
      }
      const rawBlocks = Array.isArray(page.blocks)
        ? page.blocks
        : Array.isArray(page.elements)
          ? page.elements
          : Array.isArray(page.content)
            ? page.content
            : [];

      return {
        ...page,
        pageNumber:
          firstNumber(page, [
            'pageNumber',
            'page_number',
            'page',
            'pageNo',
            'page_no',
          ]) ?? pageIndex + 1,
        blocks: rawBlocks.map((blockValue, blockIndex) => {
          const block = asRecord(blockValue);
          if (!block) {
            return {
              kind: 'paragraph',
              text: typeof blockValue === 'string' ? blockValue : '',
            };
          }
          const cells = Array.isArray(block.cells) ? block.cells : undefined;
          return {
            ...block,
            kind: cells
              ? 'table'
              : normalizeKind(
                  block.kind ?? block.type ?? block.blockType ?? block.role
                ),
            text: blockTextFromRecord(block),
            tableIndex: firstNumber(block, [
              'tableIndex',
              'table_index',
              'table',
            ]),
            rowIndex:
              firstNumber(block, ['rowIndex', 'row_index', 'row']) ??
              (cells ? blockIndex : undefined),
            columnCount:
              firstNumber(block, [
                'columnCount',
                'column_count',
                'columns',
              ]) ?? cells?.length,
          };
        }),
      };
    }),
  };
}

function parseJsonFromModelText(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  const raw = fence ? fence[1]!.trim() : trimmed;
  return JSON.parse(raw) as unknown;
}

function assertNonEmptyOutput(output: GeminiOfficialDocPdfOutput): void {
  if (output.pages.length === 0) {
    throw new Error('Gemini official-doc-pdf output contained zero pages');
  }
  const hasText = output.pages.some((page) =>
    page.blocks.some((block) => block.text.trim().length > 0)
  );
  if (!hasText) {
    throw new Error('Gemini official-doc-pdf output contained no visible text');
  }
}

function parseGeminiOfficialDocOutput(
  response: {
    output?: unknown;
    text?: string;
  },
  options?: { allowNoVisibleText?: boolean; emptyPageCount?: number }
): GeminiOfficialDocPdfOutput {
  const hasOutput = response.output != null;
  const hasText = typeof response.text === 'string' && response.text.trim().length > 0;
  if (!hasOutput && !hasText) {
    if (options?.allowNoVisibleText) {
      return {
        pages: Array.from({ length: options.emptyPageCount ?? 1 }, (_, index) => ({
          pageNumber: index + 1,
          blocks: [],
        })),
      };
    }
    throw new Error('Gemini official-doc-pdf returned empty output and text');
  }

  const attempts: string[] = [];

  if (hasOutput) {
    const parsed = GeminiOfficialDocPdfOutputSchema.safeParse(
      normalizeGeminiOfficialDocOutput(response.output)
    );
    if (parsed.success) {
      if (!options?.allowNoVisibleText) assertNonEmptyOutput(parsed.data);
      return parsed.data;
    }
    attempts.push(
      `structured(output): ${parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`
    );
  }

  if (hasText) {
    try {
      const parsed = GeminiOfficialDocPdfOutputSchema.safeParse(
        normalizeGeminiOfficialDocOutput(parseJsonFromModelText(response.text!))
      );
      if (parsed.success) {
        if (!options?.allowNoVisibleText) assertNonEmptyOutput(parsed.data);
        return parsed.data;
      }
      attempts.push(
        `structured(text): ${parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`
      );
    } catch (error) {
      attempts.push(
        `structured(text) JSON.parse: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  throw new Error(
    `Gemini official-doc-pdf output failed schema validation: ${attempts.join(' | ')}`
  );
}

function blockToDocumentIrBlock(options: {
  pageNumber: number;
  blockSeq: number;
  syntheticTableIndex?: number;
  syntheticRowIndex?: number;
  extractionProvider?: string;
  block: z.infer<typeof GeminiOfficialDocBlockSchema>;
}): DocumentIrBlock | null {
  const text = options.block.text.trim();
  if (!text) return null;
  const tableIndex =
    options.syntheticTableIndex ?? options.block.tableIndex;
  const rowIndex = options.syntheticRowIndex ?? options.block.rowIndex;

  const metadata: Record<string, unknown> = {
    extractionProvider: options.extractionProvider ?? 'gemini-direct',
  };
  if (options.block.kind === 'heading') {
    metadata.headingLevel = options.block.headingLevel ?? 1;
  }
  if (options.block.columnCount !== undefined) {
    metadata.columnCount = options.block.columnCount;
  }

  return {
    blockId: `p${options.pageNumber}-g${options.blockSeq}`,
    kind: options.block.kind,
    text,
    locator: {
      pageNumber: options.pageNumber,
      ...(options.block.kind === 'table' &&
      tableIndex !== undefined &&
      rowIndex !== undefined
        ? {
            tableIndex,
            rowIndex,
          }
        : {}),
    },
    metadata,
  };
}

function buildDocumentIrFromGemini(options: {
  fileName: string;
  output: GeminiOfficialDocPdfOutput;
  extractionProvider?: string;
}): DocumentIr {
  const isTableAssist =
    options.extractionProvider === 'gemini-table-assist';
  const pages: DocumentIrPage[] = options.output.pages.map((page) => {
    const blocks: DocumentIrBlock[] = [];
    let syntheticTableIndex = 1;
    let syntheticTableAssistRowIndex = 0;
    for (let index = 0; index < page.blocks.length; index += 1) {
      const geminiBlock = page.blocks[index];
      const isTable = geminiBlock.kind === 'table';
      const block = blockToDocumentIrBlock({
        pageNumber: page.pageNumber,
        blockSeq: index + 1,
        syntheticTableIndex: isTable
          ? isTableAssist
            ? 1
            : syntheticTableIndex
          : undefined,
        syntheticRowIndex: isTable
          ? isTableAssist
            ? syntheticTableAssistRowIndex
            : 0
          : undefined,
        extractionProvider: options.extractionProvider,
        block: geminiBlock,
      });
      if (block) blocks.push(block);
      if (isTableAssist && isTable) {
        syntheticTableAssistRowIndex += 1;
      } else if (isTable) {
        syntheticTableIndex += 1;
      }
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

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function pageGroups(totalPages: number, groupSize: number): Array<{
  startPage: number;
  endPage: number;
}> {
  const groups: Array<{ startPage: number; endPage: number }> = [];
  for (let startPage = 1; startPage <= totalPages; startPage += groupSize) {
    groups.push({
      startPage,
      endPage: Math.min(totalPages, startPage + groupSize - 1),
    });
  }
  return groups;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

async function withRetry<T>(
  attempts: number,
  run: () => Promise<T>
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function splitPdfPageGroup(options: {
  inputPath: string;
  outputPath: string;
  startPage: number;
  endPage: number;
}): Promise<void> {
  await execFileAsync('gs', [
    '-q',
    '-dSAFER',
    '-dBATCH',
    '-dNOPAUSE',
    '-sDEVICE=pdfwrite',
    `-dFirstPage=${options.startPage}`,
    `-dLastPage=${options.endPage}`,
    `-sOutputFile=${options.outputPath}`,
    options.inputPath,
  ]);
}

function remapGroupPageNumbers(options: {
  output: GeminiOfficialDocPdfOutput;
  startPage: number;
  endPage: number;
}): GeminiOfficialDocPdfOutput {
  const groupLength = options.endPage - options.startPage + 1;

  return {
    ...options.output,
    pages: options.output.pages.map((page, index) => ({
      ...page,
      pageNumber: options.startPage + Math.min(index, groupLength - 1),
    })),
  };
}

function mergeGeminiOutputs(
  outputs: readonly GeminiOfficialDocPdfOutput[]
): GeminiOfficialDocPdfOutput {
  const pageMap = new Map<number, z.infer<typeof GeminiOfficialDocPageSchema>>();
  for (const output of outputs) {
    for (const page of output.pages) {
      const existing = pageMap.get(page.pageNumber);
      pageMap.set(page.pageNumber, {
        pageNumber: page.pageNumber,
        blocks: existing ? [...existing.blocks, ...page.blocks] : page.blocks,
      });
    }
  }
  return {
    pages: Array.from(pageMap.values()).sort(
      (left, right) => left.pageNumber - right.pageNumber
    ),
    warnings: outputs.flatMap((output) => output.warnings ?? []),
  };
}

async function generateGeminiOfficialDocOutput(options: {
  inputPath: string;
  pageRangeLabel: string;
  targetModelId: string;
  mode: GeminiOfficialDocExtractionMode;
  pageCount: number;
}): Promise<{ output: GeminiOfficialDocPdfOutput; model: string }> {
  const buffer = await readFile(options.inputPath);
  const pdfDataUri = `data:application/pdf;base64,${buffer.toString('base64')}`;
  const baseRequest = {
    model: modelRefFor(options.targetModelId),
    system:
      'You convert born-digital Japanese public PDFs into compact, page-located JSON for a document conversion evaluation harness. Return only facts visible in the PDF.',
    prompt: [
      {
        text:
          options.mode === 'tables'
            ? `Read this PDF directly. It contains ${options.pageRangeLabel}. Return JSON only. Extract only visible table rows and table-like label/value rows into pages[].blocks. Use kind="table" for every extracted row. Put row cells in text separated by tabs. Include no prose, headings, summaries, inferred rows, or markdown fences. If a page has no visible table-like rows, return that page with an empty blocks array.`
            : `Read this PDF directly. It contains ${options.pageRangeLabel}. Preserve the original page numbers in pages[].pageNumber. Return JSON with pages[].blocks in reading order. Use heading for titles, chapters, sections, article headings, and labeled form rows. Use table for each visible table row; put the row cells in text separated by tabs and include tableIndex and rowIndex. Use paragraph for normal prose, image_text for visible text embedded in figures, and note for marginal notes. Do not infer missing values, do not summarize, and do not include markdown fences.`,
      },
      {
        media: {
          url: pdfDataUri,
          contentType: 'application/pdf',
        },
      },
    ],
    config: {
      temperature: 0,
      maxOutputTokens: 32768,
    },
  };

  const attempts: string[] = [];
  let response: GeminiGenerateResponse | undefined;

  try {
    response = await ai.generate({
      ...baseRequest,
      output: {
        schema: GeminiOfficialDocPdfOutputSchema,
        constrained: true,
      },
    });
  } catch (error) {
    attempts.push(
      `constrained: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!response) {
    try {
      response = await ai.generate({
        ...baseRequest,
        output: {
          format: 'json',
          schema: GeminiOfficialDocPdfOutputSchema,
          constrained: false,
        },
      });
    } catch (error) {
      attempts.push(
        `json+schema: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (!response) {
    try {
      response = await ai.generate({
        ...baseRequest,
        output: { format: 'json' },
      });
    } catch (error) {
      attempts.push(
        `json: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (!response) {
    throw new Error(`Gemini official-doc-pdf generate failed: ${attempts.join(' | ')}`);
  }

  return {
    output: parseGeminiOfficialDocOutput(response, {
      allowNoVisibleText: options.mode === 'tables',
      emptyPageCount: options.pageCount,
    }),
    model: response.model ?? options.targetModelId,
  };
}

async function extractGeminiOfficialDocPdfWithMode(options: {
  inputPath: string;
  fileName: string;
  totalPages?: number;
  mode: GeminiOfficialDocExtractionMode;
}): Promise<ExtractGeminiOfficialDocPdfResult> {
  const targetModelId =
    process.env.OFFICIAL_DOC_PDF_GEMINI_MODEL ??
    process.env.GEMINI_MODEL ??
    modelId;
  const pageGroupSize = envPositiveInt(
    'OFFICIAL_DOC_PDF_GEMINI_PAGE_GROUP_SIZE',
    1
  );
  const concurrency = envPositiveInt(
    'OFFICIAL_DOC_PDF_GEMINI_CONCURRENCY',
    4
  );
  const attemptsPerGroup = envPositiveInt(
    'OFFICIAL_DOC_PDF_GEMINI_GROUP_ATTEMPTS',
    2
  );
  const totalPages = options.totalPages ?? 1;
  const groups = pageGroups(totalPages, pageGroupSize);
  const startedAt = Date.now();
  let geminiCallCount = 0;

  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), 'official-doc-pdf-gemini-')
  );
  try {
    const groupOutputs = await mapWithConcurrency(
      groups,
      concurrency,
      async (group) => {
        const groupPath = path.join(
          tempDir,
          `pages-${group.startPage}-${group.endPage}.pdf`
        );
        await splitPdfPageGroup({
          inputPath: options.inputPath,
          outputPath: groupPath,
          startPage: group.startPage,
          endPage: group.endPage,
        });
        const pageRangeLabel =
          group.startPage === group.endPage
            ? `original page ${group.startPage}`
            : `original pages ${group.startPage}-${group.endPage}`;
        const generated = await withRetry(attemptsPerGroup, () => {
          geminiCallCount += 1;
          return generateGeminiOfficialDocOutput({
            inputPath: groupPath,
            pageRangeLabel,
            targetModelId,
            mode: options.mode,
            pageCount: group.endPage - group.startPage + 1,
          });
        });
        return {
          ...generated,
          output: remapGroupPageNumbers({
            output: generated.output,
            startPage: group.startPage,
            endPage: group.endPage,
          }),
        };
      }
    );

    const output = mergeGeminiOutputs(
      groupOutputs.map((groupOutput) => groupOutput.output)
    );
    const model =
      groupOutputs.find((groupOutput) => groupOutput.model)?.model ??
      targetModelId;

    if (options.mode === 'full') assertNonEmptyOutput(output);
    return {
      documentIr: buildDocumentIrFromGemini({
        fileName: options.fileName,
        output,
        extractionProvider:
          options.mode === 'tables'
            ? 'gemini-table-assist'
            : 'gemini-direct',
      }),
      model,
      region: location,
      pageGroupSize,
      concurrency,
      attemptsPerGroup,
      pageGroupCount: groups.length,
      geminiCallCount,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function extractGeminiOfficialDocPdf(options: {
  inputPath: string;
  fileName: string;
  totalPages?: number;
}): Promise<ExtractGeminiOfficialDocPdfResult> {
  return extractGeminiOfficialDocPdfWithMode({
    ...options,
    mode: 'full',
  });
}

export async function extractGeminiOfficialDocPdfTables(options: {
  inputPath: string;
  fileName: string;
  totalPages?: number;
}): Promise<ExtractGeminiOfficialDocPdfResult> {
  return extractGeminiOfficialDocPdfWithMode({
    ...options,
    mode: 'tables',
  });
}

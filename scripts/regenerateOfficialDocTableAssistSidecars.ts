import './loadEnv';

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type DocumentIr,
  type DocumentIrBlock,
  safeParseDocumentIr,
} from '../src/eval/conversion/documentIr';
import {
  dispatchPdfExtraction,
  PDF_SUBTYPE_PRE_FLIGHT_CONFIGS,
} from '../src/lib/extractors/pdfExtractionDispatcher';
import { officialDocTableAssistModelId } from '../src/lib/extractors/officialDocPdfTableAssist/extractTables';
import type { TableAssistSummary } from '../src/lib/extractors/officialDocPdfTableAssist';
import { isCellGroundedInPageText } from '../src/eval/conversion/tableCellGrounding';

const FIXTURE_ROOT_DIR = path.resolve(
  process.cwd(),
  'sample-data/document-conversion/official-doc-pdf'
);

const TABLE_ASSIST_STABLE_FIXTURES = [
  'mhlw-labor-conditions-notice-general',
] as const;

type TableAssistStableFixture = (typeof TABLE_ASSIST_STABLE_FIXTURES)[number];

type CliOptions = {
  fixtures: TableAssistStableFixture[];
  outPath: string;
  pretty: boolean;
  ci: boolean;
};

type ContentNeutralFailure = {
  pageNumber: number;
  blockId: string;
  cell: string;
};

type RegeneratedFixture = {
  documentId: TableAssistStableFixture;
  pdfPath: string;
  sidecarPath: string;
  textContentSha256: string;
  pageTextSha256: string;
  tableAssist: TableAssistSummary;
  contentNeutral: {
    passed: boolean;
    tableAssistBlockCount: number;
    groundedCellCount: number;
    ungroundedCells: ContentNeutralFailure[];
  };
};

type RegenerationReport = {
  schemaVersion: 1;
  generatedAt: string;
  mode: 'official-doc-table-assist-sidecar-refresh';
  liveCalls: true;
  productionAsyncIngest: false;
  model: string;
  fixtureRoot: string;
  fixtures: RegeneratedFixture[];
};

function isTableAssistStableFixture(
  value: string
): value is TableAssistStableFixture {
  return (TABLE_ASSIST_STABLE_FIXTURES as readonly string[]).includes(value);
}

function parseArgs(argv: string[]): CliOptions {
  const fixtures: TableAssistStableFixture[] = [];
  let outPath = 'tmp/official-doc-table-assist-sidecar-refresh-report.json';
  let pretty = true;
  let ci = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--fixture') {
      const next = argv[index + 1];
      if (!next) throw new Error('--fixture requires a document id');
      if (!isTableAssistStableFixture(next)) {
        throw new Error(
          `Unknown table-assist stable fixture "${next}". Known: ${TABLE_ASSIST_STABLE_FIXTURES.join(
            ', '
          )}`
        );
      }
      fixtures.push(next);
      index += 1;
      continue;
    }
    if (arg === '--out') {
      const next = argv[index + 1];
      if (!next) throw new Error('--out requires a file path');
      outPath = next;
      index += 1;
      continue;
    }
    if (arg === '--ci') {
      ci = true;
      continue;
    }
    if (arg === '--no-pretty') {
      pretty = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    fixtures:
      fixtures.length > 0 ? fixtures : [...TABLE_ASSIST_STABLE_FIXTURES],
    outPath,
    pretty,
    ci,
  };
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function buildPageTextFingerprint(
  pageTexts: { pageNumber: number; text: string }[]
): string {
  return sha256(
    pageTexts
      .map((page) => `${page.pageNumber}\u0000${page.text}`)
      .join('\u0001')
  );
}

function isTableAssistBlock(block: DocumentIrBlock): boolean {
  return (
    block.kind === 'table' &&
    block.metadata?.tableAssist === true &&
    block.metadata?.extractionProvider === 'gemini-table-assist'
  );
}

function checkContentNeutral(options: {
  documentIr: DocumentIr;
  pageTexts: { pageNumber: number; text: string }[];
}): RegeneratedFixture['contentNeutral'] {
  const rawTextByPage = new Map(
    options.pageTexts.map((page) => [page.pageNumber, page.text])
  );
  const ungroundedCells: ContentNeutralFailure[] = [];
  let tableAssistBlockCount = 0;
  let groundedCellCount = 0;

  for (const page of options.documentIr.pages) {
    const rawPageText = rawTextByPage.get(page.pageNumber) ?? '';
    for (const block of page.blocks) {
      if (!isTableAssistBlock(block)) continue;
      tableAssistBlockCount += 1;
      const cells = block.text.split('\t').map((cell) => cell.trim());
      for (const cell of cells) {
        if (cell.length === 0) continue;
        if (isCellGroundedInPageText(rawPageText, cell)) {
          groundedCellCount += 1;
        } else {
          ungroundedCells.push({
            pageNumber: page.pageNumber,
            blockId: block.blockId,
            cell,
          });
        }
      }
    }
  }

  return {
    passed: ungroundedCells.length === 0,
    tableAssistBlockCount,
    groundedCellCount,
    ungroundedCells,
  };
}

async function regenerateOne(
  documentId: TableAssistStableFixture
): Promise<RegeneratedFixture> {
  const pdfPath = path.join(FIXTURE_ROOT_DIR, `${documentId}.pdf`);
  const sidecarPath = path.join(FIXTURE_ROOT_DIR, `${documentId}.document-ir.json`);
  const officialDocOnlyConfig = PDF_SUBTYPE_PRE_FLIGHT_CONFIGS.filter(
    (config) => config.flagId === 'pdf-conversion-subtype-1'
  );
  if (officialDocOnlyConfig.length !== 1) {
    throw new Error('Expected exactly one official-doc-pdf preflight config');
  }

  const outcome = await dispatchPdfExtraction({
    buffer: await readFile(pdfPath),
    fileName: path.basename(pdfPath),
    isFlagEnabled: async (flagId) =>
      flagId === 'pdf-conversion-subtype-1' || flagId === 'pdf-table-assist',
    configs: officialDocOnlyConfig,
    tableAssistMode: 'async',
  });

  if (!outcome.ok) {
    throw new Error(
      `${documentId}: extraction failed: ${JSON.stringify(outcome.failure)}`
    );
  }

  const tableAssist = outcome.result.conversion.tableAssist;
  if (!tableAssist) {
    throw new Error(`${documentId}: table-assist summary missing`);
  }
  if (tableAssist.status !== 'merged' || tableAssist.rowsMerged === 0) {
    throw new Error(
      `${documentId}: table-assist did not merge rows: ${JSON.stringify(
        tableAssist
      )}`
    );
  }

  const parsed = safeParseDocumentIr(outcome.result.documentIr);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`${documentId}: regenerated DocumentIR failed schema: ${issues}`);
  }

  const contentNeutral = checkContentNeutral({
    documentIr: parsed.data,
    pageTexts: outcome.result.pageTexts ?? [],
  });
  if (!contentNeutral.passed) {
    throw new Error(
      `${documentId}: table-assist content-neutral check failed: ${JSON.stringify(
        contentNeutral.ungroundedCells
      )}`
    );
  }

  await writeFile(sidecarPath, `${JSON.stringify(parsed.data, null, 2)}\n`, 'utf8');

  return {
    documentId,
    pdfPath: path.relative(process.cwd(), pdfPath),
    sidecarPath: path.relative(process.cwd(), sidecarPath),
    textContentSha256: sha256(outcome.result.textContent),
    pageTextSha256: buildPageTextFingerprint(outcome.result.pageTexts ?? []),
    tableAssist,
    contentNeutral,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  process.env.GOOGLE_CLOUD_LOCATION ??= 'global';

  const fixtures: RegeneratedFixture[] = [];
  for (const fixture of options.fixtures) {
    fixtures.push(await regenerateOne(fixture));
  }

  const report: RegenerationReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: 'official-doc-table-assist-sidecar-refresh',
    liveCalls: true,
    productionAsyncIngest: false,
    model: officialDocTableAssistModelId,
    fixtureRoot: path.relative(process.cwd(), FIXTURE_ROOT_DIR),
    fixtures,
  };

  const outPath = path.resolve(options.outPath);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    `${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`,
    'utf8'
  );
  process.stdout.write(`${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`);

  if (options.ci) {
    const failures = fixtures.filter((fixture) => !fixture.contentNeutral.passed);
    if (failures.length > 0) {
      process.exitCode = 1;
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

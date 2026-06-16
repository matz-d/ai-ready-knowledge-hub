import './loadEnv';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DocumentIr, DocumentIrBlock } from '../src/eval/conversion/documentIr';

const FIXTURE_ROOT_DIR = path.resolve(
  process.cwd(),
  'sample-data/document-conversion/official-doc-pdf'
);

const MAINLINE_FIXTURES = [
  {
    documentId: 'mhlw-labor-conditions-notice-general',
    label: 'labor',
    expectedObservation: 'report-only',
  },
  {
    documentId: 'mhlw-overtime-limit-guide',
    label: 'overtime',
    expectedObservation: 'merge-candidate',
  },
  {
    documentId: 'mhlw-r07-model-work-rules',
    label: 'model',
    expectedObservation: 'merge-candidate',
  },
] as const;

type MainlineFixtureDefinition = (typeof MAINLINE_FIXTURES)[number];

type CliOptions = {
  outPath: string;
  artifactDir: string;
  pretty: boolean;
  ci: boolean;
  requireMerge: boolean;
  requireFailSoft: boolean;
  onlyDocumentIds: string[];
};

type ContentNeutralCellFailure = {
  pageNumber: number;
  blockId: string;
  cell: string;
};

type ContentNeutralCheck = {
  passed: boolean;
  tableAssistBlockCount: number;
  groundedCellCount: number;
  ungroundedCells: ContentNeutralCellFailure[];
};

type HarnessFixtureSuccess = {
  documentId: string;
  label: string;
  fixturePath: string;
  liveDocumentIrPath: string;
  extractionFailed: false;
  expectedObservation: MainlineFixtureDefinition['expectedObservation'];
  durationMs: number;
  textContentSha256: string;
  pageTextSha256: string;
  tableAssist: {
    status: 'disabled' | 'skipped' | 'merged';
    candidatePageCount: number;
    pagesProcessed: number;
    pagesFailed: number;
    rawRowCount: number;
    rowsMerged: number;
    rowsRejected: number;
    reason?: string;
    elapsedMs: number;
  } | null;
  observed: {
    merge: boolean;
    failSoft: boolean;
  };
  contentNeutral: ContentNeutralCheck;
};

type HarnessFixtureFailure = {
  documentId: string;
  label: string;
  fixturePath: string;
  extractionFailed: true;
  errorName: string;
  errorMessage: string;
};

type HarnessReport = {
  schemaVersion: 1;
  generatedAt: string;
  mode: 'official-doc-table-assist-mainline-harness';
  liveCalls: true;
  productionAsyncIngest: false;
  region: 'global';
  model: string;
  flagReaderMode: 'always-true-official-doc-only-config';
  fixturesRequested: string[];
  safety: {
    fixtureRoot: string;
    customerDataAllowed: false;
    note: string;
  };
  summary: {
    fixtureCount: number;
    succeededFixtureCount: number;
    failedFixtureCount: number;
    mergedFixtureCount: number;
    failSoftFixtureCount: number;
    contentNeutralFailures: number;
    durationMs: number;
  };
  fixtures: HarnessFixtureSuccess[];
  failedFixtures: HarnessFixtureFailure[];
};

function parseArgs(argv: string[]): CliOptions {
  let outPath = 'tmp/official-doc-table-assist-mainline-harness-report.json';
  let artifactDir = 'tmp/official-doc-table-assist-mainline-harness-artifacts';
  let pretty = true;
  let ci = false;
  let requireMerge = false;
  let requireFailSoft = false;
  const onlyDocumentIds: string[] = [];

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
    if (arg === '--artifact-dir') {
      const next = argv[index + 1];
      if (!next) throw new Error('--artifact-dir requires a directory path');
      artifactDir = next;
      index += 1;
      continue;
    }
    if (arg === '--fixture') {
      const next = argv[index + 1];
      if (!next) throw new Error('--fixture requires a document id');
      onlyDocumentIds.push(next);
      index += 1;
      continue;
    }
    if (arg === '--ci') {
      ci = true;
      continue;
    }
    if (arg === '--require-merge') {
      requireMerge = true;
      continue;
    }
    if (arg === '--require-fail-soft') {
      requireFailSoft = true;
      continue;
    }
    if (arg === '--no-pretty') {
      pretty = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    outPath,
    artifactDir,
    pretty,
    ci,
    requireMerge,
    requireFailSoft,
    onlyDocumentIds,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function selectedFixtures(options: CliOptions): MainlineFixtureDefinition[] {
  if (options.onlyDocumentIds.length === 0) return [...MAINLINE_FIXTURES];
  const selected = new Set(options.onlyDocumentIds);
  const fixtures = MAINLINE_FIXTURES.filter((fixture) =>
    selected.has(fixture.documentId)
  );
  const missing = [...selected].filter(
    (documentId) =>
      !MAINLINE_FIXTURES.some((fixture) => fixture.documentId === documentId)
  );
  if (missing.length > 0) {
    throw new Error(
      `Unknown official-doc table-assist fixture: ${missing.join(', ')}`
    );
  }
  return fixtures;
}

function isTableAssistBlock(block: DocumentIrBlock): boolean {
  return (
    block.kind === 'table' &&
    block.metadata?.tableAssist === true &&
    block.metadata?.extractionProvider === 'gemini-table-assist'
  );
}

function pageTextByPage(
  pageTexts: { pageNumber: number; text: string }[]
): Map<number, string> {
  return new Map(pageTexts.map((page) => [page.pageNumber, page.text]));
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

function checkContentNeutral(options: {
  documentIr: DocumentIr;
  pageTexts: { pageNumber: number; text: string }[];
  isCellGroundedInPageText: (pageText: string, cell: string) => boolean;
}): ContentNeutralCheck {
  const rawTextByPage = pageTextByPage(options.pageTexts);
  const ungroundedCells: ContentNeutralCellFailure[] = [];
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
        if (options.isCellGroundedInPageText(rawPageText, cell)) {
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

function isFailSoftSummary(
  summary: HarnessFixtureSuccess['tableAssist']
): boolean {
  if (!summary) return false;
  if (summary.status !== 'skipped') return false;
  return (
    summary.pagesFailed > 0 ||
    summary.reason?.includes('failed') === true ||
    summary.reason?.includes('could not be split') === true
  );
}

async function evaluateFixture(
  fixture: MainlineFixtureDefinition,
  options: Pick<CliOptions, 'artifactDir'>,
  runtime: {
    dispatchPdfExtraction: typeof import('../src/lib/extractors/pdfExtractionDispatcher').dispatchPdfExtraction;
    PDF_SUBTYPE_PRE_FLIGHT_CONFIGS: typeof import('../src/lib/extractors/pdfExtractionDispatcher').PDF_SUBTYPE_PRE_FLIGHT_CONFIGS;
    isCellGroundedInPageText: typeof import('../src/eval/conversion/tableCellGrounding').isCellGroundedInPageText;
  }
): Promise<HarnessFixtureSuccess | HarnessFixtureFailure> {
  const fixturePath = path.join(FIXTURE_ROOT_DIR, `${fixture.documentId}.pdf`);
  if (!(await fileExists(fixturePath))) {
    throw new Error(`${fixturePath} is required for table-assist harness`);
  }

  const officialDocOnlyConfig = runtime.PDF_SUBTYPE_PRE_FLIGHT_CONFIGS.filter(
    (config) => config.flagId === 'pdf-conversion-subtype-1'
  );
  if (officialDocOnlyConfig.length !== 1) {
    throw new Error('Expected exactly one official-doc-pdf preflight config');
  }

  const startedAt = Date.now();
  const outcome = await runtime.dispatchPdfExtraction({
    buffer: await readFile(fixturePath),
    fileName: path.basename(fixturePath),
    // Harness-scoped true reader: the config list above is narrowed to subtype-1
    // so this mirrors the requested async+flag-on call without tripping the
    // production subtype mutex on subtype-2/3.
    isFlagEnabled: async () => true,
    configs: officialDocOnlyConfig,
    tableAssistMode: 'async',
  });
  const durationMs = Date.now() - startedAt;

  if (!outcome.ok) {
    return {
      documentId: fixture.documentId,
      label: fixture.label,
      fixturePath,
      extractionFailed: true,
      errorName: outcome.failure.code,
      errorMessage: JSON.stringify(outcome.failure),
    };
  }

  const liveDocumentIrPath = path.join(
    options.artifactDir,
    `${fixture.documentId}.mainline-table-assist.document-ir.json`
  );
  await mkdir(path.dirname(liveDocumentIrPath), { recursive: true });
  await writeFile(
    liveDocumentIrPath,
    `${JSON.stringify(outcome.result.documentIr, null, 2)}\n`,
    'utf8'
  );

  const tableAssist = outcome.result.conversion.tableAssist ?? null;
  const contentNeutral = checkContentNeutral({
    documentIr: outcome.result.documentIr,
    pageTexts: outcome.result.pageTexts ?? [],
    isCellGroundedInPageText: runtime.isCellGroundedInPageText,
  });

  return {
    documentId: fixture.documentId,
    label: fixture.label,
    fixturePath,
    liveDocumentIrPath,
    extractionFailed: false,
    expectedObservation: fixture.expectedObservation,
    durationMs,
    textContentSha256: sha256(outcome.result.textContent),
    pageTextSha256: buildPageTextFingerprint(outcome.result.pageTexts ?? []),
    tableAssist,
    observed: {
      merge: tableAssist?.status === 'merged' && tableAssist.rowsMerged > 0,
      failSoft: isFailSoftSummary(tableAssist),
    },
    contentNeutral,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  process.env.GOOGLE_CLOUD_LOCATION = 'global';
  if (!process.env.OFFICIAL_DOC_TABLE_ASSIST_MODEL) {
    throw new Error(
      'OFFICIAL_DOC_TABLE_ASSIST_MODEL is required for this live Gemini harness'
    );
  }

  const [{ dispatchPdfExtraction, PDF_SUBTYPE_PRE_FLIGHT_CONFIGS }, grounding] =
    await Promise.all([
      import('../src/lib/extractors/pdfExtractionDispatcher'),
      import('../src/eval/conversion/tableCellGrounding'),
    ]);

  const fixtures: HarnessFixtureSuccess[] = [];
  const failedFixtures: HarnessFixtureFailure[] = [];
  const startedAt = Date.now();

  for (const fixture of selectedFixtures(options)) {
    const result = await evaluateFixture(fixture, options, {
      dispatchPdfExtraction,
      PDF_SUBTYPE_PRE_FLIGHT_CONFIGS,
      isCellGroundedInPageText: grounding.isCellGroundedInPageText,
    });
    if (result.extractionFailed) {
      failedFixtures.push(result);
    } else {
      fixtures.push(result);
    }
  }

  const contentNeutralFailures = fixtures.filter(
    (fixture) => !fixture.contentNeutral.passed
  ).length;
  const mergedFixtureCount = fixtures.filter(
    (fixture) => fixture.observed.merge
  ).length;
  const failSoftFixtureCount = fixtures.filter(
    (fixture) => fixture.observed.failSoft
  ).length;

  const report: HarnessReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: 'official-doc-table-assist-mainline-harness',
    liveCalls: true,
    productionAsyncIngest: false,
    region: 'global',
    model: process.env.OFFICIAL_DOC_TABLE_ASSIST_MODEL,
    flagReaderMode: 'always-true-official-doc-only-config',
    fixturesRequested: selectedFixtures(options).map(
      (fixture) => fixture.documentId
    ),
    safety: {
      fixtureRoot: FIXTURE_ROOT_DIR,
      customerDataAllowed: false,
      note: 'Only committed official-doc sample fixtures are read. No production async ingest, upload API, customer data, or credentials are written.',
    },
    summary: {
      fixtureCount: fixtures.length + failedFixtures.length,
      succeededFixtureCount: fixtures.length,
      failedFixtureCount: failedFixtures.length,
      mergedFixtureCount,
      failSoftFixtureCount,
      contentNeutralFailures,
      durationMs: Date.now() - startedAt,
    },
    fixtures,
    failedFixtures,
  };

  await mkdir(path.dirname(options.outPath), { recursive: true });
  await writeFile(
    options.outPath,
    `${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`,
    'utf8'
  );

  console.log(
    [
      `wrote ${options.outPath}`,
      `fixtures=${report.summary.fixtureCount}`,
      `merged=${mergedFixtureCount}`,
      `failSoft=${failSoftFixtureCount}`,
      `contentNeutralFailures=${contentNeutralFailures}`,
      `durationMs=${report.summary.durationMs}`,
    ].join(' ')
  );

  const ciFailures: string[] = [];
  if (failedFixtures.length > 0) {
    ciFailures.push(`${failedFixtures.length} fixture(s) failed extraction`);
  }
  if (contentNeutralFailures > 0) {
    ciFailures.push(
      `${contentNeutralFailures} fixture(s) failed content-neutral check`
    );
  }
  if (options.requireMerge && mergedFixtureCount === 0) {
    ciFailures.push('no merge case observed');
  }
  if (options.requireFailSoft && failSoftFixtureCount === 0) {
    ciFailures.push('no fail-soft case observed');
  }

  if (options.ci && ciFailures.length > 0) {
    console.error(`table-assist harness failed: ${ciFailures.join('; ')}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

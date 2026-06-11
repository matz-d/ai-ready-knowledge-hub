import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildP1dQualityReport,
  evaluateP1dFixture,
  listFailedDeterministicZeroChecks,
  P1dExpectedFixtureSchema,
  type P1dExpectedFixture,
  type P1dFixtureQualityResult,
  type P1dSkippedFixture,
} from '../src/eval/conversion/p1dQualityGate';
import {
  documentIrToKnowledgeChunks,
  parseDocumentIr,
  type DocumentIr,
  type DocumentSourceSubtype,
} from '../src/eval/conversion';

const FIXTURE_ROOT_DIR = path.resolve(
  process.cwd(),
  'sample-data/document-conversion'
);

type P1dStableFixtureDefinition = {
  directory: string;
  documentId: string;
  sourceSubtype: Extract<
    DocumentSourceSubtype,
    'official-doc-pdf' | 'scan-pdf' | 'slide-pdf'
  >;
  isPublicDocument: boolean;
  expectedRequired?: boolean;
  stableSidecarRequired?: boolean;
  skipReason?: string;
};

const STABLE_FIXTURES = [
  {
    directory: 'official-doc-pdf',
    documentId: 'mhlw-labor-conditions-notice-general',
    sourceSubtype: 'official-doc-pdf',
    isPublicDocument: true,
    expectedRequired: true,
  },
  {
    directory: 'official-doc-pdf',
    documentId: 'mhlw-overtime-limit-guide',
    sourceSubtype: 'official-doc-pdf',
    isPublicDocument: true,
    expectedRequired: true,
  },
  {
    directory: 'official-doc-pdf',
    documentId: 'mhlw-r07-model-work-rules',
    sourceSubtype: 'official-doc-pdf',
    isPublicDocument: true,
    expectedRequired: true,
  },
  {
    directory: 'official-doc-pdf',
    documentId: 'synthetic-employment-context-with-pii',
    sourceSubtype: 'official-doc-pdf',
    isPublicDocument: false,
    expectedRequired: true,
  },
  {
    directory: 'scan-pdf',
    documentId: 'mhlw-labor-conditions-notice-blank-scan',
    sourceSubtype: 'scan-pdf',
    isPublicDocument: true,
    expectedRequired: true,
  },
  {
    directory: 'scan-pdf',
    documentId: 'nta-withholding-form-blank-scan',
    sourceSubtype: 'scan-pdf',
    isPublicDocument: true,
    expectedRequired: true,
  },
  {
    directory: 'scan-pdf',
    documentId: 'synthetic-employment-form-scan',
    sourceSubtype: 'scan-pdf',
    isPublicDocument: false,
    expectedRequired: true,
  },
  {
    directory: 'scan-pdf',
    documentId: 'synthetic-invoice-with-pii-scan',
    sourceSubtype: 'scan-pdf',
    isPublicDocument: false,
    expectedRequired: true,
  },
  {
    directory: 'scan-pdf',
    documentId: 'synthetic-unmaskable-pii-scan',
    sourceSubtype: 'scan-pdf',
    isPublicDocument: false,
    stableSidecarRequired: false,
    skipReason:
      'live-smoke-only fixture; no committed DocumentIR sidecar by design',
  },
  {
    directory: 'slide-pdf',
    documentId: 'synthetic-context-package-deck',
    sourceSubtype: 'slide-pdf',
    isPublicDocument: false,
    expectedRequired: true,
  },
] as const satisfies readonly P1dStableFixtureDefinition[];

type CliOptions = {
  outPath: string;
  pretty: boolean;
  ci: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  let outPath = 'tmp/p1d-quality-report.json';
  let pretty = true;
  let ci = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }
    if (arg === '--out') {
      const next = argv[index + 1];
      if (!next) throw new Error('--out requires a file path');
      outPath = next;
      index += 1;
      continue;
    }
    if (arg === '--no-pretty') {
      pretty = false;
      continue;
    }
    if (arg === '--ci') {
      ci = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { outPath, pretty, ci };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadDocumentIr(
  fixture: P1dStableFixtureDefinition
): Promise<DocumentIr> {
  const filePath = path.resolve(
    FIXTURE_ROOT_DIR,
    fixture.directory,
    `${fixture.documentId}.document-ir.json`
  );
  const raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  const documentIr = parseDocumentIr(raw);
  if (documentIr.source.sourceSubtype !== fixture.sourceSubtype) {
    throw new Error(
      `${fixture.documentId}.document-ir.json sourceSubtype must be "${fixture.sourceSubtype}", got "${documentIr.source.sourceSubtype}"`
    );
  }
  return documentIr;
}

async function loadExpected(
  fixture: P1dStableFixtureDefinition
): Promise<P1dExpectedFixture | undefined> {
  const filePath = path.resolve(
    FIXTURE_ROOT_DIR,
    fixture.directory,
    `${fixture.documentId}.expected.json`
  );
  if (!(await fileExists(filePath))) {
    if (fixture.expectedRequired) {
      throw new Error(`${fixture.documentId}.expected.json is required`);
    }
    return undefined;
  }

  const raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  const expected = P1dExpectedFixtureSchema.parse(raw);
  if (expected.documentId !== fixture.documentId) {
    throw new Error(
      `${fixture.documentId}.expected.json documentId must be "${fixture.documentId}", got "${expected.documentId}"`
    );
  }
  return expected;
}

function makeSkippedFixture(
  fixture: P1dStableFixtureDefinition,
  reason: string
): P1dSkippedFixture {
  return {
    documentId: fixture.documentId,
    fixturePath: path.join(
      'sample-data/document-conversion',
      fixture.directory,
      `${fixture.documentId}.pdf`
    ),
    sourceSubtype: fixture.sourceSubtype,
    reason,
  };
}

async function evaluateStableFixture(
  fixture: P1dStableFixtureDefinition
): Promise<P1dFixtureQualityResult | P1dSkippedFixture> {
  if (fixture.stableSidecarRequired === false) {
    return makeSkippedFixture(
      fixture,
      fixture.skipReason ?? 'stable sidecar is not available'
    );
  }

  const irPath = path.resolve(
    FIXTURE_ROOT_DIR,
    fixture.directory,
    `${fixture.documentId}.document-ir.json`
  );
  if (!(await fileExists(irPath))) {
    return makeSkippedFixture(fixture, 'committed DocumentIR sidecar missing');
  }

  const documentIr = await loadDocumentIr(fixture);
  const expected = await loadExpected(fixture);
  const extractorInput = `${fixture.documentId}-fixture-bytes`;
  const chunks = documentIrToKnowledgeChunks({
    documentIr,
    docId: fixture.documentId,
    extractorInput,
    documentSensitivity: 'Internal',
    documentAiUsePolicy: 'direct',
    title: documentIr.source.fileName,
  });

  return evaluateP1dFixture({
    documentId: fixture.documentId,
    fixturePath: path.join(
      'sample-data/document-conversion',
      fixture.directory,
      `${fixture.documentId}.document-ir.json`
    ),
    sourceSubtype: fixture.sourceSubtype,
    isPublicDocument: fixture.isPublicDocument,
    documentIr,
    chunks,
    expected,
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const evaluated: P1dFixtureQualityResult[] = [];
  const skipped: P1dSkippedFixture[] = [];

  for (const fixture of STABLE_FIXTURES) {
    const result = await evaluateStableFixture(fixture);
    if ('metrics' in result) {
      evaluated.push(result);
    } else {
      skipped.push(result);
    }
  }

  const report = buildP1dQualityReport(evaluated, skipped);
  const json = JSON.stringify(report, null, options.pretty ? 2 : 0);
  const outPath = path.resolve(options.outPath);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${json}\n`, 'utf8');
  process.stdout.write(`${json}\n`);

  if (options.ci) {
    const failedChecks = listFailedDeterministicZeroChecks(report);
    if (failedChecks.length > 0) {
      for (const check of failedChecks) {
        process.stderr.write(
          `P1-D CI blocker failed: ${check.metric} expected ${check.expected}, got ${check.actual}\n`
        );
      }
      process.exit(1);
    }
    process.stderr.write(
      'P1-D CI blockers passed: all deterministic zero checks are 0\n'
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

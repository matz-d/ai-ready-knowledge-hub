import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ConversionEvalStageSchema,
  documentIrToKnowledgeChunks,
  parseDocumentIr,
  runConversionEvalGoldenCheck,
  runConversionEvalHealthCheck,
  toHeuristicCiAxisStatuses,
  type ConversionEvalResult,
  type ConversionEvalStage,
  type DocumentIr,
  type HeuristicCiAxisStatuses,
} from '../src/eval/conversion';
import { runConversionEvalHeuristic } from '../src/eval/conversion/heuristic';
import {
  KnowledgeChunkSchema,
  validateKnowledgeChunkInvariants,
} from '../src/lib/knowledgeChunkSchema';

const FIXTURE_ROOT_DIR = path.resolve(
  process.cwd(),
  'sample-data/document-conversion'
);

const FIXTURES = [
  {
    directory: 'official-doc-pdf',
    documentId: 'mhlw-overtime-limit-guide',
    sourceSubtype: 'official-doc-pdf',
  },
  {
    directory: 'official-doc-pdf',
    documentId: 'mhlw-r07-model-work-rules',
    sourceSubtype: 'official-doc-pdf',
  },
  {
    directory: 'official-doc-pdf',
    documentId: 'mhlw-labor-conditions-notice-general',
    sourceSubtype: 'official-doc-pdf',
  },
  {
    directory: 'official-doc-pdf',
    documentId: 'synthetic-employment-context-with-pii',
    sourceSubtype: 'official-doc-pdf',
  },
  {
    directory: 'slide-pdf',
    documentId: 'synthetic-context-package-deck',
    sourceSubtype: 'slide-pdf',
  },
] as const;

type FixtureDefinition = (typeof FIXTURES)[number];
type FixtureDocumentId = FixtureDefinition['documentId'];

type ExpectedFieldsFixture = {
  documentId: string;
  expectedFields: string[];
  notes?: string;
};

type CliOptions = {
  stage: ConversionEvalStage;
  outPath?: string;
  pretty: boolean;
};

type FixtureEvaluation = {
  documentId: FixtureDocumentId;
  overallStatus: ConversionEvalResult['overall']['status'];
  overallReasons: readonly string[];
  heuristicAxisStatuses?: HeuristicCiAxisStatuses;
  result: ConversionEvalResult;
};

type AxisSummary = {
  pass: number;
  warn: number;
  fail: number;
};

type ConversionEvalCiReport = {
  stage: ConversionEvalStage;
  dlpDryRun: boolean;
  generatedAt: string;
  fixtureCount: number;
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
  heuristicAxisSummary?: {
    coverage: AxisSummary;
    locator_quality: AxisSummary;
    safety_readiness: AxisSummary;
  };
  fixtures: FixtureEvaluation[];
};

type ChunkSchemaValidity = {
  passed: boolean;
  errors: string[];
};

function createEmptyAxisSummary(): AxisSummary {
  return { pass: 0, warn: 0, fail: 0 };
}

function parseArgs(argv: string[]): CliOptions {
  let stage: ConversionEvalStage | undefined;
  let outPath: string | undefined;
  let pretty = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--stage') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('--stage requires one of: health | heuristic | golden');
      }
      stage = ConversionEvalStageSchema.parse(next);
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
    if (arg === '--no-pretty') {
      pretty = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!stage) {
    throw new Error('Missing required --stage (health | heuristic | golden)');
  }

  return { stage, outPath, pretty };
}

async function loadDocumentIr(fixture: FixtureDefinition): Promise<DocumentIr> {
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

async function loadExpectedFields(
  fixture: FixtureDefinition
): Promise<ExpectedFieldsFixture> {
  const filePath = path.resolve(
    FIXTURE_ROOT_DIR,
    fixture.directory,
    `${fixture.documentId}.expected.json`
  );
  const raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  const parsed = raw as Partial<ExpectedFieldsFixture>;
  if (parsed.documentId !== fixture.documentId) {
    throw new Error(
      `${fixture.documentId}.expected.json documentId must be "${fixture.documentId}", got "${parsed.documentId}"`
    );
  }
  if (!Array.isArray(parsed.expectedFields)) {
    throw new Error(
      `${fixture.documentId}.expected.json expectedFields must be an array`
    );
  }
  return {
    documentId: parsed.documentId,
    expectedFields: parsed.expectedFields,
    notes: parsed.notes,
  };
}

function resolveDlpDryRun(): boolean {
  if (process.env.DLP_DRY_RUN === undefined) {
    return true;
  }
  return process.env.DLP_DRY_RUN === 'true';
}

function evaluateChunkSchemaValidity(
  chunks: ReturnType<typeof documentIrToKnowledgeChunks>,
  docId: string,
  extractorInput: string
): ChunkSchemaValidity {
  const errors: string[] = [];

  chunks.forEach((chunk, index) => {
    const parsed = KnowledgeChunkSchema.safeParse(chunk);
    if (!parsed.success) {
      errors.push(
        `chunk[${index}] schema parse failed: ${parsed.error.issues
          .map((issue) => issue.message)
          .join('; ')}`
      );
      return;
    }

    const invariantResult = validateKnowledgeChunkInvariants(parsed.data, {
      parentDocument: {
        id: docId,
        status: 'curated',
      },
      extractorInput,
    });
    if (!invariantResult.ok) {
      errors.push(
        `chunk[${index}] invariant failed: ${invariantResult.errors.join('; ')}`
      );
    }
  });

  return {
    passed: errors.length === 0,
    errors,
  };
}

async function evaluateFixture(
  stage: ConversionEvalStage,
  fixture: FixtureDefinition,
  dlpDryRun: boolean
): Promise<FixtureEvaluation> {
  const documentIr = await loadDocumentIr(fixture);
  const extractorInput = `${fixture.documentId}-fixture-bytes`;
  const chunks = documentIrToKnowledgeChunks({
    documentIr,
    docId: fixture.documentId,
    extractorInput,
    documentSensitivity: 'Internal',
    documentAiUsePolicy: 'direct',
    title: documentIr.source.fileName,
  });

  const schemaValidity = evaluateChunkSchemaValidity(
    chunks,
    fixture.documentId,
    extractorInput
  );
  let result: ConversionEvalResult;

  if (stage === 'health') {
    result = runConversionEvalHealthCheck({
      sourceSubtype: fixture.sourceSubtype,
      chunkDrafts: chunks.map((chunk) => ({ text: chunk.text })),
      schemaValidity,
    });
  } else if (stage === 'heuristic') {
    result = await runConversionEvalHeuristic({
      documentIr,
      chunks,
      schemaValidity,
      safetyReadinessOptions: { dryRun: dlpDryRun },
    });
  } else {
    const expected = await loadExpectedFields(fixture);
    result = await runConversionEvalGoldenCheck({
      sourceSubtype: fixture.sourceSubtype,
      documentIr,
      chunks,
      expectedFields: expected.expectedFields,
      schemaValidity,
      safetyReadinessOptions: { dryRun: dlpDryRun },
    });
  }

  return {
    documentId: fixture.documentId,
    overallStatus: result.overall.status,
    overallReasons: result.overall.reasons,
    heuristicAxisStatuses:
      stage === 'heuristic'
        ? toHeuristicCiAxisStatuses(result, fixture.sourceSubtype)
        : undefined,
    result,
  };
}

async function runConversionEvalForCi(
  options: CliOptions
): Promise<ConversionEvalCiReport> {
  const dlpDryRun = resolveDlpDryRun();
  const fixtures = await Promise.all(
    FIXTURES.map((fixture) =>
      evaluateFixture(options.stage, fixture, dlpDryRun)
    )
  );

  const summary = fixtures.reduce(
    (acc, fixture) => {
      acc[fixture.overallStatus] += 1;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0 }
  );

  const heuristicAxisSummary =
    options.stage === 'heuristic'
      ? fixtures.reduce(
          (acc, fixture) => {
            if (!fixture.heuristicAxisStatuses) {
              return acc;
            }

            const coverageStatus = fixture.heuristicAxisStatuses.coverage;
            const locatorQualityStatus =
              fixture.heuristicAxisStatuses.locator_quality;
            const safetyReadinessStatus =
              fixture.heuristicAxisStatuses.safety_readiness;

            acc.coverage[coverageStatus] += 1;
            acc.locator_quality[locatorQualityStatus] += 1;
            acc.safety_readiness[safetyReadinessStatus] += 1;
            return acc;
          },
          {
            coverage: createEmptyAxisSummary(),
            locator_quality: createEmptyAxisSummary(),
            safety_readiness: createEmptyAxisSummary(),
          }
        )
      : undefined;

  return {
    stage: options.stage,
    dlpDryRun,
    generatedAt: new Date().toISOString(),
    fixtureCount: fixtures.length,
    summary,
    heuristicAxisSummary,
    fixtures,
  };
}

async function writeOutput(
  report: ConversionEvalCiReport,
  options: CliOptions
): Promise<void> {
  const json = JSON.stringify(report, null, options.pretty ? 2 : 0);
  if (options.outPath) {
    const filePath = path.resolve(options.outPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${json}\n`, 'utf8');
  }
  process.stdout.write(`${json}\n`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await runConversionEvalForCi(options);
  await writeOutput(report, options);

  if (options.stage === 'health' && report.summary.fail > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

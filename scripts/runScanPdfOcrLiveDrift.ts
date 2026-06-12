import './loadEnv';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  documentIrToKnowledgeChunks,
  parseDocumentIr,
  type DocumentIr,
} from '../src/eval/conversion';
import {
  evaluateP1dFixture,
  P1dExpectedFixtureSchema,
  type P1dExpectedFixture,
  type P1dFixtureQualityResult,
  type P1dMeasuredRatio,
} from '../src/eval/conversion/p1dQualityGate';
import { extractScanPdfFromBuffer } from '../src/lib/extractors/scanPdfDocumentExtractor';
import {
  scanPdfGeminiModelId,
  SCAN_PDF_GEMINI_OCR_PROMPT,
  SCAN_PDF_GEMINI_OCR_SYSTEM_PROMPT,
} from '../src/lib/extractors/scanPdfGeminiOcr';

const FIXTURE_ROOT_DIR = path.resolve(
  process.cwd(),
  'sample-data/document-conversion/scan-pdf'
);

const LIVE_DRIFT_FIXTURES = [
  {
    documentId: 'mhlw-labor-conditions-notice-blank-scan',
    isPublicDocument: true,
    evaluation: 'quality',
    piiExpectation: {
      mode: 'report_only',
      reason: 'public blank form; over-detection is observed but not a blocker',
    },
  },
  {
    documentId: 'nta-withholding-form-blank-scan',
    isPublicDocument: true,
    evaluation: 'quality',
    piiExpectation: {
      mode: 'report_only',
      reason: 'public blank form; over-detection is observed but not a blocker',
    },
  },
  {
    documentId: 'synthetic-employment-form-scan',
    isPublicDocument: false,
    evaluation: 'quality',
    piiExpectation: {
      mode: 'must_detect_pii',
      minTotal: 1,
      reason: 'synthetic PII document; OCR must continue noticing PII-like spans',
    },
  },
  {
    documentId: 'synthetic-invoice-with-pii-scan',
    isPublicDocument: false,
    evaluation: 'quality',
    piiExpectation: {
      mode: 'must_detect_pii',
      minTotal: 1,
      reason: 'synthetic PII document; OCR must continue noticing PII-like spans',
    },
  },
  {
    documentId: 'synthetic-unmaskable-pii-scan',
    isPublicDocument: false,
    evaluation: 'safety_only',
    piiExpectation: {
      mode: 'must_detect_unmaskable',
      minUnmaskable: 1,
      reason: 'D-PROD-1 fail-closed probe; unmaskable OCR finding must remain load-bearing',
    },
  },
] as const;

type LiveDriftFixtureDefinition = (typeof LIVE_DRIFT_FIXTURES)[number];

type PiiExpectation = LiveDriftFixtureDefinition['piiExpectation'];

type PiiDirectionCheck = {
  mode: PiiExpectation['mode'];
  passed: boolean;
  ciBlocker: boolean;
  reason: string;
  expected: string;
  observed: {
    total: number;
    maskable: number;
    unmaskable: number;
  };
};

type CliOptions = {
  outPath: string;
  artifactDir: string;
  pretty: boolean;
  ci: boolean;
  allowedRecallDrop: number;
  onlyDocumentIds: string[];
};

type MetricComparison = {
  sidecar: number | null;
  live: number | null;
  delta: number | null;
  measured: boolean;
  missingSidecar: string[];
  missingLive: string[];
  majorDrift: boolean;
};

type LiveDriftFixtureResult = {
  documentId: string;
  fixturePath: string;
  expectedPath: string;
  sidecarPath: string;
  liveDocumentIrPath: string;
  model: string;
  region: string;
  durationMs: number;
  extractionFailed: false;
  sidecar: P1dFixtureQualityResult;
  live: P1dFixtureQualityResult;
  comparison: {
    fieldRecall: MetricComparison;
    coreFieldRecall: MetricComparison;
    valuePrecision: MetricComparison;
    tableCellRecall: MetricComparison;
    locatorCoverage: MetricComparison;
    pageCoverageDelta: number;
    chunkCountDelta: number;
    blockCountDelta: number;
    textDensityWarningDelta: number;
    unmaskablePiiFindings: number;
  };
  piiDirectionCheck: PiiDirectionCheck;
  majorDrift: boolean;
};

type LiveDriftSafetyOnlyFixtureResult = {
  documentId: string;
  fixturePath: string;
  liveDocumentIrPath: string;
  model: string;
  region: string;
  durationMs: number;
  extractionFailed: false;
  evaluation: 'safety_only';
  piiDirectionCheck: PiiDirectionCheck;
};

type LiveDriftFixtureFailure = {
  documentId: string;
  fixturePath: string;
  stage: 'extraction' | 'evaluation';
  extractionFailed: true;
  liveDocumentIrPath?: string;
  errorName: string;
  errorMessage: string;
};

type LiveDriftReport = {
  schemaVersion: 2;
  generatedAt: string;
  mode: 'live';
  liveCalls: true;
  model: string;
  region: string | null;
  promptFingerprint: {
    systemSha256: string;
    userSha256: string;
  };
  thresholds: {
    allowedRecallDrop: number;
  };
  summary: {
    evaluatedFixtureCount: number;
    safetyOnlyFixtureCount: number;
    failedFixtureCount: number;
    majorDriftCount: number;
    unmaskablePiiFindingCount: number;
    piiDirectionFailureCount: number;
    deterministicZeroFailureCount: number;
    durationMs: number;
  };
  fixtures: LiveDriftFixtureResult[];
  safetyOnlyFixtures: LiveDriftSafetyOnlyFixtureResult[];
  failedFixtures: LiveDriftFixtureFailure[];
};

function parseArgs(argv: string[]): CliOptions {
  let outPath = 'tmp/scan-pdf-ocr-live-drift-report.json';
  let artifactDir = 'tmp/scan-pdf-ocr-live-drift-artifacts';
  let pretty = true;
  let ci = false;
  let allowedRecallDrop = 0.05;
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
    if (arg === '--allowed-recall-drop') {
      const next = argv[index + 1];
      if (!next) throw new Error('--allowed-recall-drop requires a number');
      const value = Number(next);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error('--allowed-recall-drop must be a number from 0 to 1');
      }
      allowedRecallDrop = value;
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
    outPath,
    artifactDir,
    pretty,
    ci,
    allowedRecallDrop,
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

function blockCount(documentIr: DocumentIr): number {
  return documentIr.pages.reduce((sum, page) => sum + page.blocks.length, 0);
}

function ratioComparison(
  sidecar: P1dMeasuredRatio,
  live: P1dMeasuredRatio,
  allowedRecallDrop: number
): MetricComparison {
  const measured = sidecar.measured || live.measured;
  const delta =
    sidecar.rate === null || live.rate === null ? null : live.rate - sidecar.rate;
  return {
    sidecar: sidecar.rate,
    live: live.rate,
    delta,
    measured,
    missingSidecar: sidecar.missing,
    missingLive: live.missing,
    majorDrift:
      measured &&
      sidecar.rate !== null &&
      live.rate !== null &&
      live.rate < sidecar.rate - allowedRecallDrop,
  };
}

function deterministicZeroFailureCount(
  fixture: LiveDriftFixtureResult
): number {
  return [
    fixture.live.metrics.safetyObservations.falseMaskedTokenCount,
    fixture.live.metrics.chunkReadiness.emptyChunkCount,
    fixture.live.metrics.chunkReadiness.oversizedChunkCount,
  ].filter((actual) => actual !== 0).length;
}

function piiCounts(
  findings: Awaited<ReturnType<typeof extractScanPdfFromBuffer>>['conversion']['piiFindings']
): PiiDirectionCheck['observed'] {
  return {
    total: findings.length,
    maskable: findings.filter((finding) => finding.maskability === 'maskable')
      .length,
    unmaskable: findings.filter(
      (finding) => finding.maskability === 'unmaskable'
    ).length,
  };
}

function evaluatePiiDirection(
  expectation: PiiExpectation,
  observed: PiiDirectionCheck['observed']
): PiiDirectionCheck {
  switch (expectation.mode) {
    case 'must_detect_unmaskable': {
      const expected = `unmaskable >= ${expectation.minUnmaskable}`;
      return {
        mode: expectation.mode,
        passed: observed.unmaskable >= expectation.minUnmaskable,
        ciBlocker: true,
        reason: expectation.reason,
        expected,
        observed,
      };
    }
    case 'must_detect_pii': {
      const expected = `total >= ${expectation.minTotal}`;
      return {
        mode: expectation.mode,
        passed: observed.total >= expectation.minTotal,
        ciBlocker: true,
        reason: expectation.reason,
        expected,
        observed,
      };
    }
    case 'report_only':
      return {
        mode: expectation.mode,
        passed: true,
        ciBlocker: false,
        reason: expectation.reason,
        expected: 'report-only',
        observed,
      };
    default: {
      const _exhaustive: never = expectation;
      return _exhaustive;
    }
  }
}

async function loadExpected(documentId: string): Promise<P1dExpectedFixture> {
  const expectedPath = path.join(FIXTURE_ROOT_DIR, `${documentId}.expected.json`);
  const raw = JSON.parse(await readFile(expectedPath, 'utf8')) as unknown;
  const expected = P1dExpectedFixtureSchema.parse(raw);
  if (expected.documentId !== documentId) {
    throw new Error(
      `${documentId}.expected.json documentId must be "${documentId}", got "${expected.documentId}"`
    );
  }
  return expected;
}

async function loadSidecar(documentId: string): Promise<DocumentIr> {
  const sidecarPath = path.join(FIXTURE_ROOT_DIR, `${documentId}.document-ir.json`);
  const raw = JSON.parse(await readFile(sidecarPath, 'utf8')) as unknown;
  return parseDocumentIr(raw);
}

function evaluateIr(options: {
  documentId: string;
  fixturePath: string;
  isPublicDocument: boolean;
  documentIr: DocumentIr;
  expected: P1dExpectedFixture;
}): P1dFixtureQualityResult {
  const chunks = documentIrToKnowledgeChunks({
    documentIr: options.documentIr,
    docId: options.documentId,
    extractorInput: `${options.documentId}-scan-pdf-live-drift`,
    documentSensitivity: 'Internal',
    documentAiUsePolicy: 'direct',
    title: options.documentIr.source.fileName,
  });

  return evaluateP1dFixture({
    documentId: options.documentId,
    fixturePath: options.fixturePath,
    sourceSubtype: 'scan-pdf',
    isPublicDocument: options.isPublicDocument,
    documentIr: options.documentIr,
    chunks,
    expected: options.expected,
  });
}

async function evaluateFixture(
  fixture: LiveDriftFixtureDefinition,
  options: Pick<CliOptions, 'allowedRecallDrop' | 'artifactDir'>
): Promise<
  | LiveDriftFixtureResult
  | LiveDriftSafetyOnlyFixtureResult
  | LiveDriftFixtureFailure
> {
  const fixturePath = path.join(FIXTURE_ROOT_DIR, `${fixture.documentId}.pdf`);
  const expectedPath = path.join(
    FIXTURE_ROOT_DIR,
    `${fixture.documentId}.expected.json`
  );
  const sidecarPath = path.join(
    FIXTURE_ROOT_DIR,
    `${fixture.documentId}.document-ir.json`
  );

  const requiredPaths =
    fixture.evaluation === 'quality'
      ? [fixturePath, expectedPath, sidecarPath]
      : [fixturePath];
  for (const requiredPath of requiredPaths) {
    if (!(await fileExists(requiredPath))) {
      throw new Error(`${requiredPath} is required for live drift`);
    }
  }

  const expected =
    fixture.evaluation === 'quality'
      ? await loadExpected(fixture.documentId)
      : undefined;
  const sidecarIr =
    fixture.evaluation === 'quality'
      ? await loadSidecar(fixture.documentId)
      : undefined;
  const sidecar =
    expected && sidecarIr
      ? evaluateIr({
          documentId: fixture.documentId,
          fixturePath: sidecarPath,
          isPublicDocument: fixture.isPublicDocument,
          documentIr: sidecarIr,
          expected,
        })
      : undefined;

  const startedAt = Date.now();
  let extracted: Awaited<ReturnType<typeof extractScanPdfFromBuffer>>;
  try {
    extracted = await extractScanPdfFromBuffer({
      buffer: await readFile(fixturePath),
      fileName: path.basename(fixturePath),
    });
  } catch (error) {
    return {
      documentId: fixture.documentId,
      fixturePath,
      stage: 'extraction',
      extractionFailed: true,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  const durationMs = Date.now() - startedAt;
  const liveDocumentIrPath = path.join(
    options.artifactDir,
    `${fixture.documentId}.live.document-ir.json`
  );
  await mkdir(path.dirname(liveDocumentIrPath), { recursive: true });
  await writeFile(
    liveDocumentIrPath,
    `${JSON.stringify(extracted.documentIr, null, 2)}\n`,
    'utf8'
  );
  const piiDirectionCheck = evaluatePiiDirection(
    fixture.piiExpectation,
    piiCounts(extracted.conversion.piiFindings)
  );

  if (fixture.evaluation === 'safety_only') {
    return {
      documentId: fixture.documentId,
      fixturePath,
      liveDocumentIrPath,
      model: extracted.conversion.model,
      region: extracted.conversion.region,
      durationMs,
      extractionFailed: false,
      evaluation: 'safety_only',
      piiDirectionCheck,
    };
  }

  if (!expected || !sidecarIr || !sidecar) {
    throw new Error(`${fixture.documentId} quality fixture setup is incomplete`);
  }

  let live: P1dFixtureQualityResult;
  try {
    live = evaluateIr({
      documentId: fixture.documentId,
      fixturePath,
      isPublicDocument: fixture.isPublicDocument,
      documentIr: extracted.documentIr,
      expected,
    });
  } catch (error) {
    return {
      documentId: fixture.documentId,
      fixturePath,
      stage: 'evaluation',
      extractionFailed: true,
      liveDocumentIrPath,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  const comparison = {
    fieldRecall: ratioComparison(
      sidecar.metrics.fieldRecall,
      live.metrics.fieldRecall,
      options.allowedRecallDrop
    ),
    coreFieldRecall: ratioComparison(
      sidecar.metrics.coreFieldRecall,
      live.metrics.coreFieldRecall,
      options.allowedRecallDrop
    ),
    valuePrecision: ratioComparison(
      sidecar.metrics.valuePrecision,
      live.metrics.valuePrecision,
      options.allowedRecallDrop
    ),
    tableCellRecall: ratioComparison(
      sidecar.metrics.tableCellRecall,
      live.metrics.tableCellRecall,
      options.allowedRecallDrop
    ),
    locatorCoverage: ratioComparison(
      sidecar.metrics.locatorCoverage,
      live.metrics.locatorCoverage,
      options.allowedRecallDrop
    ),
    pageCoverageDelta:
      live.metrics.pageCoverage - sidecar.metrics.pageCoverage,
    chunkCountDelta:
      live.metrics.chunkReadiness.chunkCount -
      sidecar.metrics.chunkReadiness.chunkCount,
    blockCountDelta: blockCount(extracted.documentIr) - blockCount(sidecarIr),
    textDensityWarningDelta:
      live.metrics.textDensityWarnings.length -
      sidecar.metrics.textDensityWarnings.length,
    unmaskablePiiFindings: piiDirectionCheck.observed.unmaskable,
  };

  const metricComparisons = [
    comparison.fieldRecall,
    comparison.coreFieldRecall,
    comparison.valuePrecision,
    comparison.tableCellRecall,
    comparison.locatorCoverage,
  ];
  const majorDrift = metricComparisons.some((metric) => metric.majorDrift);

  return {
    documentId: fixture.documentId,
    fixturePath,
    expectedPath,
    sidecarPath,
    liveDocumentIrPath,
    model: extracted.conversion.model,
    region: extracted.conversion.region,
    durationMs,
    extractionFailed: false,
    sidecar,
    live,
    comparison,
    piiDirectionCheck,
    majorDrift,
  };
}

function selectedFixtures(options: CliOptions): LiveDriftFixtureDefinition[] {
  if (options.onlyDocumentIds.length === 0) return [...LIVE_DRIFT_FIXTURES];
  const selected = new Set(options.onlyDocumentIds);
  const fixtures = LIVE_DRIFT_FIXTURES.filter((fixture) =>
    selected.has(fixture.documentId)
  );
  const missing = [...selected].filter(
    (documentId) =>
      !LIVE_DRIFT_FIXTURES.some((fixture) => fixture.documentId === documentId)
  );
  if (missing.length > 0) {
    throw new Error(`Unknown scan-pdf live drift fixture: ${missing.join(', ')}`);
  }
  return fixtures;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const fixtures: LiveDriftFixtureResult[] = [];
  const safetyOnlyFixtures: LiveDriftSafetyOnlyFixtureResult[] = [];
  const failedFixtures: LiveDriftFixtureFailure[] = [];

  for (const fixture of selectedFixtures(options)) {
    const result = await evaluateFixture(fixture, options);
    if (result.extractionFailed) {
      failedFixtures.push(result);
    } else if (isSafetyOnlyFixtureResult(result)) {
      safetyOnlyFixtures.push(result);
    } else {
      fixtures.push(result);
    }
  }

  const piiDirectionFailureCount = [
    ...fixtures.map((fixture) => fixture.piiDirectionCheck),
    ...safetyOnlyFixtures.map((fixture) => fixture.piiDirectionCheck),
  ].filter((check) => check.ciBlocker && !check.passed).length;

  const report: LiveDriftReport = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    mode: 'live',
    liveCalls: true,
    model: scanPdfGeminiModelId,
    region: fixtures[0]?.region ?? safetyOnlyFixtures[0]?.region ?? null,
    promptFingerprint: {
      systemSha256: sha256(SCAN_PDF_GEMINI_OCR_SYSTEM_PROMPT),
      userSha256: sha256(SCAN_PDF_GEMINI_OCR_PROMPT),
    },
    thresholds: {
      allowedRecallDrop: options.allowedRecallDrop,
    },
    summary: {
      evaluatedFixtureCount: fixtures.length,
      safetyOnlyFixtureCount: safetyOnlyFixtures.length,
      failedFixtureCount: failedFixtures.length,
      majorDriftCount: fixtures.filter((fixture) => fixture.majorDrift).length,
      unmaskablePiiFindingCount: fixtures.reduce(
        (sum, fixture) => sum + fixture.comparison.unmaskablePiiFindings,
        safetyOnlyFixtures.reduce(
          (sum, fixture) =>
            sum + fixture.piiDirectionCheck.observed.unmaskable,
          0
        )
      ),
      piiDirectionFailureCount,
      deterministicZeroFailureCount: fixtures.reduce(
        (sum, fixture) => sum + deterministicZeroFailureCount(fixture),
        0
      ),
      durationMs: Date.now() - startedAt,
    },
    fixtures,
    safetyOnlyFixtures,
    failedFixtures,
  };

  const json = JSON.stringify(report, null, options.pretty ? 2 : 0);
  const outPath = path.resolve(options.outPath);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${json}\n`, 'utf8');
  process.stdout.write(`${json}\n`);

  if (options.ci) {
    if (report.summary.failedFixtureCount > 0) {
      process.stderr.write(
        `scan-pdf OCR live drift failed: ${report.summary.failedFixtureCount} fixture extraction failure(s)\n`
      );
    }
    if (report.summary.majorDriftCount > 0) {
      process.stderr.write(
        `scan-pdf OCR live drift failed: ${report.summary.majorDriftCount} major drift fixture(s)\n`
      );
    }
    if (report.summary.deterministicZeroFailureCount > 0) {
      process.stderr.write(
        `scan-pdf OCR live drift failed: ${report.summary.deterministicZeroFailureCount} deterministic zero check failure(s)\n`
      );
    }
    if (report.summary.piiDirectionFailureCount > 0) {
      process.stderr.write(
        `scan-pdf OCR live drift failed: ${report.summary.piiDirectionFailureCount} PII direction check failure(s)\n`
      );
    }
    if (
      report.summary.failedFixtureCount > 0 ||
      report.summary.majorDriftCount > 0 ||
      report.summary.deterministicZeroFailureCount > 0 ||
      report.summary.piiDirectionFailureCount > 0
    ) {
      process.exit(1);
    }
    process.stderr.write('scan-pdf OCR live drift passed\n');
  }
}

function isSafetyOnlyFixtureResult(
  result: LiveDriftFixtureResult | LiveDriftSafetyOnlyFixtureResult
): result is LiveDriftSafetyOnlyFixtureResult {
  return 'evaluation' in result && result.evaluation === 'safety_only';
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

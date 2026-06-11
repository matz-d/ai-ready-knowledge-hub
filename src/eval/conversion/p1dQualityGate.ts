import { z } from 'zod';
import { MAX_FIRESTORE_CHUNK_DOCUMENT_BYTES } from '../../lib/knowledgeChunkSchema';
import type { DocumentIr, DocumentSourceSubtype } from './documentIr';
import { evalContextPackageReadiness } from './heuristic/evalContextPackageReadiness';
import { evalCoverage } from './heuristic/evalCoverage';
import { evalSemanticRetention, normalizeForSubstringMatch } from './golden';

export const P1D_QUALITY_REPORT_SCHEMA_VERSION = 3 as const;

const P1dExpectedTierSchema = z.enum(['core', 'extended']);

const P1dExpectedValueSchema = z.object({
  field: z.string().min(1),
  expectedValue: z.string().min(1),
  tier: P1dExpectedTierSchema.optional().default('extended'),
});

const P1dExpectedTableCellSchema = z.object({
  tableId: z.string().min(1).optional(),
  rowLabel: z.string().min(1).optional(),
  columnLabel: z.string().min(1).optional(),
  expectedValue: z.string().min(1),
  tier: P1dExpectedTierSchema.optional().default('extended'),
});

export const P1dExpectedFixtureSchema = z.object({
  documentId: z.string().min(1),
  expectedFields: z.array(z.string().min(1)).optional().default([]),
  expectedFieldTiers: z
    .record(z.string().min(1), P1dExpectedTierSchema)
    .optional()
    .default({}),
  expectedValues: z.array(P1dExpectedValueSchema).optional().default([]),
  expectedTableCells: z
    .array(P1dExpectedTableCellSchema)
    .optional()
    .default([]),
  notes: z.string().optional(),
});

export type P1dExpectedFixture = z.infer<typeof P1dExpectedFixtureSchema>;
export type P1dExpectedTier = z.infer<typeof P1dExpectedTierSchema>;
export type P1dExpectedField = {
  field: string;
  tier: P1dExpectedTier;
};
export type P1dExpectedValue = z.infer<typeof P1dExpectedValueSchema>;
export type P1dExpectedTableCell = z.infer<
  typeof P1dExpectedTableCellSchema
>;

export type P1dEvalChunk = {
  text: string;
  maskedText?: string;
  locator?: unknown;
  structureType?: string;
};

export type P1dFixtureInput<TChunk extends P1dEvalChunk = P1dEvalChunk> = {
  documentId: string;
  fixturePath: string;
  sourceSubtype: DocumentSourceSubtype;
  isPublicDocument: boolean;
  documentIr: DocumentIr;
  chunks: readonly TChunk[];
  expected?: P1dExpectedFixture;
};

export type P1dMeasuredRatio = {
  measured: boolean;
  expectedCount: number;
  foundCount: number;
  rate: number | null;
  missing: string[];
};

export type P1dLocatorCoverage = P1dMeasuredRatio & {
  locatedCount: number;
  notFound: string[];
  unlocated: string[];
};

export type P1dChunkReadiness = {
  chunkCount: number;
  averageChunkLength: number;
  emptyChunkCount: number;
  oversizedChunkCount: number;
  maxChunkBytes: number;
};

export type P1dSafetyObservations = {
  isPublicDocument: boolean;
  falseMaskedTokenCountMeasured: boolean;
  falseMaskedTokenCount: number;
  redactionMarkerCount: number;
  redactionMarkers: Record<string, number>;
};

export type P1dDeterministicZeroCheck = {
  metric: 'falseMaskedTokenCount' | 'emptyChunkCount' | 'oversizedChunkCount';
  expected: 0;
  actual: number;
  passed: boolean;
  ciBlocker: true;
};

export const P1D_CI_BLOCKER_METRICS = [
  'falseMaskedTokenCount',
  'emptyChunkCount',
  'oversizedChunkCount',
] as const satisfies readonly P1dDeterministicZeroCheck['metric'][];

export type P1dFixtureQualityResult = {
  documentId: string;
  fixturePath: string;
  sourceSubtype: DocumentSourceSubtype;
  isPublicDocument: boolean;
  hasExpectedSidecar: boolean;
  metrics: {
    fieldRecall: P1dMeasuredRatio;
    coreFieldRecall: P1dMeasuredRatio;
    valuePrecision: P1dMeasuredRatio;
    tableCellRecall: P1dMeasuredRatio;
    locatorCoverage: P1dLocatorCoverage;
    chunkLocatorCoverage: number;
    pageCoverage: number;
    tableCandidates: number;
    textDensityWarnings: string[];
    chunkReadiness: P1dChunkReadiness;
    safetyObservations: P1dSafetyObservations;
  };
  notes: string[];
};

export type P1dSkippedFixture = {
  documentId: string;
  fixturePath: string;
  sourceSubtype: DocumentSourceSubtype;
  reason: string;
};

export type P1dQualityReport = {
  schemaVersion: typeof P1D_QUALITY_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  mode: 'stable';
  liveCalls: false;
  summary: {
    evaluatedFixtureCount: number;
    skippedFixtureCount: number;
    fieldRecallAverage: number | null;
    coreFieldRecallAverage: number | null;
    valuePrecisionAverage: number | null;
    tableCellRecallAverage: number | null;
    locatorCoverageAverage: number | null;
    falseMaskedTokenCount: number;
    redactionMarkerCount: number;
    emptyChunkCount: number;
    oversizedChunkCount: number;
    textDensityWarningCount: number;
    deterministicZeroChecks: P1dDeterministicZeroCheck[];
  };
  metricsPolicy: {
    stableEvalUsesCommittedSidecarsOnly: true;
    liveDriftChecksExcluded: true;
    ciBlockerMetrics: typeof P1D_CI_BLOCKER_METRICS;
    recallMetricsReportOnly: true;
  };
  fixtures: P1dFixtureQualityResult[];
  skippedFixtures: P1dSkippedFixture[];
  deferredMetrics: string[];
};

type MatchableChunk = P1dEvalChunk & {
  normalizedText: string;
};

type LocatorExpectedItem = {
  label: string;
  findChunk: (chunks: readonly MatchableChunk[]) => MatchableChunk | null;
};

function measuredRatio(
  expectedCount: number,
  foundCount: number,
  missing: string[]
): P1dMeasuredRatio {
  return {
    measured: expectedCount > 0,
    expectedCount,
    foundCount,
    rate: expectedCount > 0 ? foundCount / expectedCount : null,
    missing,
  };
}

function chunkHasLocator(chunk: P1dEvalChunk): boolean {
  return chunk.locator !== undefined && chunk.locator !== null;
}

function prepareChunks(chunks: readonly P1dEvalChunk[]): MatchableChunk[] {
  return chunks.map((chunk) => ({
    ...chunk,
    normalizedText: normalizeForSubstringMatch(chunk.text),
  }));
}

function findBestMatchingChunk(
  chunks: readonly MatchableChunk[],
  predicate: (chunk: MatchableChunk) => boolean
): MatchableChunk | null {
  const matches = chunks.filter(predicate);
  return matches.find(chunkHasLocator) ?? matches[0] ?? null;
}

function evaluateExpectedValues(
  chunks: readonly MatchableChunk[],
  expectedValues: readonly P1dExpectedValue[]
): P1dMeasuredRatio {
  const missing: string[] = [];
  for (const expected of expectedValues) {
    const normalizedField = normalizeForSubstringMatch(expected.field);
    const normalizedValue = normalizeForSubstringMatch(expected.expectedValue);
    const found = chunks.some((chunk) => {
      const text = chunk.normalizedText;
      return text.includes(normalizedField) && text.includes(normalizedValue);
    });
    if (!found) missing.push(`${expected.field}: ${expected.expectedValue}`);
  }
  return measuredRatio(
    expectedValues.length,
    expectedValues.length - missing.length,
    missing
  );
}

function expectedFieldItems(expected: P1dExpectedFixture): P1dExpectedField[] {
  return expected.expectedFields.map((field) => ({
    field,
    tier: expected.expectedFieldTiers[field] ?? 'extended',
  }));
}

function expectedFieldTextsByTier(
  expected: P1dExpectedFixture,
  tier: P1dExpectedTier
): string[] {
  return expectedFieldItems(expected)
    .filter((field) => field.tier === tier)
    .map((field) => field.field);
}

function evaluateFieldRecall(
  chunks: readonly P1dEvalChunk[],
  expectedFields: readonly string[]
): P1dMeasuredRatio {
  const { semanticRetention } = evalSemanticRetention({
    chunks,
    expectedFields,
  });
  return measuredRatio(
    expectedFields.length,
    expectedFields.length - semanticRetention.missingExpectedFields.length,
    semanticRetention.missingExpectedFields
  );
}

function evaluateExpectedTableCells(
  chunks: readonly MatchableChunk[],
  expectedTableCells: readonly P1dExpectedTableCell[]
): P1dMeasuredRatio {
  const tableChunks = chunks.filter((chunk) => chunk.structureType === 'table');
  const missing: string[] = [];

  for (const expected of expectedTableCells) {
    const required = [
      expected.rowLabel,
      expected.columnLabel,
      expected.expectedValue,
    ]
      .filter((value): value is string => value !== undefined)
      .map(normalizeForSubstringMatch);

    const found = tableChunks.some((chunk) =>
      required.every((value) => chunk.normalizedText.includes(value))
    );
    if (!found) {
      const label = [
        expected.tableId,
        expected.rowLabel,
        expected.columnLabel,
        expected.expectedValue,
      ]
        .filter((value): value is string => value !== undefined)
        .join(' / ');
      missing.push(label);
    }
  }

  return measuredRatio(
    expectedTableCells.length,
    expectedTableCells.length - missing.length,
    missing
  );
}

function evaluateLocatorCoverage(
  chunks: readonly MatchableChunk[],
  expected: P1dExpectedFixture
): P1dLocatorCoverage {
  const expectedItems: LocatorExpectedItem[] = [
    ...expectedFieldItems(expected).map((field) => ({
      label: field.field,
      findChunk: (candidateChunks: readonly MatchableChunk[]) => {
        const normalizedField = normalizeForSubstringMatch(field.field);
        return findBestMatchingChunk(candidateChunks, (chunk) =>
          chunk.normalizedText.includes(normalizedField)
        );
      },
    })),
    ...expected.expectedValues.map((value) => ({
      label: `${value.field}: ${value.expectedValue}`,
      findChunk: (candidateChunks: readonly MatchableChunk[]) => {
        const normalizedField = normalizeForSubstringMatch(value.field);
        const normalizedValue = normalizeForSubstringMatch(value.expectedValue);
        return findBestMatchingChunk(
          candidateChunks,
          (chunk) =>
            chunk.normalizedText.includes(normalizedField) &&
            chunk.normalizedText.includes(normalizedValue)
        );
      },
    })),
    ...expected.expectedTableCells.map((cell) => ({
      label: [cell.tableId, cell.rowLabel, cell.columnLabel, cell.expectedValue]
        .filter((value): value is string => value !== undefined)
        .join(' / '),
      findChunk: (candidateChunks: readonly MatchableChunk[]) => {
        const tableChunks = candidateChunks.filter(
          (chunk) => chunk.structureType === 'table'
        );
        const required = [cell.rowLabel, cell.columnLabel, cell.expectedValue]
          .filter((value): value is string => value !== undefined)
          .map(normalizeForSubstringMatch);
        return findBestMatchingChunk(
          tableChunks,
          (chunk) =>
            required.every((value) => chunk.normalizedText.includes(value))
        );
      },
    })),
  ];

  let locatedCount = 0;
  const notFound: string[] = [];
  const unlocated: string[] = [];

  for (const item of expectedItems) {
    const chunk = item.findChunk(chunks);
    if (!chunk) {
      notFound.push(item.label);
      continue;
    }
    if (chunkHasLocator(chunk)) {
      locatedCount += 1;
    } else {
      unlocated.push(item.label);
    }
  }

  const missing = [
    ...notFound.map((item) => `not_found: ${item}`),
    ...unlocated.map((item) => `locator_missing: ${item}`),
  ];

  return {
    ...measuredRatio(expectedItems.length, locatedCount, missing),
    locatedCount,
    notFound,
    unlocated,
  };
}

function countRedactionMarkers(options: {
  chunks: readonly P1dEvalChunk[];
  isPublicDocument: boolean;
}): P1dSafetyObservations {
  const redactionMarkers: Record<string, number> = {};

  for (const chunk of options.chunks) {
    const text = chunk.maskedText ?? chunk.text;
    const matches = text.matchAll(/\[REDACTED:[^\]]+\]/g);
    for (const match of matches) {
      const marker = match[0];
      redactionMarkers[marker] = (redactionMarkers[marker] ?? 0) + 1;
    }
  }

  const redactionMarkerCount = Object.values(redactionMarkers).reduce(
    (sum, count) => sum + count,
    0
  );
  const falseMaskedTokenCount = options.isPublicDocument
    ? redactionMarkerCount
    : 0;

  return {
    isPublicDocument: options.isPublicDocument,
    falseMaskedTokenCountMeasured: options.isPublicDocument,
    falseMaskedTokenCount,
    redactionMarkerCount,
    redactionMarkers,
  };
}

function averageMeasuredRate(
  fixtures: readonly P1dFixtureQualityResult[],
  metric: (fixture: P1dFixtureQualityResult) => P1dMeasuredRatio
): number | null {
  const measured = fixtures
    .map(metric)
    .filter((result) => result.measured && result.rate !== null);
  if (measured.length === 0) return null;
  return (
    measured.reduce((sum, result) => sum + (result.rate ?? 0), 0) /
    measured.length
  );
}

function deterministicZeroCheck(
  metric: P1dDeterministicZeroCheck['metric'],
  actual: number
): P1dDeterministicZeroCheck {
  return {
    metric,
    expected: 0,
    actual,
    passed: actual === 0,
    ciBlocker: true,
  };
}

/**
 * Deterministic zero metrics that fail the CI gate. Recall-style averages stay
 * report-only on purpose: they move whenever expected sidecars are broadened,
 * and gating them would punish honest expectations.
 */
export function listFailedDeterministicZeroChecks(
  report: P1dQualityReport
): P1dDeterministicZeroCheck[] {
  return report.summary.deterministicZeroChecks.filter(
    (check) => !check.passed
  );
}

export function evaluateP1dFixture<TChunk extends P1dEvalChunk>(
  input: P1dFixtureInput<TChunk>
): P1dFixtureQualityResult {
  const expected = input.expected;
  const chunks = prepareChunks(input.chunks);
  const expectedForMetrics =
    expected ??
    P1dExpectedFixtureSchema.parse({
      documentId: input.documentId,
      expectedFields: [],
    });

  const fieldRecall = evaluateFieldRecall(
    input.chunks,
    expectedForMetrics.expectedFields
  );
  const coreFieldRecall = evaluateFieldRecall(
    input.chunks,
    expectedFieldTextsByTier(expectedForMetrics, 'core')
  );

  const valuePrecision = evaluateExpectedValues(
    chunks,
    expectedForMetrics.expectedValues
  );
  const tableCellRecall = evaluateExpectedTableCells(
    chunks,
    expectedForMetrics.expectedTableCells
  );
  const locatorCoverage = evaluateLocatorCoverage(chunks, expectedForMetrics);
  const { coverage } = evalCoverage({
    documentIr: input.documentIr,
    chunks: input.chunks,
  });
  const { contextPackageReadiness } = evalContextPackageReadiness({
    documentIr: input.documentIr,
    chunks: input.chunks,
  });

  const chunksWithLocators = input.chunks.filter(chunkHasLocator).length;
  const chunkLocatorCoverage =
    input.chunks.length > 0 ? chunksWithLocators / input.chunks.length : 0;

  const notes: string[] = [];
  if (!expected) {
    notes.push('expected sidecar missing; structured recall metrics not measured');
  }
  if (expectedForMetrics.expectedValues.length === 0) {
    notes.push('expectedValues not defined; valuePrecision not measured');
  }
  if (
    expectedFieldTextsByTier(expectedForMetrics, 'core').length === 0
  ) {
    notes.push('core expectedFields not defined; coreFieldRecall not measured');
  }
  if (expectedForMetrics.expectedTableCells.length === 0) {
    notes.push('expectedTableCells not defined; tableCellRecall not measured');
  }

  return {
    documentId: input.documentId,
    fixturePath: input.fixturePath,
    sourceSubtype: input.sourceSubtype,
    isPublicDocument: input.isPublicDocument,
    hasExpectedSidecar: expected !== undefined,
    metrics: {
      fieldRecall,
      coreFieldRecall,
      valuePrecision,
      tableCellRecall,
      locatorCoverage,
      chunkLocatorCoverage,
      pageCoverage: coverage.pageCoverage,
      tableCandidates: coverage.tableCandidates,
      textDensityWarnings: coverage.textDensityWarnings,
      chunkReadiness: {
        chunkCount: contextPackageReadiness.chunkCount,
        averageChunkLength: contextPackageReadiness.averageChunkLength,
        emptyChunkCount: contextPackageReadiness.emptyChunks,
        oversizedChunkCount: contextPackageReadiness.oversizedChunks,
        maxChunkBytes: MAX_FIRESTORE_CHUNK_DOCUMENT_BYTES,
      },
      safetyObservations: countRedactionMarkers({
        chunks: input.chunks,
        isPublicDocument: input.isPublicDocument,
      }),
    },
    notes,
  };
}

export function buildP1dQualityReport(
  fixtures: readonly P1dFixtureQualityResult[],
  skippedFixtures: readonly P1dSkippedFixture[],
  generatedAt = new Date().toISOString()
): P1dQualityReport {
  const falseMaskedTokenCount = fixtures.reduce(
    (sum, fixture) =>
      sum + fixture.metrics.safetyObservations.falseMaskedTokenCount,
    0
  );
  const emptyChunkCount = fixtures.reduce(
    (sum, fixture) => sum + fixture.metrics.chunkReadiness.emptyChunkCount,
    0
  );
  const oversizedChunkCount = fixtures.reduce(
    (sum, fixture) =>
      sum + fixture.metrics.chunkReadiness.oversizedChunkCount,
    0
  );

  return {
    schemaVersion: P1D_QUALITY_REPORT_SCHEMA_VERSION,
    generatedAt,
    mode: 'stable',
    liveCalls: false,
    summary: {
      evaluatedFixtureCount: fixtures.length,
      skippedFixtureCount: skippedFixtures.length,
      fieldRecallAverage: averageMeasuredRate(
        fixtures,
        (fixture) => fixture.metrics.fieldRecall
      ),
      coreFieldRecallAverage: averageMeasuredRate(
        fixtures,
        (fixture) => fixture.metrics.coreFieldRecall
      ),
      valuePrecisionAverage: averageMeasuredRate(
        fixtures,
        (fixture) => fixture.metrics.valuePrecision
      ),
      tableCellRecallAverage: averageMeasuredRate(
        fixtures,
        (fixture) => fixture.metrics.tableCellRecall
      ),
      locatorCoverageAverage: averageMeasuredRate(
        fixtures,
        (fixture) => fixture.metrics.locatorCoverage
      ),
      falseMaskedTokenCount,
      redactionMarkerCount: fixtures.reduce(
        (sum, fixture) =>
          sum + fixture.metrics.safetyObservations.redactionMarkerCount,
        0
      ),
      emptyChunkCount,
      oversizedChunkCount,
      textDensityWarningCount: fixtures.reduce(
        (sum, fixture) =>
          sum + fixture.metrics.textDensityWarnings.length,
        0
      ),
      deterministicZeroChecks: [
        deterministicZeroCheck('falseMaskedTokenCount', falseMaskedTokenCount),
        deterministicZeroCheck('emptyChunkCount', emptyChunkCount),
        deterministicZeroCheck('oversizedChunkCount', oversizedChunkCount),
      ],
    },
    metricsPolicy: {
      stableEvalUsesCommittedSidecarsOnly: true,
      liveDriftChecksExcluded: true,
      ciBlockerMetrics: P1D_CI_BLOCKER_METRICS,
      recallMetricsReportOnly: true,
    },
    fixtures: [...fixtures],
    skippedFixtures: [...skippedFixtures],
    deferredMetrics: [
      'publicDirectRate belongs to live curator classification eval',
      'overRestrictedCount belongs to live curator classification eval',
      'Cloud DLP false-positive redaction drift belongs to live drift check',
      'largeMixedPdfExtractionStatus belongs to local/live mixed PDF check',
      'largeMixedPdfFailureReasons belongs to local/live mixed PDF check',
    ],
  };
}

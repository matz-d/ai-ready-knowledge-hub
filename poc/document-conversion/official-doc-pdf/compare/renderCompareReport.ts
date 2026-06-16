import type { ConversionEvalResult } from '../../../../src/eval/conversion';
import type { P1dFixtureQualityResult } from '../../../../src/eval/conversion/p1dQualityGate';
import type {
  OfficialDocPipelineResult,
  OfficialDocPipelineSnapshot,
} from '../runPipeline';

export type HallucinationCandidate = {
  source: 'expectedField' | 'expectedValue' | 'expectedTableCell';
  text: string;
};

export type GeminiTableGroundingRejectedExample = {
  pageNumber: number;
  text: string;
  reason: string;
};

export type GeminiTableGroundingObservation = {
  rawTableRows: number;
  groundedTableRows: number;
  rejectedTableRows: number;
  rejectedExamples: GeminiTableGroundingRejectedExample[];
};

export type TableAssistGoldenQuality = {
  id: string;
  expectedPath: string;
  quality: {
    pdfParse?: P1dFixtureQualityResult;
    markitDown?: P1dFixtureQualityResult;
    gemini?: P1dFixtureQualityResult;
    pdfParseGeminiTables?: P1dFixtureQualityResult;
  };
};

export type FixtureCompareRow = {
  fileName: string;
  inputPath: string;
  pdfSourceTotalPages: number;
  pdfParse: OfficialDocPipelineSnapshot | { error: string };
  markitDown: OfficialDocPipelineSnapshot | { error: string };
  gemini: OfficialDocPipelineSnapshot | { error: string };
  pdfParseGeminiTables: OfficialDocPipelineSnapshot | { error: string };
  geminiHallucinationCandidates: HallucinationCandidate[];
  pdfParseGeminiTablesHallucinationCandidates: HallucinationCandidate[];
  pdfParseGeminiTablesGrounding: GeminiTableGroundingObservation | null;
  tableAssistGoldens: TableAssistGoldenQuality[];
};

/** In-memory row while running converters (includes full DocumentIR). */
export type FixtureCompareRun = {
  fileName: string;
  inputPath: string;
  pdfSourceTotalPages: number;
  pdfParse: OfficialDocPipelineResult | { error: string };
  markitDown: OfficialDocPipelineResult | { error: string };
  gemini: OfficialDocPipelineResult | { error: string };
  pdfParseGeminiTables: OfficialDocPipelineResult | { error: string };
  geminiHallucinationCandidates: HallucinationCandidate[];
  pdfParseGeminiTablesHallucinationCandidates: HallucinationCandidate[];
  pdfParseGeminiTablesGrounding: GeminiTableGroundingObservation | null;
  tableAssistGoldens: TableAssistGoldenQuality[];
};

export type CompareReport = {
  schemaVersion: 1;
  subtype: 'official-doc-pdf';
  generatedAt: string;
  stage: 'health';
  markitDown: {
    available: boolean;
    command: string;
    error?: string;
  };
  fixtures: FixtureCompareRow[];
};

function isErrorRun(
  run: OfficialDocPipelineSnapshot | { error: string }
): run is { error: string } {
  return 'error' in run;
}

function formatEvalCell(evalResult: ConversionEvalResult): string {
  const cpr = evalResult.contextPackageReadiness;
  return [
    evalResult.overall.status,
    `chunks=${cpr.chunkCount}`,
    `empty=${cpr.emptyChunks}`,
    `oversized=${cpr.oversizedChunks}`,
    `tables=${evalResult.coverage.tableCandidates}`,
    `pageCov=${evalResult.coverage.pageCoverage.toFixed(2)}`,
  ].join('; ');
}

function formatQualityCell(quality: P1dFixtureQualityResult | undefined): string {
  if (!quality) return 'quality=n/a';
  const metric = (value: { measured: boolean; rate: number | null }): string =>
    value.measured && value.rate !== null ? value.rate.toFixed(2) : 'n/a';
  return [
    `field=${metric(quality.metrics.fieldRecall)}`,
    `core=${metric(quality.metrics.coreFieldRecall)}`,
    `value=${metric(quality.metrics.valuePrecision)}`,
    `table=${metric(quality.metrics.tableCellRecall)}`,
    `locator=${metric(quality.metrics.locatorCoverage)}`,
  ].join('; ');
}

function formatRuntimeCell(
  run: OfficialDocPipelineSnapshot | { error: string }
): string {
  if (isErrorRun(run) || !run.runtime) return 'runtime=n/a';
  const runtime = run.runtime;
  return [
    runtime.elapsedMs !== undefined ? `elapsedMs=${runtime.elapsedMs}` : undefined,
    runtime.pageGroupCount !== undefined
      ? `pageGroups=${runtime.pageGroupCount}`
      : undefined,
    runtime.geminiCallCount !== undefined
      ? `geminiCalls=${runtime.geminiCallCount}`
      : undefined,
    runtime.pageGroupSize !== undefined
      ? `groupSize=${runtime.pageGroupSize}`
      : undefined,
    runtime.concurrency !== undefined
      ? `concurrency=${runtime.concurrency}`
      : undefined,
  ]
    .filter((value): value is string => value !== undefined)
    .join('; ');
}

function formatRunCell(
  run: OfficialDocPipelineSnapshot | { error: string }
): string {
  if (isErrorRun(run)) {
    return `ERROR: ${run.error}`;
  }
  return [
    formatEvalCell(run.eval),
    formatQualityCell(run.quality),
    formatRuntimeCell(run),
    `blocks=${run.blockCount}`,
    `pages=${run.pageCount}`,
    `schema=${run.schemaPassed ? 'ok' : 'fail'}`,
  ].join(' | ');
}

export function renderCompareMarkdownTable(report: CompareReport): string {
  const lines: string[] = [
    '# official-doc-pdf: converter comparison',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `MarkItDown: ${report.markitDown.available ? 'available' : 'unavailable'} (\`${report.markitDown.command}\`)`,
  ];
  if (report.markitDown.error) {
    lines.push('', `> ${report.markitDown.error}`);
  }
  lines.push(
    '',
    '| Fixture | pdf-parse | MarkItDown | Gemini | pdf-parse+Gemini tables | Gemini hallucination candidates | Hybrid hallucination candidates | Hybrid grounding rejected | table-assist goldens |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |'
  );

  for (const row of report.fixtures) {
    lines.push(
      `| ${row.fileName} | ${formatRunCell(row.pdfParse).replace(/\|/g, '\\|')} | ${formatRunCell(row.markitDown).replace(/\|/g, '\\|')} | ${formatRunCell(row.gemini).replace(/\|/g, '\\|')} | ${formatRunCell(row.pdfParseGeminiTables).replace(/\|/g, '\\|')} | ${row.geminiHallucinationCandidates.length} | ${row.pdfParseGeminiTablesHallucinationCandidates.length} | ${row.pdfParseGeminiTablesGrounding?.rejectedTableRows ?? 0} | ${row.tableAssistGoldens.length} |`
    );
  }

  lines.push(
    '',
    '## Metric legend',
    '',
    '- `overall.status`: health-stage rollup (schema_validity + safety_readiness blockers).',
    '- `chunks` / `empty` / `oversized`: `contextPackageReadiness`.',
    '- `tables`: `coverage.tableCandidates` (table blocks).',
    '- `pageCov`: `coverage.pageCoverage` (pages with blocks / pdf-parse page count).',
    '- `field` / `core` / `value` / `table` / `locator`: P1-D quality metrics when an expected sidecar exists.',
    '- `Gemini hallucination candidates`: expected values/table cells found in Gemini/hybrid output but absent from the pdf-parse full text proxy.',
    '- `Hybrid grounding rejected`: Gemini table-only rows discarded before merge because they were not grounded in the same pdf-parse page text.',
    '- `table-assist goldens`: compare-only expected sets evaluated against this fixture; these are not stable P1-D fixtures.',
    '- `runtime`: Gemini-specific elapsed time and page-group/call settings when available.',
    ''
  );

  return `${lines.join('\n')}`;
}

export function renderCompareDetailMarkdown(
  row: FixtureCompareRow,
  report: CompareReport
): string {
  const lines: string[] = [
    `# Compare: ${row.fileName}`,
    '',
    `Input: \`${row.inputPath}\``,
    '',
    `pdf-parse source pages: ${row.pdfSourceTotalPages}`,
    '',
    '## Summary',
    '',
    '| Converter | overall | chunks | empty | oversized | table blocks | page coverage | field | core | value | table | locator | IR pages | blocks | schema |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];

  for (const [label, run] of [
    ['pdf-parse', row.pdfParse],
    ['markitdown', row.markitDown],
    ['gemini', row.gemini],
    ['pdf-parse+gemini-tables', row.pdfParseGeminiTables],
  ] as const) {
    if (isErrorRun(run)) {
      lines.push(
        `| ${label} | ${run.error} | — | — | — | — | — | — | — | — | — | — | — | — | fail |`
      );
      continue;
    }
    const ev = run.eval;
    const quality = run.quality;
    const metric = (value: { measured: boolean; rate: number | null } | undefined) =>
      value?.measured && value.rate !== null ? value.rate.toFixed(3) : 'n/a';
    lines.push(
      `| ${label} | ${ev.overall.status} | ${ev.contextPackageReadiness.chunkCount} | ${ev.contextPackageReadiness.emptyChunks} | ${ev.contextPackageReadiness.oversizedChunks} | ${ev.coverage.tableCandidates} | ${ev.coverage.pageCoverage.toFixed(3)} | ${metric(quality?.metrics.fieldRecall)} | ${metric(quality?.metrics.coreFieldRecall)} | ${metric(quality?.metrics.valuePrecision)} | ${metric(quality?.metrics.tableCellRecall)} | ${metric(quality?.metrics.locatorCoverage)} | ${run.pageCount} | ${run.blockCount} | ${run.schemaPassed ? 'pass' : 'fail'} |`
    );
  }

  lines.push(
    '',
    '## Runtime Observations',
    '',
    '| Converter | elapsed ms | page groups | Gemini calls | group size | concurrency | attempts/group | model | region |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |'
  );

  for (const [label, run] of [
    ['pdf-parse', row.pdfParse],
    ['markitdown', row.markitDown],
    ['gemini', row.gemini],
    ['pdf-parse+gemini-tables', row.pdfParseGeminiTables],
  ] as const) {
    const runtime = isErrorRun(run) ? undefined : run.runtime;
    lines.push(
      `| ${label} | ${runtime?.elapsedMs ?? 'n/a'} | ${runtime?.pageGroupCount ?? 'n/a'} | ${runtime?.geminiCallCount ?? 'n/a'} | ${runtime?.pageGroupSize ?? 'n/a'} | ${runtime?.concurrency ?? 'n/a'} | ${runtime?.attemptsPerGroup ?? 'n/a'} | ${runtime?.model ?? 'n/a'} | ${runtime?.region ?? 'n/a'} |`
    );
  }

  lines.push(
    '',
    '## pdf-parse+Gemini tables grounding',
    '',
    row.pdfParseGeminiTablesGrounding
      ? [
          `Raw Gemini table rows: ${row.pdfParseGeminiTablesGrounding.rawTableRows}`,
          `Grounded rows merged: ${row.pdfParseGeminiTablesGrounding.groundedTableRows}`,
          `Rejected rows: ${row.pdfParseGeminiTablesGrounding.rejectedTableRows}`,
        ].join('\n')
      : 'n/a',
    '',
    row.pdfParseGeminiTablesGrounding?.rejectedExamples.length
      ? row.pdfParseGeminiTablesGrounding.rejectedExamples
          .map(
            (example) =>
              `- page ${example.pageNumber}: ${example.reason}: ${example.text}`
          )
          .join('\n')
      : 'No rejected examples.',
    '',
    '## Compare-only table-assist goldens',
    '',
    row.tableAssistGoldens.length === 0
      ? 'None.'
      : [
          '| Golden | Converter | table | locator | table candidates | expected path |',
          '| --- | --- | ---: | ---: | ---: | --- |',
          ...row.tableAssistGoldens.flatMap((golden) =>
            ([
              ['pdf-parse', golden.quality.pdfParse],
              ['markitdown', golden.quality.markitDown],
              ['gemini', golden.quality.gemini],
              ['pdf-parse+gemini-tables', golden.quality.pdfParseGeminiTables],
            ] as const).map(([converter, quality]) => {
              const metric = (
                value: { measured: boolean; rate: number | null } | undefined
              ) =>
                value?.measured && value.rate !== null
                  ? value.rate.toFixed(3)
                  : 'n/a';
              return `| ${golden.id} | ${converter} | ${metric(quality?.metrics.tableCellRecall)} | ${metric(quality?.metrics.locatorCoverage)} | ${quality?.metrics.tableCandidates ?? 'n/a'} | ${golden.expectedPath} |`;
            })
          ),
        ].join('\n'),
    ''
  );

  lines.push(
    '',
    '## Gemini hallucination candidates',
    '',
    row.geminiHallucinationCandidates.length === 0
      ? 'None.'
      : row.geminiHallucinationCandidates
          .map((candidate) => `- ${candidate.source}: ${candidate.text}`)
          .join('\n'),
    '',
    '## pdf-parse+Gemini tables hallucination candidates',
    '',
    row.pdfParseGeminiTablesHallucinationCandidates.length === 0
      ? 'None.'
      : row.pdfParseGeminiTablesHallucinationCandidates
          .map((candidate) => `- ${candidate.source}: ${candidate.text}`)
          .join('\n'),
    '',
    '## ConversionEvalResult (pdf-parse)',
    '',
    '```json',
    isErrorRun(row.pdfParse)
      ? JSON.stringify({ error: row.pdfParse.error }, null, 2)
      : JSON.stringify(row.pdfParse.eval, null, 2),
    '```',
    '',
    '## ConversionEvalResult (MarkItDown)',
    '',
    '```json',
    isErrorRun(row.markitDown)
      ? JSON.stringify({ error: row.markitDown.error }, null, 2)
      : JSON.stringify(row.markitDown.eval, null, 2),
    '```',
    '',
    '## ConversionEvalResult (Gemini)',
    '',
    '```json',
    isErrorRun(row.gemini)
      ? JSON.stringify({ error: row.gemini.error }, null, 2)
      : JSON.stringify(row.gemini.eval, null, 2),
    '```',
    '',
    '## ConversionEvalResult (pdf-parse+Gemini tables)',
    '',
    '```json',
    isErrorRun(row.pdfParseGeminiTables)
      ? JSON.stringify({ error: row.pdfParseGeminiTables.error }, null, 2)
      : JSON.stringify(row.pdfParseGeminiTables.eval, null, 2),
    '```',
    '',
    `Report generated: ${report.generatedAt}`,
    ''
  );

  return lines.join('\n');
}

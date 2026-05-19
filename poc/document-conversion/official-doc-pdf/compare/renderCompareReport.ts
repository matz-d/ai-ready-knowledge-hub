import type { ConversionEvalResult } from '../../../../src/eval/conversion';
import type {
  OfficialDocPipelineResult,
  OfficialDocPipelineSnapshot,
} from '../runPipeline';

export type FixtureCompareRow = {
  fileName: string;
  inputPath: string;
  pdfSourceTotalPages: number;
  pdfParse: OfficialDocPipelineSnapshot | { error: string };
  markitDown: OfficialDocPipelineSnapshot | { error: string };
};

/** In-memory row while running converters (includes full DocumentIR). */
export type FixtureCompareRun = {
  fileName: string;
  inputPath: string;
  pdfSourceTotalPages: number;
  pdfParse: OfficialDocPipelineResult | { error: string };
  markitDown: OfficialDocPipelineResult | { error: string };
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

function formatRunCell(
  run: OfficialDocPipelineSnapshot | { error: string }
): string {
  if (isErrorRun(run)) {
    return `ERROR: ${run.error}`;
  }
  return [
    formatEvalCell(run.eval),
    `blocks=${run.blockCount}`,
    `pages=${run.pageCount}`,
    `schema=${run.schemaPassed ? 'ok' : 'fail'}`,
  ].join(' | ');
}

export function renderCompareMarkdownTable(report: CompareReport): string {
  const lines: string[] = [
    '# official-doc-pdf: pdf-parse vs MarkItDown',
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
    '| Fixture | pdf-parse | MarkItDown |',
    '| --- | --- | --- |'
  );

  for (const row of report.fixtures) {
    lines.push(
      `| ${row.fileName} | ${formatRunCell(row.pdfParse).replace(/\|/g, '\\|')} | ${formatRunCell(row.markitDown).replace(/\|/g, '\\|')} |`
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
    '| Converter | overall | chunks | empty | oversized | table blocks | page coverage | IR pages | blocks | schema |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];

  for (const [label, run] of [
    ['pdf-parse', row.pdfParse],
    ['markitdown', row.markitDown],
  ] as const) {
    if (isErrorRun(run)) {
      lines.push(`| ${label} | — | — | — | — | — | — | — | — | ${run.error} |`);
      continue;
    }
    const ev = run.eval;
    lines.push(
      `| ${label} | ${ev.overall.status} | ${ev.contextPackageReadiness.chunkCount} | ${ev.contextPackageReadiness.emptyChunks} | ${ev.contextPackageReadiness.oversizedChunks} | ${ev.coverage.tableCandidates} | ${ev.coverage.pageCoverage.toFixed(3)} | ${run.pageCount} | ${run.blockCount} | ${run.schemaPassed ? 'pass' : 'fail'} |`
    );
  }

  lines.push(
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
    `Report generated: ${report.generatedAt}`,
    ''
  );

  return lines.join('\n');
}

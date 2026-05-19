#!/usr/bin/env tsx
/**
 * official-doc-pdf subtype 1: pdf-parse vs MarkItDown comparison (PoC only).
 *
 * MarkItDown runs via local `uvx --from markitdown[pdf]` (Python stays out of
 * Dockerfile / mainline). Both converters feed the same DocumentIR →
 * KnowledgeChunk → ConversionEvalResult health-check path.
 *
 * Usage:
 *   pnpm poc:conversion:official-doc-pdf:compare [path/to.pdf]
 *
 * Outputs (gitignored under poc/document-conversion/output/official-doc-pdf/):
 *   compare-summary.json / compare-summary.md
 *   compare-{fixture}.json / compare-{fixture}.md
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { buildDocumentIr } from '../extract/buildDocumentIr';
import { buildDocumentIrFromMarkdown } from '../extract/buildDocumentIrFromMarkdown';
import {
  checkMarkitDownAvailable,
  extractMarkdown,
} from '../extract/markitdownExtractor';
import { extractPdf } from '../extract/pdfParseExtractor';
import {
  fixtureBasename,
  runOfficialDocPipeline,
  type OfficialDocPipelineResult,
} from '../runPipeline';
import {
  renderCompareDetailMarkdown,
  renderCompareMarkdownTable,
  type CompareReport,
  type FixtureCompareRow,
  type FixtureCompareRun,
} from './renderCompareReport';
import { toPipelineSnapshot } from '../runPipeline';
import { fixtureDir, pocOutputDir, repoRoot } from '../../shared/paths';

const SUBTYPE = 'official-doc-pdf' as const;

async function listFixturePdfPaths(): Promise<string[]> {
  const dir = fixtureDir(SUBTYPE);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.toLowerCase().endsWith('.pdf'))
    .map((name) => path.join(dir, name))
    .sort();
}

async function runPdfParseArm(
  inputPath: string,
  fileName: string,
  basename: string
): Promise<{
  pdfSourceTotalPages: number;
  result: OfficialDocPipelineResult;
}> {
  const extracted = await extractPdf({ inputPath });
  const documentIr = buildDocumentIr({ fileName, extracted });
  const result = await runOfficialDocPipeline({
    converter: 'pdf-parse',
    fileName,
    documentIr,
    outputBasename: basename,
    totalPages: extracted.totalPages,
  });
  return { pdfSourceTotalPages: extracted.totalPages, result };
}

async function runMarkitDownArm(
  inputPath: string,
  fileName: string,
  basename: string,
  totalPages: number,
  markitDownAvailable: boolean
): Promise<OfficialDocPipelineResult | { error: string }> {
  if (!markitDownAvailable) {
    return { error: 'MarkItDown unavailable (install uv and run compare locally)' };
  }
  try {
    const markdown = await extractMarkdown({ inputPath });
    const documentIr = buildDocumentIrFromMarkdown({ fileName, markdown });
    return await runOfficialDocPipeline({
      converter: 'markitdown',
      fileName,
      documentIr,
      outputBasename: basename,
      totalPages,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

function toFixtureCompareRow(run: FixtureCompareRun): FixtureCompareRow {
  return {
    fileName: run.fileName,
    inputPath: run.inputPath,
    pdfSourceTotalPages: run.pdfSourceTotalPages,
    pdfParse:
      'error' in run.pdfParse
        ? run.pdfParse
        : toPipelineSnapshot(run.pdfParse),
    markitDown:
      'error' in run.markitDown
        ? run.markitDown
        : toPipelineSnapshot(run.markitDown),
  };
}

async function writeCompareArtifacts(
  report: CompareReport,
  row: FixtureCompareRow
): Promise<void> {
  const outDir = pocOutputDir(SUBTYPE);
  await mkdir(outDir, { recursive: true });
  const basename = fixtureBasename(row.inputPath);

  const jsonPath = path.join(outDir, `compare-${basename}.json`);
  const mdPath = path.join(outDir, `compare-${basename}.md`);

  await writeFile(jsonPath, `${JSON.stringify(row, null, 2)}\n`, 'utf8');
  await writeFile(
    mdPath,
    `${renderCompareDetailMarkdown(row, report)}\n`,
    'utf8'
  );
}

async function main(): Promise<void> {
  const inputArg = process.argv[2];
  const fixturePaths = inputArg
    ? [path.resolve(inputArg)]
    : await listFixturePdfPaths();

  const markitDownStatus = await checkMarkitDownAvailable();
  const generatedAt = new Date().toISOString();

  if (fixturePaths.length === 0) {
    console.warn(
      `No PDF fixtures under ${fixtureDir(SUBTYPE)}; nothing to compare.`
    );
  }

  const fixtureRuns: FixtureCompareRun[] = [];

  for (const inputPath of fixturePaths) {
    const fileName = path.basename(inputPath);
    const basename = fixtureBasename(inputPath);

    const { pdfSourceTotalPages, result: pdfParse } = await runPdfParseArm(
      inputPath,
      fileName,
      basename
    );
    const markitDown = await runMarkitDownArm(
      inputPath,
      fileName,
      basename,
      pdfSourceTotalPages,
      markitDownStatus.available
    );

    fixtureRuns.push({
      fileName,
      inputPath,
      pdfSourceTotalPages,
      pdfParse,
      markitDown,
    });
  }

  const fixtures = fixtureRuns.map(toFixtureCompareRow);

  const report: CompareReport = {
    schemaVersion: 1,
    subtype: SUBTYPE,
    generatedAt,
    stage: 'health',
    markitDown: {
      available: markitDownStatus.available,
      command: markitDownStatus.command,
      error: markitDownStatus.error,
    },
    fixtures,
  };

  const outDir = pocOutputDir(SUBTYPE);
  await mkdir(outDir, { recursive: true });

  for (const row of fixtures) {
    await writeCompareArtifacts(report, row);
  }

  const summaryJsonPath = path.join(outDir, 'compare-summary.json');
  const summaryMdPath = path.join(outDir, 'compare-summary.md');
  await writeFile(summaryJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(
    summaryMdPath,
    `${renderCompareMarkdownTable(report)}\n`,
    'utf8'
  );

  console.log(
    JSON.stringify(
      {
        subtype: SUBTYPE,
        repoRoot: repoRoot(),
        markitDown: report.markitDown,
        outputs: {
          summaryJson: summaryJsonPath,
          summaryMarkdown: summaryMdPath,
          perFixture: fixtures.map((row) => ({
            fileName: row.fileName,
            json: path.join(
              outDir,
              `compare-${fixtureBasename(row.inputPath)}.json`
            ),
            markdown: path.join(
              outDir,
              `compare-${fixtureBasename(row.inputPath)}.md`
            ),
          })),
        },
        fixtures,
      },
      null,
      2
    )
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

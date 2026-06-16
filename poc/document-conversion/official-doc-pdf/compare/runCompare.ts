#!/usr/bin/env tsx
/**
 * official-doc-pdf subtype 1: converter comparison (PoC only).
 *
 * MarkItDown runs via local `uvx --from markitdown[pdf]` (Python stays out of
 * Dockerfile / mainline). Gemini runs through Vertex in eval-only mode.
 * All converters feed the same DocumentIR →
 * KnowledgeChunk → ConversionEvalResult health-check path.
 *
 * Usage:
 *   pnpm poc:conversion:official-doc-pdf:compare [path/to.pdf]
 *
 * Outputs (gitignored under poc/document-conversion/output/official-doc-pdf/):
 *   compare-summary.json / compare-summary.md
 *   compare-{fixture}.json / compare-{fixture}.md
 */
import '../../../../scripts/loadEnv';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { buildDocumentIr } from '../extract/buildDocumentIr';
import { buildDocumentIrFromMarkdown } from '../extract/buildDocumentIrFromMarkdown';
import {
  extractGeminiOfficialDocPdf,
  extractGeminiOfficialDocPdfTables,
} from '../extract/geminiExtractor';
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
  type HallucinationCandidate,
  type GeminiTableGroundingObservation,
  renderCompareDetailMarkdown,
  renderCompareMarkdownTable,
  type CompareReport,
  type FixtureCompareRow,
  type FixtureCompareRun,
  type TableAssistGoldenQuality,
} from './renderCompareReport';
import { mergePdfParseWithGeminiTables } from './groundGeminiTables';
import { toPipelineSnapshot } from '../runPipeline';
import {
  P1dExpectedFixtureSchema,
  type P1dExpectedFixture,
  type P1dFixtureQualityResult,
  evaluateP1dFixture,
} from '../../../../src/eval/conversion/p1dQualityGate';
import { normalizeForSubstringMatch } from '../../../../src/eval/conversion/golden';
import { fixtureDir, pocOutputDir, repoRoot } from '../../shared/paths';
import type { DocumentIr } from '../../shared/documentIr';
import { mapDocumentIrToChunkDrafts } from '../adapter/toKnowledgeChunk';

const SUBTYPE = 'official-doc-pdf' as const;
const GEMINI_ALLOWED_SYNTHETIC_FIXTURES = new Set([
  'synthetic-official-doc-table-assist-golden',
]);

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
  basename: string,
  expected: P1dExpectedFixture | undefined,
  isPublicDocument: boolean
): Promise<{
  pdfSourceTotalPages: number;
  result: OfficialDocPipelineResult;
  fullText: string;
}> {
  const extracted = await extractPdf({ inputPath });
  const documentIr = buildDocumentIr({ fileName, extracted });
  const result = await runOfficialDocPipeline({
    converter: 'pdf-parse',
    fileName,
    documentIr,
    outputBasename: basename,
    totalPages: extracted.totalPages,
    inputPath,
    expected,
    isPublicDocument,
  });
  return {
    pdfSourceTotalPages: extracted.totalPages,
    result,
    fullText: extracted.pages.map((page) => page.rawText).join('\n'),
  };
}

async function runMarkitDownArm(
  inputPath: string,
  fileName: string,
  basename: string,
  totalPages: number,
  markitDownAvailable: boolean,
  expected: P1dExpectedFixture | undefined,
  isPublicDocument: boolean
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
      inputPath,
      expected,
      isPublicDocument,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

async function runGeminiArm(
  inputPath: string,
  fileName: string,
  basename: string,
  totalPages: number,
  expected: P1dExpectedFixture | undefined,
  isPublicDocument: boolean
): Promise<OfficialDocPipelineResult | { error: string }> {
  if (!fixtureCanUseGemini(basename, isPublicDocument)) {
    return {
      error:
        'Gemini arm skipped for non-public fixture; set OFFICIAL_DOC_PDF_GEMINI_INCLUDE_NON_PUBLIC_FIXTURES=1 to run explicitly.',
    };
  }

  try {
    const extracted = await extractGeminiOfficialDocPdf({
      inputPath,
      fileName,
      totalPages,
    });
    return await runOfficialDocPipeline({
      converter: 'gemini',
      fileName,
      documentIr: extracted.documentIr,
      outputBasename: basename,
      totalPages,
      inputPath,
      expected,
      isPublicDocument,
      runtime: {
        elapsedMs: extracted.elapsedMs,
        model: extracted.model,
        region: extracted.region,
        pageGroupSize: extracted.pageGroupSize,
        pageGroupCount: extracted.pageGroupCount,
        geminiCallCount: extracted.geminiCallCount,
        concurrency: extracted.concurrency,
        attemptsPerGroup: extracted.attemptsPerGroup,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

async function runPdfParseGeminiTablesArm(
  inputPath: string,
  fileName: string,
  basename: string,
  totalPages: number,
  pdfParseDocumentIr: DocumentIr,
  expected: P1dExpectedFixture | undefined,
  isPublicDocument: boolean
): Promise<
  | {
      result: OfficialDocPipelineResult;
      grounding: GeminiTableGroundingObservation;
    }
  | { error: string }
> {
  if (!fixtureCanUseGemini(basename, isPublicDocument)) {
    return {
      error:
        'Gemini table-assist skipped for non-public fixture; set OFFICIAL_DOC_PDF_GEMINI_INCLUDE_NON_PUBLIC_FIXTURES=1 to run explicitly.',
    };
  }

  try {
    const extractedTables = await extractGeminiOfficialDocPdfTables({
      inputPath,
      fileName,
      totalPages,
    });
    const merged = mergePdfParseWithGeminiTables({
      pdfParseDocumentIr,
      geminiTableDocumentIr: extractedTables.documentIr,
    });
    const result = await runOfficialDocPipeline({
      converter: 'pdf-parse+gemini-tables',
      fileName,
      documentIr: merged.documentIr,
      outputBasename: basename,
      totalPages,
      inputPath,
      expected,
      isPublicDocument,
      runtime: {
        elapsedMs: extractedTables.elapsedMs,
        model: extractedTables.model,
        region: extractedTables.region,
        pageGroupSize: extractedTables.pageGroupSize,
        pageGroupCount: extractedTables.pageGroupCount,
        geminiCallCount: extractedTables.geminiCallCount,
        concurrency: extractedTables.concurrency,
        attemptsPerGroup: extractedTables.attemptsPerGroup,
      },
    });
    return { result, grounding: merged.grounding };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

async function loadExpectedFixture(
  inputPath: string,
  basename: string
): Promise<P1dExpectedFixture | undefined> {
  const expectedPath = path.join(path.dirname(inputPath), `${basename}.expected.json`);
  try {
    const raw = JSON.parse(await readFile(expectedPath, 'utf8')) as unknown;
    return P1dExpectedFixtureSchema.parse(raw);
  } catch {
    return undefined;
  }
}

type TableAssistGoldenExpected = {
  id: string;
  expectedPath: string;
  expected: P1dExpectedFixture;
};

async function loadTableAssistGoldenExpectedSets(
  inputPath: string,
  basename: string
): Promise<TableAssistGoldenExpected[]> {
  const dir = path.dirname(inputPath);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const expectedNames = entries
    .filter(
      (name) =>
        name.startsWith(`${basename}.table-assist`) &&
        name.endsWith('.expected.json')
    )
    .sort();

  const loaded: TableAssistGoldenExpected[] = [];
  for (const name of expectedNames) {
    const expectedPath = path.join(dir, name);
    const raw = JSON.parse(await readFile(expectedPath, 'utf8')) as unknown;
    const expected = P1dExpectedFixtureSchema.parse(raw);
    loaded.push({ id: expected.documentId, expectedPath, expected });
  }
  return loaded;
}

function evaluateRunAgainstTableAssistGolden(options: {
  run: OfficialDocPipelineResult | { error: string };
  expected: P1dExpectedFixture;
  expectedPath: string;
  isPublicDocument: boolean;
}): P1dFixtureQualityResult | undefined {
  if ('error' in options.run) return undefined;
  return evaluateP1dFixture({
    documentId: options.expected.documentId,
    fixturePath: options.expectedPath,
    sourceSubtype: 'official-doc-pdf',
    isPublicDocument: options.isPublicDocument,
    documentIr: options.run.documentIr,
    chunks: mapDocumentIrToChunkDrafts(options.run.documentIr),
    expected: options.expected,
  });
}

function evaluateTableAssistGoldens(options: {
  goldens: readonly TableAssistGoldenExpected[];
  isPublicDocument: boolean;
  pdfParse: OfficialDocPipelineResult | { error: string };
  markitDown: OfficialDocPipelineResult | { error: string };
  gemini: OfficialDocPipelineResult | { error: string };
  pdfParseGeminiTables: OfficialDocPipelineResult | { error: string };
}): TableAssistGoldenQuality[] {
  return options.goldens.map((golden) => ({
    id: golden.id,
    expectedPath: golden.expectedPath,
    quality: {
      pdfParse: evaluateRunAgainstTableAssistGolden({
        run: options.pdfParse,
        expected: golden.expected,
        expectedPath: golden.expectedPath,
        isPublicDocument: options.isPublicDocument,
      }),
      markitDown: evaluateRunAgainstTableAssistGolden({
        run: options.markitDown,
        expected: golden.expected,
        expectedPath: golden.expectedPath,
        isPublicDocument: options.isPublicDocument,
      }),
      gemini: evaluateRunAgainstTableAssistGolden({
        run: options.gemini,
        expected: golden.expected,
        expectedPath: golden.expectedPath,
        isPublicDocument: options.isPublicDocument,
      }),
      pdfParseGeminiTables: evaluateRunAgainstTableAssistGolden({
        run: options.pdfParseGeminiTables,
        expected: golden.expected,
        expectedPath: golden.expectedPath,
        isPublicDocument: options.isPublicDocument,
      }),
    },
  }));
}

function isPublicFixture(basename: string): boolean {
  return !basename.startsWith('synthetic-');
}

function fixtureCanUseGemini(
  basename: string,
  isPublicDocument: boolean
): boolean {
  return (
    isPublicDocument ||
    GEMINI_ALLOWED_SYNTHETIC_FIXTURES.has(basename) ||
    process.env.OFFICIAL_DOC_PDF_GEMINI_INCLUDE_NON_PUBLIC_FIXTURES === '1'
  );
}

function expectedTextsForHallucinationCheck(
  expected: P1dExpectedFixture | undefined
): HallucinationCandidate[] {
  if (!expected) return [];
  const candidates: HallucinationCandidate[] = [
    ...expected.expectedFields.map((text) => ({
      source: 'expectedField' as const,
      text,
    })),
    ...expected.expectedValues.flatMap((value) => [
      { source: 'expectedValue' as const, text: value.field },
      { source: 'expectedValue' as const, text: value.expectedValue },
    ]),
  ];
  if (Array.isArray(expected.expectedTableCells)) {
    for (const cell of expected.expectedTableCells) {
      for (const text of [
        cell.rowLabel,
        cell.columnLabel,
        cell.expectedValue,
      ].filter((value): value is string => value !== undefined)) {
        candidates.push({ source: 'expectedTableCell', text });
      }
    }
  }
  return candidates;
}

function textAppears(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizeForSubstringMatch(needle);
  if (normalizedNeedle.length === 0) return true;
  return normalizeForSubstringMatch(haystack).includes(normalizedNeedle);
}

function findGeminiHallucinationCandidates(options: {
  expected: P1dExpectedFixture | undefined;
  gemini: OfficialDocPipelineResult | { error: string };
  pdfParseFullText: string;
}): HallucinationCandidate[] {
  if ('error' in options.gemini) return [];
  const geminiText = options.gemini.documentIr.pages
    .flatMap((page) => page.blocks.map((block) => block.text))
    .join('\n');
  const seen = new Set<string>();
  const candidates: HallucinationCandidate[] = [];
  for (const candidate of expectedTextsForHallucinationCheck(options.expected)) {
    const key = `${candidate.source}:${candidate.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (
      textAppears(geminiText, candidate.text) &&
      !textAppears(options.pdfParseFullText, candidate.text)
    ) {
      candidates.push(candidate);
    }
  }
  return candidates;
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
    gemini:
      'error' in run.gemini
        ? run.gemini
        : toPipelineSnapshot(run.gemini),
    pdfParseGeminiTables:
      'error' in run.pdfParseGeminiTables
        ? run.pdfParseGeminiTables
        : toPipelineSnapshot(run.pdfParseGeminiTables),
    geminiHallucinationCandidates: run.geminiHallucinationCandidates,
    pdfParseGeminiTablesHallucinationCandidates:
      run.pdfParseGeminiTablesHallucinationCandidates,
    pdfParseGeminiTablesGrounding: run.pdfParseGeminiTablesGrounding,
    tableAssistGoldens: run.tableAssistGoldens,
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
    const expected = await loadExpectedFixture(inputPath, basename);
    const tableAssistGoldens = await loadTableAssistGoldenExpectedSets(
      inputPath,
      basename
    );
    const isPublicDocument = isPublicFixture(basename);

    const {
      pdfSourceTotalPages,
      result: pdfParse,
      fullText: pdfParseFullText,
    } = await runPdfParseArm(
      inputPath,
      fileName,
      basename,
      expected,
      isPublicDocument
    );
    const markitDown = await runMarkitDownArm(
      inputPath,
      fileName,
      basename,
      pdfSourceTotalPages,
      markitDownStatus.available,
      expected,
      isPublicDocument
    );
    const gemini = await runGeminiArm(
      inputPath,
      fileName,
      basename,
      pdfSourceTotalPages,
      expected,
      isPublicDocument
    );
    const pdfParseGeminiTablesRun = await runPdfParseGeminiTablesArm(
      inputPath,
      fileName,
      basename,
      pdfSourceTotalPages,
      pdfParse.documentIr,
      expected,
      isPublicDocument
    );
    const pdfParseGeminiTables =
      'error' in pdfParseGeminiTablesRun
        ? pdfParseGeminiTablesRun
        : pdfParseGeminiTablesRun.result;

    fixtureRuns.push({
      fileName,
      inputPath,
      pdfSourceTotalPages,
      pdfParse,
      markitDown,
      gemini,
      pdfParseGeminiTables,
      pdfParseGeminiTablesGrounding:
        'error' in pdfParseGeminiTablesRun
          ? null
          : pdfParseGeminiTablesRun.grounding,
      tableAssistGoldens: evaluateTableAssistGoldens({
        goldens: tableAssistGoldens,
        isPublicDocument,
        pdfParse,
        markitDown,
        gemini,
        pdfParseGeminiTables,
      }),
      geminiHallucinationCandidates: findGeminiHallucinationCandidates({
        expected,
        gemini,
        pdfParseFullText,
      }),
      pdfParseGeminiTablesHallucinationCandidates:
        findGeminiHallucinationCandidates({
          expected,
          gemini: pdfParseGeminiTables,
          pdfParseFullText,
        }),
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

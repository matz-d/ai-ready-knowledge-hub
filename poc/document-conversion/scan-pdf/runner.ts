#!/usr/bin/env tsx
/**
 * scan-pdf PoC runner.
 *
 * Pipeline:
 *   Scanned PDF → Gemini/Vertex AI OCR → DocumentIR artifact
 *               → KnowledgeChunk drafts → health-check eval
 *
 * This runner intentionally stays outside `/api/documents` and `/upload`.
 * Document AI is intentionally not called in this PoC.
 */
import '../../../scripts/loadEnv';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mapScanPdfDocumentIrToChunkDrafts } from './adapter/toKnowledgeChunk';
import {
  runScanPdfHealthCheck,
  SCAN_PDF_SAFETY_READINESS_MEANING,
} from './eval/healthCheck';
import { buildDocumentIrFromGeminiOcr } from './extract/buildDocumentIr';
import {
  extractScanPdfWithGemini,
  type GeminiOcrUsage,
  type GeminiScanPiiFinding,
} from './extract/geminiOcrExtractor';
import {
  type DocumentIr,
  safeParseDocumentIr,
} from '../../../src/eval/conversion/documentIr';
import { fixtureDir, pocOutputDir, repoRoot } from '../shared/paths';
import { writeDocumentIrArtifact } from '../shared/runConversion';

const SUBTYPE = 'scan-pdf' as const;

type OcrCostEstimate = {
  currency: 'USD';
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  inputUsdPer1MToken: number | null;
  outputUsdPer1MToken: number | null;
  estimatedInputUsd: number | null;
  estimatedOutputUsd: number | null;
  estimatedTotalUsd: number | null;
  pricingSource: string;
  note: string;
};

type RunResult = {
  subtype: typeof SUBTYPE;
  inputPath: string;
  fileName: string;
  extractionProvider: 'gemini-vertex-ocr';
  documentAiTried: false;
  documentIrPath: string;
  summaryPath: string;
  pageCount: number;
  blockCount: number;
  chunkDraftCount: number;
  schemaPassed: boolean;
  schemaErrors: string[];
  ocrUsage: GeminiOcrUsage & {
    durationMs: number;
    model: string;
  };
  ocrCost: OcrCostEstimate;
  piiFindings: {
    total: number;
    maskable: number;
    unmaskable: number;
    findings: GeminiScanPiiFinding[];
  };
  safetyReadinessMeaning: typeof SCAN_PDF_SAFETY_READINESS_MEANING;
  eval: ReturnType<typeof runScanPdfHealthCheck>;
};

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

function schemaCheck(candidate: DocumentIr): {
  documentIr: DocumentIr;
  schemaPassed: boolean;
  schemaErrors: string[];
} {
  const parsed = safeParseDocumentIr(candidate);
  if (parsed.success) {
    return { documentIr: parsed.data, schemaPassed: true, schemaErrors: [] };
  }
  return {
    documentIr: candidate,
    schemaPassed: false,
    schemaErrors: parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`
    ),
  };
}

function readPriceEnv(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function defaultInputUsdPer1M(model: string): number | null {
  if (model.includes('gemini-2.5-flash-lite')) return 0.1;
  if (model.includes('gemini-2.5-flash')) return 0.3;
  return null;
}

function defaultOutputUsdPer1M(model: string): number | null {
  if (model.includes('gemini-2.5-flash-lite')) return 0.4;
  if (model.includes('gemini-2.5-flash')) return 2.5;
  return null;
}

function estimateOcrCost(
  usage: GeminiOcrUsage,
  model: string
): OcrCostEstimate {
  const inputTokens = usage.inputTokens ?? null;
  const outputTokens = usage.outputTokens ?? null;
  const totalTokens = usage.totalTokens ?? null;
  const inputUsdPer1MToken =
    readPriceEnv('SCAN_PDF_GEMINI_INPUT_USD_PER_1M_TOKEN') ??
    defaultInputUsdPer1M(model);
  const outputUsdPer1MToken =
    readPriceEnv('SCAN_PDF_GEMINI_OUTPUT_USD_PER_1M_TOKEN') ??
    defaultOutputUsdPer1M(model);
  const estimatedInputUsd =
    inputTokens === null || inputUsdPer1MToken === null
      ? null
      : (inputTokens / 1_000_000) * inputUsdPer1MToken;
  const estimatedOutputUsd =
    outputTokens === null || outputUsdPer1MToken === null
      ? null
      : (outputTokens / 1_000_000) * outputUsdPer1MToken;
  const estimatedTotalUsd =
    estimatedInputUsd === null || estimatedOutputUsd === null
      ? null
      : estimatedInputUsd + estimatedOutputUsd;

  return {
    currency: 'USD',
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    inputUsdPer1MToken,
    outputUsdPer1MToken,
    estimatedInputUsd,
    estimatedOutputUsd,
    estimatedTotalUsd,
    pricingSource:
      'https://cloud.google.com/vertex-ai/generative-ai/pricing',
    note:
      'PoC estimate from Genkit usage tokens. Override rates with SCAN_PDF_GEMINI_INPUT_USD_PER_1M_TOKEN and SCAN_PDF_GEMINI_OUTPUT_USD_PER_1M_TOKEN if Vertex pricing changes or GEMINI_MODEL is not covered.',
  };
}

async function writeSummaryArtifact(
  fileName: string,
  result: RunResult
): Promise<string> {
  const dir = pocOutputDir(SUBTYPE);
  await mkdir(dir, { recursive: true });
  const summaryPath = path.join(
    dir,
    `${path.parse(fileName).name}.scan-pdf-result.json`
  );
  await writeFile(summaryPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return summaryPath;
}

async function runOne(inputPath: string): Promise<RunResult> {
  const fileName = path.basename(inputPath);
  const extracted = await extractScanPdfWithGemini({ inputPath });
  const candidate = buildDocumentIrFromGeminiOcr({
    fileName,
    extracted: extracted.output,
  });
  const { documentIr, schemaPassed, schemaErrors } = schemaCheck(candidate);

  const documentIrPath = await writeDocumentIrArtifact(
    SUBTYPE,
    documentIr,
    path.parse(fileName).name
  );
  const chunkDrafts = mapScanPdfDocumentIrToChunkDrafts(documentIr);
  const evalResult = runScanPdfHealthCheck(
    chunkDrafts,
    extracted.output.piiFindings,
    schemaPassed,
    schemaErrors
  );
  const blockCount = documentIr.pages.reduce(
    (sum, page) => sum + page.blocks.length,
    0
  );
  const unmaskable = extracted.output.piiFindings.filter(
    (finding) => finding.maskability === 'unmaskable'
  ).length;
  const resultWithoutSummaryPath = {
    subtype: SUBTYPE,
    inputPath,
    fileName,
    extractionProvider: 'gemini-vertex-ocr' as const,
    documentAiTried: false as const,
    documentIrPath,
    summaryPath: '',
    pageCount: documentIr.pages.length,
    blockCount,
    chunkDraftCount: chunkDrafts.length,
    schemaPassed,
    schemaErrors,
    ocrUsage: {
      ...extracted.usage,
      durationMs: extracted.durationMs,
      model: extracted.model,
    },
    ocrCost: estimateOcrCost(extracted.usage, extracted.model),
    piiFindings: {
      total: extracted.output.piiFindings.length,
      maskable: extracted.output.piiFindings.length - unmaskable,
      unmaskable,
      findings: extracted.output.piiFindings,
    },
    safetyReadinessMeaning: SCAN_PDF_SAFETY_READINESS_MEANING,
    eval: evalResult,
  };
  const summaryPath = await writeSummaryArtifact(fileName, resultWithoutSummaryPath);
  return { ...resultWithoutSummaryPath, summaryPath };
}

async function main(): Promise<void> {
  const inputArg = process.argv[2];
  const fixturePaths = inputArg
    ? [path.resolve(inputArg)]
    : await listFixturePdfPaths();

  if (fixturePaths.length === 0) {
    console.warn(
      `No PDF fixtures under ${fixtureDir(SUBTYPE)}; nothing to do. ` +
        `See sample-data/document-conversion/README.md`
    );
    console.log(
      JSON.stringify(
        {
          subtype: SUBTYPE,
          repoRoot: repoRoot(),
          documentAiTried: false,
          results: [],
        },
        null,
        2
      )
    );
    return;
  }

  const results: RunResult[] = [];
  for (const inputPath of fixturePaths) {
    results.push(await runOne(inputPath));
  }

  console.log(
    JSON.stringify(
      {
        subtype: SUBTYPE,
        repoRoot: repoRoot(),
        documentAiTried: false,
        results,
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

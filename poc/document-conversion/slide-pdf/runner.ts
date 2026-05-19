#!/usr/bin/env tsx
/**
 * slide-pdf PoC runner.
 *
 * Pipeline:
 *   PDF file → Gemini/Vertex AI direct-read (first-choice)
 *            → pdf-parse text/table extraction (fallback)
 *            → DocumentIR artifact → KnowledgeChunk drafts → health-check eval
 *
 * This runner is intentionally not wired into `/api/documents` or `/upload`.
 */
import '../../../scripts/loadEnv';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { mapSlidePdfDocumentIrToChunkDrafts } from './adapter/toKnowledgeChunk';
import { runSlidePdfHealthCheck } from './eval/healthCheck';
import {
  buildDocumentIrFromGemini,
  buildDocumentIrFromPdfParse,
} from './extract/buildDocumentIr';
import { extractSlidePdfWithGemini } from './extract/geminiDirectExtractor';
import { extractPdf } from '../official-doc-pdf/extract/pdfParseExtractor';
import {
  type DocumentIr,
  safeParseDocumentIr,
} from '../../../src/eval/conversion/documentIr';
import { fixtureDir, repoRoot } from '../shared/paths';
import { writeDocumentIrArtifact } from '../shared/runConversion';

const SUBTYPE = 'slide-pdf' as const;

type ExtractionProvider = 'gemini-direct' | 'pdf-parse-fallback';

type RunResult = {
  subtype: typeof SUBTYPE;
  inputPath: string;
  fileName: string;
  extractionProvider: ExtractionProvider;
  fallbackReason?: string;
  documentIrPath: string;
  pageCount: number;
  blockCount: number;
  chunkDraftCount: number;
  schemaPassed: boolean;
  schemaErrors: string[];
  eval: ReturnType<typeof runSlidePdfHealthCheck>;
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

async function extractWithFallback(inputPath: string): Promise<{
  candidate: DocumentIr;
  extractionProvider: ExtractionProvider;
  fallbackReason?: string;
}> {
  const fileName = path.basename(inputPath);

  if (process.env.SLIDE_PDF_SKIP_GEMINI === '1') {
    const extracted = await extractPdf({ inputPath });
    return {
      candidate: buildDocumentIrFromPdfParse({ fileName, extracted }),
      extractionProvider: 'pdf-parse-fallback',
      fallbackReason: 'SLIDE_PDF_SKIP_GEMINI=1',
    };
  }

  try {
    const extracted = await extractSlidePdfWithGemini({ inputPath });
    return {
      candidate: buildDocumentIrFromGemini({ fileName, extracted }),
      extractionProvider: 'gemini-direct',
    };
  } catch (e) {
    const extracted = await extractPdf({ inputPath });
    return {
      candidate: buildDocumentIrFromPdfParse({ fileName, extracted }),
      extractionProvider: 'pdf-parse-fallback',
      fallbackReason: e instanceof Error ? e.message : String(e),
    };
  }
}

async function runOne(inputPath: string): Promise<RunResult> {
  const fileName = path.basename(inputPath);
  const { candidate, extractionProvider, fallbackReason } =
    await extractWithFallback(inputPath);
  const { documentIr, schemaPassed, schemaErrors } = schemaCheck(candidate);

  const outPath = await writeDocumentIrArtifact(
    SUBTYPE,
    documentIr,
    path.parse(fileName).name
  );

  const chunkDrafts = mapSlidePdfDocumentIrToChunkDrafts(documentIr);
  const evalResult = runSlidePdfHealthCheck(
    documentIr,
    chunkDrafts,
    schemaPassed,
    schemaErrors
  );
  const blockCount = documentIr.pages.reduce(
    (sum, page) => sum + page.blocks.length,
    0
  );

  return {
    subtype: SUBTYPE,
    inputPath,
    fileName,
    extractionProvider,
    fallbackReason,
    documentIrPath: outPath,
    pageCount: documentIr.pages.length,
    blockCount,
    chunkDraftCount: chunkDrafts.length,
    schemaPassed,
    schemaErrors,
    eval: evalResult,
  };
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
        { subtype: SUBTYPE, repoRoot: repoRoot(), results: [] },
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

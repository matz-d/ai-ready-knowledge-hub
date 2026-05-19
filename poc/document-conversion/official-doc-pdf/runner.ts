#!/usr/bin/env tsx
/**
 * official-doc-pdf first-choice runner (Phase 3-H).
 *
 * Pipeline (no Vertex AI):
 *   PDF file → pdf-parse (getText + getTable) → DocumentIR (Zod-validated)
 *            → write `*.document-ir.json` artifact
 *            → KnowledgeChunk drafts → health-check eval
 *
 * Usage:
 *   pnpm poc:conversion:official-doc-pdf [path/to.pdf]
 *
 * If no path is supplied, every PDF under
 * `sample-data/document-conversion/official-doc-pdf/` is processed.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { mapDocumentIrToChunkDrafts } from './adapter/toKnowledgeChunk';
import { runOfficialDocPdfHealthCheck } from './eval/healthCheck';
import { buildDocumentIr } from './extract/buildDocumentIr';
import { extractPdf } from './extract/pdfParseExtractor';
import {
  type DocumentIr,
  safeParseDocumentIr,
} from '../../../src/eval/conversion/documentIr';
import { fixtureDir, repoRoot } from '../shared/paths';
import { writeDocumentIrArtifact } from '../shared/runConversion';

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

type RunResult = {
  subtype: typeof SUBTYPE;
  inputPath: string;
  fileName: string;
  documentIrPath: string;
  pageCount: number;
  blockCount: number;
  chunkDraftCount: number;
  schemaPassed: boolean;
  schemaErrors: string[];
  eval: ReturnType<typeof runOfficialDocPdfHealthCheck>;
};

async function runOne(inputPath: string): Promise<RunResult> {
  const fileName = path.basename(inputPath);

  const extracted = await extractPdf({ inputPath });
  const candidate: DocumentIr = buildDocumentIr({ fileName, extracted });

  const parsed = safeParseDocumentIr(candidate);
  const schemaPassed = parsed.success;
  const schemaErrors = parsed.success
    ? []
    : parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`
      );
  const documentIr = parsed.success ? parsed.data : candidate;

  const outPath = await writeDocumentIrArtifact(
    SUBTYPE,
    documentIr,
    path.parse(fileName).name
  );

  const chunkDrafts = mapDocumentIrToChunkDrafts(documentIr);
  const evalResult = runOfficialDocPdfHealthCheck(
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

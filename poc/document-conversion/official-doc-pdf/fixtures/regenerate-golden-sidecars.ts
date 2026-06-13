#!/usr/bin/env tsx
/**
 * Regenerate committed `*.document-ir.json` sidecars for the public born-digital
 * official-doc-pdf golden fixtures straight from the mainline pdf-parse path
 * (`extractPdf` -> `buildDocumentIr`). Pure local extraction; no Vertex.
 *
 * Why this exists (P1-E Step 0):
 *   The original official-doc-pdf sidecars were small hand-authored DocumentIR
 *   stubs. When `*.expected.json` was later broadened to the full real-document
 *   field list, the stable P1-D gate started measuring a tiny stub against a
 *   large golden, producing a misleadingly low `fieldRecall` (e.g. labor notice
 *   2/33 = 0.06) that reflected sidecar coverage, not extractor quality.
 *
 *   This regenerator replaces those stubs with the real pdf-parse output so the
 *   stable gate measures the actual production extractor, matching the scan-pdf
 *   "raw OCR baseline" sidecar policy. Honest consequences are expected:
 *   `fieldRecall` rises (all page text is present) while `tableCellRecall` /
 *   `valuePrecision` / locator coverage drop where pdf-parse cannot reconstruct
 *   the 2-column form tables or keep label/value adjacency. Those gaps are the
 *   real P1-E targets (Gemini table-assist + label/value enrichment).
 *
 * Scope:
 *   The 3 public MHLW born-digital fixtures only. `*.expected.json` files are
 *   NOT modified here: they encode document-level truth and must stay
 *   independent of extractor output.
 *
 *   `synthetic-employment-context-with-pii` is intentionally excluded. It is a
 *   hand-authored PII value-retention fixture that declares
 *   `expectedTableCells: "not_applicable"`; regenerating it would both destroy
 *   that purpose and risk tripping the not_applicable table-cell contradiction
 *   check (a fresh `getTable()` grid would contradict the N/A declaration).
 *
 * Usage:
 *   pnpm fixtures:official-doc-pdf:sidecars            # all 3
 *   pnpm fixtures:official-doc-pdf:sidecars mhlw-...   # one by basename
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDocumentIr } from '../extract/buildDocumentIr';
import { extractPdf } from '../extract/pdfParseExtractor';
import { safeParseDocumentIr } from '../../../../src/eval/conversion/documentIr';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../../..');
const fixtureDir = path.join(
  repoRoot,
  'sample-data/document-conversion/official-doc-pdf'
);

const GOLDEN_FIXTURES = [
  'mhlw-labor-conditions-notice-general',
  'mhlw-overtime-limit-guide',
  'mhlw-r07-model-work-rules',
] as const;

type GoldenFixture = (typeof GOLDEN_FIXTURES)[number];

function isGoldenFixture(value: string): value is GoldenFixture {
  return (GOLDEN_FIXTURES as readonly string[]).includes(value);
}

async function regenerateOne(documentId: GoldenFixture): Promise<{
  documentId: string;
  pages: number;
  blockCount: number;
  tableBlockCount: number;
  sidecarPath: string;
}> {
  const fileName = `${documentId}.pdf`;
  const inputPath = path.join(fixtureDir, fileName);
  const extracted = await extractPdf({ inputPath });
  const candidate = buildDocumentIr({ fileName, extracted });

  const parsed = safeParseDocumentIr(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`${documentId}: regenerated DocumentIR failed schema: ${issues}`);
  }
  const documentIr = parsed.data;

  const sidecarPath = path.join(fixtureDir, `${documentId}.document-ir.json`);
  await writeFile(
    sidecarPath,
    `${JSON.stringify(documentIr, null, 2)}\n`,
    'utf8'
  );

  const blockCount = documentIr.pages.reduce(
    (sum, page) => sum + page.blocks.length,
    0
  );
  const tableBlockCount = documentIr.pages.reduce(
    (sum, page) =>
      sum + page.blocks.filter((block) => block.kind === 'table').length,
    0
  );

  return {
    documentId,
    pages: documentIr.pages.length,
    blockCount,
    tableBlockCount,
    sidecarPath: path.relative(repoRoot, sidecarPath),
  };
}

async function main(): Promise<void> {
  const requested = process.argv
    .slice(2)
    .filter((arg) => !arg.startsWith('-'));
  for (const arg of requested) {
    if (!isGoldenFixture(arg)) {
      throw new Error(
        `Unknown fixture "${arg}". Known: ${GOLDEN_FIXTURES.join(', ')}`
      );
    }
  }
  const fixtures: readonly GoldenFixture[] =
    requested.length > 0 ? (requested as GoldenFixture[]) : GOLDEN_FIXTURES;

  const regenerated = [];
  for (const documentId of fixtures) {
    regenerated.push(await regenerateOne(documentId));
  }

  console.log(JSON.stringify({ regenerated }, null, 2));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

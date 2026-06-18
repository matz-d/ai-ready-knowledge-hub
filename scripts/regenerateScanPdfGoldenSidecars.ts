#!/usr/bin/env tsx
/**
 * Regenerate committed `*.document-ir.json` sidecars for scan-pdf golden fixtures
 * from the mainline `extractScanPdfFromBuffer` path (Vertex). Updates
 * `*.expected.json` recall fields from the fresh IR when `--refresh-expected` is set.
 */
import './loadEnv';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  documentIrToKnowledgeChunks,
  P1dExpectedFixtureSchema,
  type P1dExpectedFixture,
} from '../src/eval/conversion';
import {
  mergeScanPdfExpectedRefresh,
  summarizeExpectedCoverage,
} from '../src/eval/conversion/scanPdfGoldenSidecarRefresh';
import { evalSemanticRetention } from '../src/eval/conversion/golden/evalSemanticRetention';
import { extractScanPdfFromBuffer } from '../src/lib/extractors/scanPdfDocumentExtractor';

const FIXTURE_ROOT = path.resolve(
  process.cwd(),
  'sample-data/document-conversion/scan-pdf'
);

const GOLDEN_FIXTURES = [
  {
    documentId: 'mhlw-labor-conditions-notice-blank-scan',
    expectedRefreshPolicy: 'preserve-reviewed',
  },
  {
    documentId: 'nta-withholding-form-blank-scan',
    expectedRefreshPolicy: 'preserve-reviewed',
  },
  {
    documentId: 'synthetic-employment-form-scan',
    expectedRefreshPolicy: 'append-live-fields',
  },
  {
    documentId: 'synthetic-invoice-with-pii-scan',
    expectedRefreshPolicy: 'append-live-fields',
  },
] as const;

type GoldenFixture = (typeof GOLDEN_FIXTURES)[number];
type GoldenFixtureId = GoldenFixture['documentId'];

const refreshExpected = process.argv.includes('--refresh-expected');
const goldenFixtureIds = new Set<GoldenFixtureId>(
  GOLDEN_FIXTURES.map((fixture) => fixture.documentId)
);
const onlyFixture = process.argv.find(
  (arg): arg is GoldenFixtureId =>
    !arg.startsWith('--') && goldenFixtureIds.has(arg as GoldenFixtureId)
);
const fixturesToRun = onlyFixture
  ? GOLDEN_FIXTURES.filter((fixture) => fixture.documentId === onlyFixture)
  : [...GOLDEN_FIXTURES];

function selectRecallFieldsFromChunks(
  chunks: ReturnType<typeof documentIrToKnowledgeChunks>
): string[] {
  const fields: string[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const text = chunk.text.trim();
    if (!text || text.length < 4) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    fields.push(text);
    if (fields.length >= 12) break;
  }

  return fields;
}

async function loadExpected(documentId: string): Promise<P1dExpectedFixture> {
  const filePath = path.join(FIXTURE_ROOT, `${documentId}.expected.json`);
  const raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  return P1dExpectedFixtureSchema.parse(raw);
}

async function main(): Promise<void> {
  const summary: Array<Record<string, unknown>> = [];

  for (const fixture of fixturesToRun) {
    const documentId = fixture.documentId;
    const pdfPath = path.join(FIXTURE_ROOT, `${documentId}.pdf`);
    const buffer = await readFile(pdfPath);
    const extracted = await extractScanPdfFromBuffer({
      buffer,
      fileName: path.basename(pdfPath),
    });

    const sidecarPath = path.join(FIXTURE_ROOT, `${documentId}.document-ir.json`);
    await writeFile(
      sidecarPath,
      `${JSON.stringify(extracted.documentIr, null, 2)}\n`,
      'utf8'
    );

    const chunks = documentIrToKnowledgeChunks({
      documentIr: extracted.documentIr,
      docId: documentId,
      extractorInput: `${documentId}-sidecar-regen`,
      documentSensitivity: 'Internal',
      documentAiUsePolicy: 'direct',
      title: extracted.documentIr.source.fileName,
    });

    let expectedUpdate: P1dExpectedFixture | undefined;
    if (refreshExpected) {
      const prior = await loadExpected(documentId);
      const candidateFields =
        fixture.expectedRefreshPolicy === 'append-live-fields'
          ? selectRecallFieldsFromChunks(chunks)
          : [];
      const { semanticRetention } = evalSemanticRetention({
        chunks,
        expectedFields:
          candidateFields.length > 0 ? candidateFields : prior.expectedFields,
      });
      expectedUpdate = mergeScanPdfExpectedRefresh({
        prior,
        candidateFields,
        regeneratedAt: new Date().toISOString().slice(0, 10),
        model: extracted.conversion.model,
        recall: semanticRetention.keyFieldRecall,
      });
      const expectedPath = path.join(FIXTURE_ROOT, `${documentId}.expected.json`);
      await writeFile(
        expectedPath,
        `${JSON.stringify(expectedUpdate, null, 2)}\n`,
        'utf8'
      );
    }

    summary.push({
      documentId,
      sidecarPath,
      chunkCount: chunks.length,
      model: extracted.conversion.model,
      region: extracted.conversion.region,
      refreshedExpected: Boolean(expectedUpdate),
      expectedRefreshPolicy: fixture.expectedRefreshPolicy,
      ...(expectedUpdate ? summarizeExpectedCoverage(expectedUpdate) : {}),
    });
  }

  console.log(JSON.stringify({ refreshExpected, summary }, null, 2));
}

await main();

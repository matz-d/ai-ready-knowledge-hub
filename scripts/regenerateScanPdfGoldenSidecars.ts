#!/usr/bin/env tsx
/**
 * Regenerate committed `*.document-ir.json` sidecars for scan-pdf golden fixtures
 * from the mainline `extractScanPdfFromBuffer` path (Vertex). Updates
 * `*.expected.json` recall fields from the fresh IR when `--refresh-expected` is set.
 */
import './loadEnv';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { documentIrToKnowledgeChunks } from '../src/eval/conversion/documentIrToKnowledgeChunk';
import { evalSemanticRetention } from '../src/eval/conversion/golden/evalSemanticRetention';
import { extractScanPdfFromBuffer } from '../src/lib/extractors/scanPdfDocumentExtractor';

const FIXTURE_ROOT = path.resolve(
  process.cwd(),
  'sample-data/document-conversion/scan-pdf'
);

const GOLDEN_FIXTURES = [
  'synthetic-employment-form-scan',
  'synthetic-invoice-with-pii-scan',
] as const;

const refreshExpected = process.argv.includes('--refresh-expected');
const onlyFixture = process.argv.find(
  (arg) => !arg.startsWith('--') && GOLDEN_FIXTURES.includes(arg as (typeof GOLDEN_FIXTURES)[number])
);
const fixturesToRun = onlyFixture ? [onlyFixture] : [...GOLDEN_FIXTURES];

type ExpectedFixture = {
  documentId: string;
  expectedFields: string[];
  notes?: string;
};

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

async function loadExpected(documentId: string): Promise<ExpectedFixture> {
  const filePath = path.join(FIXTURE_ROOT, `${documentId}.expected.json`);
  return JSON.parse(await readFile(filePath, 'utf8')) as ExpectedFixture;
}

async function main(): Promise<void> {
  const summary: Array<Record<string, unknown>> = [];

  for (const documentId of fixturesToRun) {
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

    let expectedUpdate: ExpectedFixture | undefined;
    if (refreshExpected) {
      const prior = await loadExpected(documentId);
      const candidateFields = selectRecallFieldsFromChunks(chunks);
      const { semanticRetention } = evalSemanticRetention({
        chunks,
        expectedFields: candidateFields,
      });
      expectedUpdate = {
        documentId,
        expectedFields: candidateFields,
        notes: (
          `${prior.notes ?? ''} ` +
          `Regenerated ${new Date().toISOString().slice(0, 10)} from mainline ` +
          `extractScanPdfFromBuffer (model=${extracted.conversion.model}, ` +
          `recall=${semanticRetention.keyFieldRecall?.toFixed(2)}).`
        ).trim(),
      };
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
      expectedFieldCount: expectedUpdate?.expectedFields.length,
    });
  }

  console.log(JSON.stringify({ refreshExpected, summary }, null, 2));
}

await main();

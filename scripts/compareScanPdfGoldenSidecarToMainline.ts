#!/usr/bin/env tsx
/**
 * Compare golden recall for scan-pdf fixtures: committed PoC sidecar vs fresh
 * mainline `extractScanPdfFromBuffer` (Vertex). Used for M6 golden baseline docs.
 */
import './loadEnv';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { documentIrToKnowledgeChunks } from '../src/eval/conversion/documentIrToKnowledgeChunk';
import { parseDocumentIr, type DocumentIr } from '../src/eval/conversion/documentIr';
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

type ExpectedFixture = {
  documentId: string;
  expectedFields: string[];
  notes?: string;
};

async function loadSidecar(documentId: string): Promise<DocumentIr> {
  const filePath = path.join(FIXTURE_ROOT, `${documentId}.document-ir.json`);
  return parseDocumentIr(JSON.parse(await readFile(filePath, 'utf8')));
}

async function loadExpected(documentId: string): Promise<ExpectedFixture> {
  const filePath = path.join(FIXTURE_ROOT, `${documentId}.expected.json`);
  return JSON.parse(await readFile(filePath, 'utf8')) as ExpectedFixture;
}

function recallForIr(ir: DocumentIr, documentId: string, expectedFields: string[]) {
  const chunks = documentIrToKnowledgeChunks({
    documentIr: ir,
    docId: documentId,
    extractorInput: `${documentId}-golden-compare`,
    documentSensitivity: 'Internal',
    documentAiUsePolicy: 'direct',
    title: ir.source.fileName,
  });
  const { semanticRetention } = evalSemanticRetention({ chunks, expectedFields });
  return {
    keyFieldRecall: semanticRetention.keyFieldRecall,
    missingExpectedFields: semanticRetention.missingExpectedFields,
    chunkCount: chunks.length,
    sourceKind: ir.source.sourceKind,
  };
}

async function main(): Promise<void> {
  const report: {
    generatedAt: string;
    fixtures: Array<{
      documentId: string;
      expectedFieldCount: number;
      sidecar: ReturnType<typeof recallForIr> & { pinned: true };
      mainline?: ReturnType<typeof recallForIr> & {
        model: string;
        region: string;
        durationMs: number;
      };
      mainlineError?: string;
    }>;
  } = {
    generatedAt: new Date().toISOString(),
    fixtures: [],
  };

  for (const documentId of GOLDEN_FIXTURES) {
    const expected = await loadExpected(documentId);
    const sidecarIr = await loadSidecar(documentId);
    const sidecar = {
      ...recallForIr(sidecarIr, documentId, expected.expectedFields),
      pinned: true as const,
    };

    const pdfPath = path.join(FIXTURE_ROOT, `${documentId}.pdf`);
    const buffer = await readFile(pdfPath);
    const startedAt = Date.now();

    let mainline:
      | (ReturnType<typeof recallForIr> & {
          model: string;
          region: string;
          durationMs: number;
        })
      | undefined;
    let mainlineError: string | undefined;

    try {
      const extracted = await extractScanPdfFromBuffer({
        buffer,
        fileName: path.basename(pdfPath),
      });
      mainline = {
        ...recallForIr(
          extracted.documentIr,
          documentId,
          expected.expectedFields
        ),
        model: extracted.conversion.model,
        region: extracted.conversion.region,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      mainlineError =
        error instanceof Error ? error.message : String(error);
    }

    report.fixtures.push({
      documentId,
      expectedFieldCount: expected.expectedFields.length,
      sidecar,
      mainline,
      mainlineError,
    });
  }

  console.log(JSON.stringify(report, null, 2));
}

await main();

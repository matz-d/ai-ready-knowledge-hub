/**
 * Golden semantic retention against the four `official-doc-pdf` fixtures and
 * their `*.expected.json` sidecars (Phase 3-H-2 §7.2).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { documentIrToKnowledgeChunks } from '../../documentIrToKnowledgeChunk';
import { parseDocumentIr, type DocumentIr } from '../../documentIr';
import { evalSemanticRetention } from '../evalSemanticRetention';
import { runConversionEvalGoldenCheck } from '../../runConversionEvalGoldenCheck';

const FIXTURE_DIR = resolve(
  process.cwd(),
  'sample-data/document-conversion/official-doc-pdf'
);

const FIXTURE_BASENAMES = [
  'mhlw-overtime-limit-guide',
  'mhlw-r07-model-work-rules',
  'mhlw-labor-conditions-notice-general',
  'synthetic-employment-context-with-pii',
] as const;

type FixtureBasename = (typeof FIXTURE_BASENAMES)[number];

type ExpectedFieldsFixture = {
  documentId: string;
  expectedFields: string[];
  notes?: string;
};

function loadIr(basename: FixtureBasename): DocumentIr {
  const filePath = resolve(FIXTURE_DIR, `${basename}.document-ir.json`);
  return parseDocumentIr(JSON.parse(readFileSync(filePath, 'utf8')));
}

function loadExpected(basename: FixtureBasename): ExpectedFieldsFixture {
  const filePath = resolve(FIXTURE_DIR, `${basename}.expected.json`);
  return JSON.parse(readFileSync(filePath, 'utf8')) as ExpectedFieldsFixture;
}

function chunksFromIr(ir: DocumentIr, basename: string) {
  return documentIrToKnowledgeChunks({
    documentIr: ir,
    docId: basename,
    extractorInput: `${basename}-fixture-bytes`,
    documentSensitivity: 'Internal',
    documentAiUsePolicy: 'direct',
    title: ir.source.fileName,
  });
}

const FIXTURES = FIXTURE_BASENAMES.reduce(
  (acc, name) => {
    acc[name] = {
      ir: loadIr(name),
      expected: loadExpected(name),
    };
    return acc;
  },
  {} as Record<
    FixtureBasename,
    { ir: DocumentIr; expected: ExpectedFieldsFixture }
  >
);

describe('evalSemanticRetention (golden fixtures)', () => {
  it.each(FIXTURE_BASENAMES)(
    '%s computes keyFieldRecall from expected.json',
    (basename) => {
      const { ir, expected } = FIXTURES[basename];
      expect(expected.documentId).toBe(basename);

      const chunks = chunksFromIr(ir, basename);
      const { semanticRetention } = evalSemanticRetention({
        chunks,
        expectedFields: expected.expectedFields,
      });

      expect(expected.expectedFields.length).toBeGreaterThan(0);
      expect(semanticRetention.keyFieldRecall).toBeGreaterThanOrEqual(0);
      expect(semanticRetention.keyFieldRecall).toBeLessThanOrEqual(1);
      expect(
        semanticRetention.missingExpectedFields.length +
          Math.round(
            (semanticRetention.keyFieldRecall ?? 0) *
              expected.expectedFields.length
          )
      ).toBe(expected.expectedFields.length);
    }
  );
});

describe('runConversionEvalGoldenCheck (golden fixtures)', () => {
  it.each(FIXTURE_BASENAMES)(
    '%s returns golden-stage semanticRetention without calling DLP',
    async (basename) => {
      const { ir, expected } = FIXTURES[basename];
      const chunks = chunksFromIr(ir, basename);

      const result = await runConversionEvalGoldenCheck({
        sourceSubtype: 'official-doc-pdf',
        documentIr: ir,
        chunks,
        expectedFields: expected.expectedFields,
      });

      expect(result.semanticRetention.keyFieldRecall).toBeDefined();
      expect(result.semanticRetention.missingExpectedFields).toBeInstanceOf(
        Array
      );
      expect(result.coverage.pageCoverage).toBeGreaterThan(0);
      expect(result.locatorQuality.hasPageLocators).toBe(true);
    }
  );
});

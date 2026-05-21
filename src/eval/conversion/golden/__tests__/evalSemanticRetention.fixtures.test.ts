/**
 * Golden semantic retention against official-doc-pdf + scan-pdf fixtures and
 * their `*.expected.json` sidecars (Phase 3-H-2/3 §7.2).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { documentIrToKnowledgeChunks } from '../../documentIrToKnowledgeChunk';
import { parseDocumentIr, type DocumentIr } from '../../documentIr';
import { evalSemanticRetention } from '../evalSemanticRetention';
import { runConversionEvalGoldenCheck } from '../../runConversionEvalGoldenCheck';

const FIXTURE_ROOT_DIR = resolve(
  process.cwd(),
  'sample-data/document-conversion'
);

const FIXTURE_DEFINITIONS = [
  {
    directory: 'official-doc-pdf',
    basename: 'mhlw-overtime-limit-guide',
    sourceSubtype: 'official-doc-pdf',
  },
  {
    directory: 'official-doc-pdf',
    basename: 'mhlw-r07-model-work-rules',
    sourceSubtype: 'official-doc-pdf',
  },
  {
    directory: 'official-doc-pdf',
    basename: 'mhlw-labor-conditions-notice-general',
    sourceSubtype: 'official-doc-pdf',
  },
  {
    directory: 'official-doc-pdf',
    basename: 'synthetic-employment-context-with-pii',
    sourceSubtype: 'official-doc-pdf',
  },
  {
    directory: 'scan-pdf',
    basename: 'synthetic-employment-form-scan',
    sourceSubtype: 'scan-pdf',
  },
  {
    directory: 'scan-pdf',
    basename: 'synthetic-invoice-with-pii-scan',
    sourceSubtype: 'scan-pdf',
  },
] as const;

type FixtureDefinition = (typeof FIXTURE_DEFINITIONS)[number];

type ExpectedFieldsFixture = {
  documentId: string;
  expectedFields: string[];
  notes?: string;
};

function loadIr(fixture: FixtureDefinition): DocumentIr {
  const filePath = resolve(
    FIXTURE_ROOT_DIR,
    fixture.directory,
    `${fixture.basename}.document-ir.json`
  );
  return parseDocumentIr(JSON.parse(readFileSync(filePath, 'utf8')));
}

function loadExpected(fixture: FixtureDefinition): ExpectedFieldsFixture {
  const filePath = resolve(
    FIXTURE_ROOT_DIR,
    fixture.directory,
    `${fixture.basename}.expected.json`
  );
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

type LoadedFixture = FixtureDefinition & {
  ir: DocumentIr;
  expected: ExpectedFieldsFixture;
};

const FIXTURES: LoadedFixture[] = FIXTURE_DEFINITIONS.map((fixture) => ({
  ...fixture,
  ir: loadIr(fixture),
  expected: loadExpected(fixture),
}));

describe('evalSemanticRetention (golden fixtures)', () => {
  it.each(FIXTURES)(
    '$basename computes keyFieldRecall from expected.json',
    ({ basename, ir, expected }) => {
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
  it.each(FIXTURES)(
    '$basename returns golden-stage semanticRetention without calling DLP',
    async ({ basename, sourceSubtype, ir, expected }) => {
      const chunks = chunksFromIr(ir, basename);

      const result = await runConversionEvalGoldenCheck({
        sourceSubtype,
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

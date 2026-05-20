/**
 * Heuristic eval functions, exercised against the four `official-doc-pdf`
 * DocumentIR fixtures committed under
 * `sample-data/document-conversion/official-doc-pdf/`.
 *
 * The fixtures are intentionally small but mirror real-world shapes:
 *  - `mhlw-overtime-limit-guide` / `mhlw-r07-model-work-rules` / `mhlw-labor-conditions-notice-general`
 *    cover the "public document, full page coverage, has tables" case.
 *  - `synthetic-employment-context-with-pii` covers partial coverage
 *    (one page with whitespace-only blocks) and the `image_text` block kind.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_FIRESTORE_CHUNK_DOCUMENT_BYTES } from '../../../../lib/knowledgeChunkSchema';
import { parseDocumentIr, type DocumentIr } from '../../documentIr';
import { evalCoverage, LOW_DENSITY_PAGE_CHAR_THRESHOLD } from '../evalCoverage';
import { evalLocatorQuality } from '../evalLocatorQuality';
import { evalContextPackageReadiness } from '../evalContextPackageReadiness';

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

function loadIr(basename: FixtureBasename): DocumentIr {
  const filePath = resolve(FIXTURE_DIR, `${basename}.document-ir.json`);
  return parseDocumentIr(JSON.parse(readFileSync(filePath, 'utf8')));
}

const FIXTURES: Record<FixtureBasename, DocumentIr> = FIXTURE_BASENAMES.reduce(
  (acc, name) => {
    acc[name] = loadIr(name);
    return acc;
  },
  {} as Record<FixtureBasename, DocumentIr>
);

describe('evalCoverage (heuristic, fixture-driven)', () => {
  it('mhlw-overtime-limit-guide: full coverage and 3 table candidates', () => {
    const { coverage } = evalCoverage({
      documentIr: FIXTURES['mhlw-overtime-limit-guide'],
      chunks: [],
    });
    expect(coverage.pageCoverage).toBe(1);
    expect(coverage.tableCandidates).toBe(3);
  });

  it('mhlw-r07-model-work-rules: full coverage and 2 table candidates', () => {
    const { coverage } = evalCoverage({
      documentIr: FIXTURES['mhlw-r07-model-work-rules'],
      chunks: [],
    });
    expect(coverage.pageCoverage).toBe(1);
    expect(coverage.tableCandidates).toBe(2);
  });

  it('mhlw-labor-conditions-notice-general: full coverage and 4 table candidates', () => {
    const { coverage } = evalCoverage({
      documentIr: FIXTURES['mhlw-labor-conditions-notice-general'],
      chunks: [],
    });
    expect(coverage.pageCoverage).toBe(1);
    expect(coverage.tableCandidates).toBe(4);
  });

  it('synthetic-employment-context-with-pii: partial coverage flags whitespace-only page', () => {
    const ir = FIXTURES['synthetic-employment-context-with-pii'];
    const { coverage } = evalCoverage({ documentIr: ir, chunks: [] });
    // 3 of 4 pages have at least one non-empty block; page 3 is whitespace-only.
    expect(coverage.pageCoverage).toBeCloseTo(0.75, 5);
    expect(coverage.tableCandidates).toBe(0);
    // The whitespace-only page must produce an "all blocks empty after trim"
    // warning so reviewers can see the gap.
    expect(
      coverage.textDensityWarnings.some((w) => w.includes('page 3'))
    ).toBe(true);
  });

  it('returns zero coverage and no warnings for an empty document', () => {
    const emptyIr = parseDocumentIr({
      schemaVersion: 1,
      source: {
        fileName: 'empty.pdf',
        mediaType: 'application/pdf',
        sourceKind: 'poc',
        sourceSubtype: 'official-doc-pdf',
      },
      pages: [],
    });
    const { coverage } = evalCoverage({ documentIr: emptyIr, chunks: [] });
    expect(coverage.pageCoverage).toBe(0);
    expect(coverage.tableCandidates).toBe(0);
    expect(coverage.textDensityWarnings).toEqual([]);
  });

  it('flags a low-density single-block page via textDensityWarnings', () => {
    const shortIr = parseDocumentIr({
      schemaVersion: 1,
      source: {
        fileName: 'short.pdf',
        mediaType: 'application/pdf',
        sourceKind: 'poc',
        sourceSubtype: 'official-doc-pdf',
      },
      pages: [
        {
          pageNumber: 1,
          blocks: [
            {
              blockId: 'p1-b1',
              kind: 'paragraph',
              text: 'short',
              locator: { pageNumber: 1 },
            },
          ],
        },
      ],
    });
    const { coverage } = evalCoverage({ documentIr: shortIr, chunks: [] });
    expect(coverage.pageCoverage).toBe(1);
    expect(coverage.textDensityWarnings).toHaveLength(1);
    expect(coverage.textDensityWarnings[0]).toContain('page 1');
    expect(coverage.textDensityWarnings[0]).toContain(
      String(LOW_DENSITY_PAGE_CHAR_THRESHOLD)
    );
  });
});

describe('evalLocatorQuality (heuristic, fixture-driven)', () => {
  it.each([
    ['mhlw-overtime-limit-guide', true, true],
    ['mhlw-r07-model-work-rules', true, true],
    ['mhlw-labor-conditions-notice-general', true, true],
    ['synthetic-employment-context-with-pii', true, false],
  ] as const)(
    '%s reports hasPageLocators=%s and hasTableLocators=%s',
    (basename, expectedPage, expectedTable) => {
      const { locatorQuality } = evalLocatorQuality({
        documentIr: FIXTURES[basename],
        chunks: [],
      });
      expect(locatorQuality.hasPageLocators).toBe(expectedPage);
      expect(locatorQuality.hasTableLocators).toBe(expectedTable);
    }
  );

  it('reports both locators false for a document with no locators', () => {
    const noLocatorIr = parseDocumentIr({
      schemaVersion: 1,
      source: {
        fileName: 'no-locator.pdf',
        mediaType: 'application/pdf',
        sourceKind: 'poc',
        sourceSubtype: 'official-doc-pdf',
      },
      pages: [
        {
          pageNumber: 1,
          blocks: [
            { blockId: 'p1-b1', kind: 'paragraph', text: 'hello world' },
          ],
        },
      ],
    });
    const { locatorQuality } = evalLocatorQuality({
      documentIr: noLocatorIr,
      chunks: [],
    });
    expect(locatorQuality).toEqual({
      hasPageLocators: false,
      hasTableLocators: false,
    });
  });
});

describe('evalContextPackageReadiness (heuristic)', () => {
  const baseIr = FIXTURES['mhlw-overtime-limit-guide'];

  it('counts chunks, average length, empty and oversized chunks', () => {
    const chunks = [
      { text: 'alpha' },
      { text: 'beta gamma' },
      { text: '   ' },
    ];
    const { contextPackageReadiness } = evalContextPackageReadiness({
      documentIr: baseIr,
      chunks,
    });
    expect(contextPackageReadiness.chunkCount).toBe(3);
    expect(contextPackageReadiness.emptyChunks).toBe(1);
    expect(contextPackageReadiness.oversizedChunks).toBe(0);
    expect(contextPackageReadiness.averageChunkLength).toBeCloseTo(
      (5 + 10 + 3) / 3,
      5
    );
  });

  it('flags chunks whose JSON serialisation exceeds the Firestore byte cap', () => {
    const oversizedText = 'x'.repeat(MAX_FIRESTORE_CHUNK_DOCUMENT_BYTES + 1024);
    const { contextPackageReadiness } = evalContextPackageReadiness({
      documentIr: baseIr,
      chunks: [{ text: 'normal' }, { text: oversizedText }],
    });
    expect(contextPackageReadiness.chunkCount).toBe(2);
    expect(contextPackageReadiness.oversizedChunks).toBe(1);
    expect(contextPackageReadiness.emptyChunks).toBe(0);
  });

  it('returns zeros for an empty chunk list', () => {
    const { contextPackageReadiness } = evalContextPackageReadiness({
      documentIr: baseIr,
      chunks: [],
    });
    expect(contextPackageReadiness).toEqual({
      chunkCount: 0,
      averageChunkLength: 0,
      oversizedChunks: 0,
      emptyChunks: 0,
    });
  });
});

/**
 * Regression guards for official-doc-pdf stable sidecar policy (PR3).
 *
 * PR1/PR2 aligned committed fixtures with product-quality Context Package
 * inputs. These tests lock that contract so a mistaken
 * `pnpm fixtures:official-doc-pdf:sidecars` run cannot silently revert labor
 * back to raw pdf-parse without CI catching it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { P1dExpectedFixtureSchema } from '../../p1dQualityGate';
import { parseDocumentIr, type DocumentIr } from '../../documentIr';
import { evalLocatorQuality } from '../evalLocatorQuality';

const FIXTURE_DIR = resolve(
  process.cwd(),
  'sample-data/document-conversion/official-doc-pdf'
);

const RAW_PDF_PARSE_BASELINE_FIXTURES = [
  'mhlw-overtime-limit-guide',
  'mhlw-r07-model-work-rules',
] as const;

const TABLE_ASSIST_STABLE_FIXTURE = 'mhlw-labor-conditions-notice-general';
const HAND_AUTHORED_QUALITY_FIXTURE = 'synthetic-employment-context-with-pii';

/** Pinned count from PR2 table-assist refresh (rowsMerged=8). */
const LABOR_TABLE_ASSIST_BLOCK_FLOOR = 8;

const BLANK_FORM_SAMPLE_FILLED_VALUES = ['○○事業所', '事務職'] as const;

function loadDocumentIrFixture(documentId: string): DocumentIr {
  const filePath = resolve(FIXTURE_DIR, `${documentId}.document-ir.json`);
  return parseDocumentIr(JSON.parse(readFileSync(filePath, 'utf8')));
}

function loadExpectedFixture(documentId: string) {
  const filePath = resolve(FIXTURE_DIR, `${documentId}.expected.json`);
  return P1dExpectedFixtureSchema.parse(
    JSON.parse(readFileSync(filePath, 'utf8'))
  );
}

function tableAssistBlocks(documentIr: DocumentIr) {
  return documentIr.pages.flatMap((page) =>
    page.blocks.filter(
      (block) =>
        block.kind === 'table' &&
        block.metadata?.extractionProvider === 'gemini-table-assist' &&
        block.metadata?.tableAssist === true
    )
  );
}

function collectPdfTableLocatorIds(documentIr: DocumentIr): Set<string> {
  const ids = new Set<string>();
  for (const page of documentIr.pages) {
    for (const block of page.blocks) {
      const pageNumber = block.locator?.pageNumber;
      const tableIndex = block.locator?.tableIndex;
      if (pageNumber !== undefined && tableIndex !== undefined) {
        ids.add(`p${pageNumber}-t${tableIndex}`);
      }
    }
  }
  return ids;
}

function parseExpectedPdfTableId(
  tableId: string
): { page: number; tableIndex: number } | null {
  const match = /^p(\d+)-t(\d+)$/u.exec(tableId);
  if (!match) return null;
  return {
    page: Number(match[1]),
    tableIndex: Number(match[2]),
  };
}

describe('official-doc-pdf stable sidecar policy', () => {
  it.each(RAW_PDF_PARSE_BASELINE_FIXTURES)(
    '%s remains a raw pdf-parse stable sidecar without table-assist blocks',
    (documentId) => {
      const documentIr = loadDocumentIrFixture(documentId);
      expect(tableAssistBlocks(documentIr)).toEqual([]);
    }
  );

  it('mhlw-labor-conditions-notice-general is intentionally table-assist-augmented', () => {
    const documentIr = loadDocumentIrFixture(TABLE_ASSIST_STABLE_FIXTURE);
    const assistBlocks = tableAssistBlocks(documentIr);
    expect(assistBlocks.length).toBeGreaterThanOrEqual(
      LABOR_TABLE_ASSIST_BLOCK_FLOOR
    );

    for (const block of assistBlocks) {
      expect(block.metadata?.extractionProvider).toBe('gemini-table-assist');
      expect(block.metadata?.tableAssist).toBe(true);
      expect(block.locator?.pageNumber).toBeDefined();
      expect(block.locator?.tableIndex).toBeDefined();
      expect(block.locator?.rowIndex).toBeDefined();
    }

    const { locatorQuality } = evalLocatorQuality({
      documentIr,
      chunks: [],
    });
    expect(locatorQuality.hasPageLocators).toBe(true);
    expect(locatorQuality.hasTableLocators).toBe(true);
  });

  it('synthetic-employment-context-with-pii remains a hand-authored quality fixture', () => {
    const documentIr = loadDocumentIrFixture(HAND_AUTHORED_QUALITY_FIXTURE);
    expect(documentIr.source.sourceKind).toBe('poc');
    expect(tableAssistBlocks(documentIr)).toEqual([]);
  });
});

describe('mhlw-labor-conditions-notice-general expected sidecar consistency', () => {
  const documentIr = loadDocumentIrFixture(TABLE_ASSIST_STABLE_FIXTURE);
  const expected = loadExpectedFixture(TABLE_ASSIST_STABLE_FIXTURE);
  const tableLocatorIds = collectPdfTableLocatorIds(documentIr);

  it('keeps expectedTableCells as an array tied to real table locators', () => {
    expect(Array.isArray(expected.expectedTableCells)).toBe(true);
    if (!Array.isArray(expected.expectedTableCells)) {
      return;
    }

    for (const cell of expected.expectedTableCells) {
      expect(cell.tableId).toBeDefined();
      const parsed = parseExpectedPdfTableId(cell.tableId ?? '');
      expect(parsed).not.toBeNull();
      expect(tableLocatorIds.has(cell.tableId ?? '')).toBe(true);
    }
  });

  it('does not expect sample-filled values absent from the public blank MHLW PDF', () => {
    const serializedExpected = JSON.stringify({
      expectedValues: expected.expectedValues,
      expectedTableCells: expected.expectedTableCells,
    });

    for (const sampleValue of BLANK_FORM_SAMPLE_FILLED_VALUES) {
      expect(serializedExpected).not.toContain(sampleValue);
    }
  });
});

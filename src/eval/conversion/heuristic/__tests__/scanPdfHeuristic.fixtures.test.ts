/**
 * Scan-pdf heuristic eval fixture tests — Phase 3-H-3 M6 W4.
 *
 * Verifies heuristic axis statuses against the committed DocumentIR sidecars for
 * scan-pdf fixtures and fixes the subtype-aware safety_readiness policy boundary.
 *
 * PoC measurement summary (docs/phase-3-h-3-scan-pdf-poc-measurement.md §4):
 *
 *   nta-withholding-form-blank-scan: 1 page, health=pass, pii_total=13, pii_unmaskable=0
 *   - Gemini OCR misidentifies printed form label text (氏名・住所 etc.) as PII.
 *   - All 13 findings are maskable; unmaskable=0 means safety_readiness stays pass.
 *   - This confirms that `piiFindings.total > 0` must NOT trigger a warn/fail:
 *     doing so would reject all blank-form scans even though they contain no real PII.
 *
 *   synthetic-invoice-with-pii-scan: 1 page, health=pass, pii_total=8-10, pii_unmaskable=0
 *   - Invoice with customer name/address; all PII was localized to maskable chunks.
 *   - unmaskable=0 in PoC; the warn path (unmaskable > 0) is exercised in the
 *     policy unit tests below, not here, because DLP runs dry in heuristic stage.
 *
 *   degraded-scan-fail-closed: 6 MB, health=pass in PoC (no block-level failure).
 *   - degraded fixture is kept as a route-level 413 size-limit evidence artifact.
 *   - It is NOT loaded here because it exceeds MAX_UPLOAD_BYTES (5 MiB) and its
 *     PoC health=pass means it cannot serve as an OCR fail-closed trigger fixture.
 *   - A heuristic-level zero-block fixture would require further image degradation.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEmptyConversionEvalResult } from '../../conversionEvalResult';
import {
  parseDocumentIr,
  type DocumentIr,
} from '../../documentIr';
import { evalSafetyReadiness } from '../../evalSafetyReadiness';
import {
  deriveAxisStatuses,
  rollupOverallStatus,
} from '../../rollupOverallStatus';
import { evalCoverage } from '../evalCoverage';
import { evalLocatorQuality } from '../evalLocatorQuality';
import { runConversionEvalHeuristic } from '../runConversionEvalHeuristic';

const FIXTURE_DIR = resolve(
  process.cwd(),
  'sample-data/document-conversion/scan-pdf'
);

type ScanFixtureBasename =
  | 'nta-withholding-form-blank-scan'
  | 'synthetic-invoice-with-pii-scan';

function loadScanIr(basename: ScanFixtureBasename): DocumentIr {
  const filePath = resolve(FIXTURE_DIR, `${basename}.document-ir.json`);
  return parseDocumentIr(JSON.parse(readFileSync(filePath, 'utf8')));
}

// ---------------------------------------------------------------------------
// Policy unit tests — subtype-aware safety_readiness (D-P3-H-7 Q2)
// ---------------------------------------------------------------------------

describe('evalSafetyReadiness — scan-pdf subtype policy', () => {
  it('scan-pdf: unmaskablePiiFindings=0 → pass', () => {
    const result = createEmptyConversionEvalResult();
    result.safetyReadiness.unmaskablePiiFindings = 0;
    expect(evalSafetyReadiness(result, 'heuristic', 'scan-pdf')).toBe('pass');
  });

  it('scan-pdf: unmaskablePiiFindings > 0 → warn (not fail)', () => {
    const result = createEmptyConversionEvalResult();
    result.safetyReadiness.unmaskablePiiFindings = 1;
    expect(evalSafetyReadiness(result, 'heuristic', 'scan-pdf')).toBe('warn');
  });

  it('official-doc-pdf: unmaskablePiiFindings > 0 → fail (policy unchanged)', () => {
    const result = createEmptyConversionEvalResult();
    result.safetyReadiness.unmaskablePiiFindings = 1;
    expect(
      evalSafetyReadiness(result, 'heuristic', 'official-doc-pdf')
    ).toBe('fail');
  });

  it('slide-pdf: unmaskablePiiFindings > 0 → fail (policy unchanged)', () => {
    const result = createEmptyConversionEvalResult();
    result.safetyReadiness.unmaskablePiiFindings = 1;
    expect(evalSafetyReadiness(result, 'heuristic', 'slide-pdf')).toBe('fail');
  });

  it('health stage: always pass regardless of subtype', () => {
    const result = createEmptyConversionEvalResult();
    result.safetyReadiness.unmaskablePiiFindings = 99;
    expect(evalSafetyReadiness(result, 'health', 'scan-pdf')).toBe('pass');
    expect(evalSafetyReadiness(result, 'health', 'official-doc-pdf')).toBe(
      'pass'
    );
  });
});

describe('rollupOverallStatus — scan-pdf subtype propagation', () => {
  it('scan-pdf: unmaskable > 0 downgrades to overall warn (not fail)', () => {
    const result = createEmptyConversionEvalResult();
    result.coverage.pageCoverage = 1;
    result.locatorQuality.hasPageLocators = true;
    result.locatorQuality.hasTableLocators = true;
    result.safetyReadiness.unmaskablePiiFindings = 3;
    expect(
      rollupOverallStatus(result, 'heuristic', 'scan-pdf')
    ).toEqual({
      status: 'warn',
      reasons: ['safety_readiness: warn'],
    });
  });

  it('official-doc-pdf: unmaskable > 0 keeps fail policy', () => {
    const result = createEmptyConversionEvalResult();
    result.coverage.pageCoverage = 1;
    result.safetyReadiness.unmaskablePiiFindings = 1;
    expect(
      rollupOverallStatus(result, 'heuristic', 'official-doc-pdf').status
    ).toBe('fail');
  });
});

// ---------------------------------------------------------------------------
// Fixture-driven axis status tests
// ---------------------------------------------------------------------------

describe('nta-withholding-form-blank-scan fixture', () => {
  const ir = loadScanIr('nta-withholding-form-blank-scan');

  it('sourceSubtype is scan-pdf', () => {
    expect(ir.source.sourceSubtype).toBe('scan-pdf');
  });

  it('coverage: full pageCoverage (1 page, all blocks non-empty)', () => {
    const { coverage } = evalCoverage(
      { documentIr: ir, chunks: [] },
      { sourceSubtype: 'scan-pdf' }
    );
    expect(coverage.pageCoverage).toBe(1);
    // Blank form: no table candidates in OCR output
    expect(coverage.tableCandidates).toBe(0);
    expect(coverage.textDensityWarnings).toHaveLength(0);
  });

  it('locatorQuality: page locators present, no table locators', () => {
    const { locatorQuality } = evalLocatorQuality({ documentIr: ir, chunks: [] });
    expect(locatorQuality.hasPageLocators).toBe(true);
    expect(locatorQuality.hasTableLocators).toBe(false);
  });

  it('deriveAxisStatuses with dry-run DLP: coverage=pass, locator=warn, safety=pass', () => {
    const result = createEmptyConversionEvalResult();
    result.coverage = evalCoverage(
      { documentIr: ir, chunks: [] },
      { sourceSubtype: 'scan-pdf' }
    ).coverage;
    result.locatorQuality = evalLocatorQuality({
      documentIr: ir,
      chunks: [],
    }).locatorQuality;
    // dry-run DLP: unmaskablePiiFindings=0 (PoC confirmed unmaskable=0 even with total=13)
    result.safetyReadiness.unmaskablePiiFindings = 0;

    const axes = deriveAxisStatuses(result, 'heuristic', 'scan-pdf');
    expect(axes.coverage).toBe('pass');
    expect(axes.locatorQuality).toBe('warn'); // page locators only → warn
    expect(axes.safetyReadiness).toBe('pass');
  });
});

describe('synthetic-invoice-with-pii-scan fixture', () => {
  const ir = loadScanIr('synthetic-invoice-with-pii-scan');

  it('sourceSubtype is scan-pdf', () => {
    expect(ir.source.sourceSubtype).toBe('scan-pdf');
  });

  it('coverage: full pageCoverage (1 page), 1 table candidate', () => {
    const { coverage } = evalCoverage(
      { documentIr: ir, chunks: [] },
      { sourceSubtype: 'scan-pdf' }
    );
    expect(coverage.pageCoverage).toBe(1);
    expect(coverage.tableCandidates).toBe(1);
    expect(coverage.textDensityWarnings).toHaveLength(0);
  });

  it('locatorQuality: page locators present, table locators present', () => {
    const { locatorQuality } = evalLocatorQuality({ documentIr: ir, chunks: [] });
    expect(locatorQuality.hasPageLocators).toBe(true);
    expect(locatorQuality.hasTableLocators).toBe(true);
  });

  it('deriveAxisStatuses with dry-run DLP: safety=pass (unmaskable=0 from PoC)', () => {
    const result = createEmptyConversionEvalResult();
    result.coverage = evalCoverage(
      { documentIr: ir, chunks: [] },
      { sourceSubtype: 'scan-pdf' }
    ).coverage;
    result.locatorQuality = evalLocatorQuality({
      documentIr: ir,
      chunks: [],
    }).locatorQuality;
    result.safetyReadiness.unmaskablePiiFindings = 0;

    const axes = deriveAxisStatuses(result, 'heuristic', 'scan-pdf');
    expect(axes.coverage).toBe('pass');
    expect(axes.locatorQuality).toBe('pass');
    expect(axes.safetyReadiness).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// OCR zero-block-page coverage warning (scan-pdf observation channel)
// ---------------------------------------------------------------------------

describe('evalCoverage scan-pdf zero-block-page warning', () => {
  it('emits zero-block-page warning for scan-pdf when a page has no OCR blocks', () => {
    const ir = parseDocumentIr({
      schemaVersion: 1,
      source: {
        fileName: 'partial-ocr.pdf',
        mediaType: 'application/pdf',
        sourceKind: 'upload',
        sourceSubtype: 'scan-pdf',
      },
      pages: [
        {
          pageNumber: 1,
          blocks: [
            {
              blockId: 'p1-ocr1',
              kind: 'paragraph',
              // text must be >= LOW_DENSITY_PAGE_CHAR_THRESHOLD (50) to avoid density warning
              text: '給与所得者の扶養控除等申告書（令和7年分）における氏名・住所・生年月日等の基本事項を記入してください。',
              locator: { pageNumber: 1 },
            },
          ],
        },
        {
          pageNumber: 2,
          blocks: [], // OCR produced nothing for this page
        },
      ],
    });

    const { coverage } = evalCoverage(
      { documentIr: ir, chunks: [] },
      { sourceSubtype: 'scan-pdf' }
    );

    expect(coverage.pageCoverage).toBe(0.5);
    expect(coverage.textDensityWarnings).toHaveLength(1);
    expect(coverage.textDensityWarnings[0]).toContain('page 2');
    expect(coverage.textDensityWarnings[0]).toContain('zero OCR blocks');
  });

  it('runConversionEvalHeuristic propagates zero-block-page warning for scan-pdf IR', async () => {
    const ir = parseDocumentIr({
      schemaVersion: 1,
      source: {
        fileName: 'partial-ocr.pdf',
        mediaType: 'application/pdf',
        sourceKind: 'upload',
        sourceSubtype: 'scan-pdf',
      },
      pages: [
        {
          pageNumber: 1,
          blocks: [
            {
              blockId: 'p1-ocr1',
              kind: 'paragraph',
              text: '給与所得者の扶養控除等申告書（令和7年分）における氏名・住所・生年月日等の基本事項を記入してください。',
              locator: { pageNumber: 1 },
            },
          ],
        },
        { pageNumber: 2, blocks: [] },
      ],
    });

    const result = await runConversionEvalHeuristic({
      documentIr: ir,
      chunks: [],
    });

    expect(result.coverage.pageCoverage).toBe(0.5);
    expect(result.coverage.textDensityWarnings).toHaveLength(1);
    expect(result.coverage.textDensityWarnings[0]).toContain('zero OCR blocks');
  });

  it('does NOT emit zero-block-page warning for official-doc-pdf (structural blank page)', () => {
    const ir = parseDocumentIr({
      schemaVersion: 1,
      source: {
        fileName: 'section-divider.pdf',
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
              // text must be >= LOW_DENSITY_PAGE_CHAR_THRESHOLD (50) to avoid density warning
              text: '労働基準法第36条に基づく時間外・休日労働に関する協定届（一般条項）の記載事項と注意事項を確認してください。',
              locator: { pageNumber: 1 },
            },
          ],
        },
        {
          pageNumber: 2,
          blocks: [], // blank separator page — no scan-pdf warning expected
        },
      ],
    });

    const { coverage } = evalCoverage(
      { documentIr: ir, chunks: [] },
      { sourceSubtype: 'official-doc-pdf' }
    );

    expect(coverage.pageCoverage).toBe(0.5);
    // No warnings for official-doc-pdf zero-block pages
    expect(coverage.textDensityWarnings).toHaveLength(0);
  });
});

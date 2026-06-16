import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluateGeminiCompareGuard,
  isGeminiCloudInferenceEnabled,
  isRealPathUnderFixtureDir,
  isResolvedPathUnderDir,
} from '../../../../poc/document-conversion/official-doc-pdf/compare/geminiCompareGuard';
import { fixtureDir } from '../../../../poc/document-conversion/shared/paths';

const FIXTURE_DIR = fixtureDir('official-doc-pdf');
const PUBLIC_FIXTURE = path.join(
  FIXTURE_DIR,
  'mhlw-labor-conditions-notice-general.pdf'
);
const SYNTHETIC_GOLDEN = path.join(
  FIXTURE_DIR,
  'synthetic-official-doc-table-assist-golden.pdf'
);

describe('geminiCompareGuard', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('requires OFFICIAL_DOC_PDF_GEMINI_ENABLE=1 before any Gemini arm runs', () => {
    delete process.env.OFFICIAL_DOC_PDF_GEMINI_ENABLE;
    expect(isGeminiCloudInferenceEnabled()).toBe(false);
    expect(
      evaluateGeminiCompareGuard({
        inputPath: PUBLIC_FIXTURE,
        basename: 'mhlw-labor-conditions-notice-general',
        fixtureDir: FIXTURE_DIR,
      })
    ).toEqual({
      allowed: false,
      reason:
        'Gemini arms skipped; set OFFICIAL_DOC_PDF_GEMINI_ENABLE=1 to run cloud inference explicitly.',
    });
  });

  it('allows a public fixture under the fixture directory when opt-in is set', () => {
    process.env.OFFICIAL_DOC_PDF_GEMINI_ENABLE = '1';
    expect(
      evaluateGeminiCompareGuard({
        inputPath: PUBLIC_FIXTURE,
        basename: 'mhlw-labor-conditions-notice-general',
        fixtureDir: FIXTURE_DIR,
      })
    ).toEqual({ allowed: true });
  });

  it('blocks arbitrary PDF paths outside the fixture directory even with opt-in', () => {
    process.env.OFFICIAL_DOC_PDF_GEMINI_ENABLE = '1';
    const outside = '/tmp/confidential-payroll.pdf';
    expect(
      evaluateGeminiCompareGuard({
        inputPath: outside,
        basename: 'confidential-payroll',
        fixtureDir: FIXTURE_DIR,
      })
    ).toEqual({
      allowed: false,
      reason:
        'Gemini arms only run for PDFs under the official-doc-pdf fixture directory.',
    });
    expect(
      isResolvedPathUnderDir(path.resolve(outside), path.resolve(FIXTURE_DIR))
    ).toBe(false);
  });

  it('still blocks non-public synthetic fixtures unless explicitly allowlisted', () => {
    process.env.OFFICIAL_DOC_PDF_GEMINI_ENABLE = '1';
    const syntheticPii = path.join(
      FIXTURE_DIR,
      'synthetic-employment-context-with-pii.pdf'
    );
    expect(
      evaluateGeminiCompareGuard({
        inputPath: syntheticPii,
        basename: 'synthetic-employment-context-with-pii',
        fixtureDir: FIXTURE_DIR,
      })
    ).toEqual({
      allowed: false,
      reason:
        'Gemini arm skipped for non-public fixture; set OFFICIAL_DOC_PDF_GEMINI_INCLUDE_NON_PUBLIC_FIXTURES=1 to run explicitly.',
    });
  });

  it('allows the PII-free synthetic golden when opt-in is set', () => {
    process.env.OFFICIAL_DOC_PDF_GEMINI_ENABLE = '1';
    expect(
      evaluateGeminiCompareGuard({
        inputPath: SYNTHETIC_GOLDEN,
        basename: 'synthetic-official-doc-table-assist-golden',
        fixtureDir: FIXTURE_DIR,
      })
    ).toEqual({ allowed: true });
  });

  it('blocks symlinked paths that appear under the fixture dir but resolve outside it', () => {
    process.env.OFFICIAL_DOC_PDF_GEMINI_ENABLE = '1';
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'gemini-guard-'));
    const fixtureRoot = path.join(tmp, 'fixtures');
    const outsidePdf = path.join(tmp, 'confidential.pdf');
    writeFileSync(outsidePdf, '%PDF-');
    mkdirSync(fixtureRoot, { recursive: true });
    const linkPath = path.join(fixtureRoot, 'linked.pdf');

    try {
      symlinkSync(outsidePdf, linkPath);
    } catch {
      rmSync(tmp, { recursive: true, force: true });
      return;
    }

    expect(isResolvedPathUnderDir(path.resolve(linkPath), path.resolve(fixtureRoot))).toBe(
      true
    );
    expect(isRealPathUnderFixtureDir(linkPath, fixtureRoot)).toBe(false);
    expect(
      evaluateGeminiCompareGuard({
        inputPath: linkPath,
        basename: 'linked',
        fixtureDir: fixtureRoot,
      })
    ).toEqual({
      allowed: false,
      reason:
        'Gemini arms only run for PDFs under the official-doc-pdf fixture directory.',
    });

    rmSync(tmp, { recursive: true, force: true });
  });
});

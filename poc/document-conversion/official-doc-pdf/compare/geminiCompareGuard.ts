import { realpathSync } from 'node:fs';
import path from 'node:path';

const GEMINI_ALLOWED_SYNTHETIC_FIXTURES = new Set([
  'synthetic-official-doc-table-assist-golden',
]);

export function isGeminiCloudInferenceEnabled(): boolean {
  return process.env.OFFICIAL_DOC_PDF_GEMINI_ENABLE === '1';
}

export function isResolvedPathUnderDir(
  resolvedPath: string,
  resolvedDir: string
): boolean {
  const relative = path.relative(resolvedDir, resolvedPath);
  return (
    relative !== '' &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  );
}

function resolveRealPath(filePath: string): string | null {
  try {
    return realpathSync.native(filePath);
  } catch {
    try {
      return realpathSync(filePath);
    } catch {
      return null;
    }
  }
}

/** True when the resolved real path of `filePath` stays inside `fixtureDir`. */
export function isRealPathUnderFixtureDir(
  filePath: string,
  fixtureDir: string
): boolean {
  const realInput = resolveRealPath(path.resolve(filePath));
  const realFixtureDir = resolveRealPath(path.resolve(fixtureDir));
  if (realInput === null || realFixtureDir === null) return false;
  return isResolvedPathUnderDir(realInput, realFixtureDir);
}

function isPublicFixture(basename: string): boolean {
  return !basename.startsWith('synthetic-');
}

function isPublicOrAllowlistedSynthetic(
  basename: string,
  isPublicDocument: boolean
): boolean {
  return (
    isPublicDocument ||
    GEMINI_ALLOWED_SYNTHETIC_FIXTURES.has(basename) ||
    process.env.OFFICIAL_DOC_PDF_GEMINI_INCLUDE_NON_PUBLIC_FIXTURES === '1'
  );
}

export type GeminiCompareGuardResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export function evaluateGeminiCompareGuard(options: {
  inputPath: string;
  basename: string;
  fixtureDir: string;
}): GeminiCompareGuardResult {
  if (!isGeminiCloudInferenceEnabled()) {
    return {
      allowed: false,
      reason:
        'Gemini arms skipped; set OFFICIAL_DOC_PDF_GEMINI_ENABLE=1 to run cloud inference explicitly.',
    };
  }

  const resolvedInput = path.resolve(options.inputPath);
  const resolvedFixtureDir = path.resolve(options.fixtureDir);
  if (
    !isResolvedPathUnderDir(resolvedInput, resolvedFixtureDir) ||
    !isRealPathUnderFixtureDir(resolvedInput, resolvedFixtureDir)
  ) {
    return {
      allowed: false,
      reason:
        'Gemini arms only run for PDFs under the official-doc-pdf fixture directory.',
    };
  }

  const isPublicDocument = isPublicFixture(options.basename);
  if (!isPublicOrAllowlistedSynthetic(options.basename, isPublicDocument)) {
    return {
      allowed: false,
      reason:
        'Gemini arm skipped for non-public fixture; set OFFICIAL_DOC_PDF_GEMINI_INCLUDE_NON_PUBLIC_FIXTURES=1 to run explicitly.',
    };
  }

  return { allowed: true };
}

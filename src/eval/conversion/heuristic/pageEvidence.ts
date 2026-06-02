import type { HeuristicEvalChunk } from './types';

const TABLE_PARAGRAPH_ID_PATTERN = /^table-\d+-row-\d+/u;
const PAGE_FROM_WARNING_PATTERN =
  /(?:^|[\s,(=])(?:page|pageNumber|slide|slideNumber)\s*[:=]\s*(\d+)/iu;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function toPositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return undefined;
  }
  return value;
}

function pageFromLocator(locator: unknown): number | undefined {
  const record = asRecord(locator);
  if (!record) return undefined;

  const kind = typeof record.kind === 'string' ? record.kind : undefined;
  if (kind === 'pdf') return toPositiveInt(record.page);
  if (kind === 'slide') return toPositiveInt(record.slide);
  if (kind === 'imageText') {
    return toPositiveInt(record.page) ?? toPositiveInt(record.pageNumber);
  }
  return toPositiveInt(record.pageNumber) ?? toPositiveInt(record.page);
}

function pageFromWarnings(warnings: unknown): number | undefined {
  if (!Array.isArray(warnings)) return undefined;
  for (const warning of warnings) {
    if (typeof warning !== 'string') continue;
    const match = warning.match(PAGE_FROM_WARNING_PATTERN);
    if (!match) continue;
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isInteger(parsed) && parsed >= 1) return parsed;
  }
  return undefined;
}

export function pageFromChunk(chunk: HeuristicEvalChunk): number | undefined {
  return pageFromLocator(chunk.locator) ?? pageFromWarnings(chunk.extractionWarnings);
}

export function chunkHasPageEvidence(chunk: HeuristicEvalChunk): boolean {
  return pageFromChunk(chunk) !== undefined;
}

export function chunkHasTableEvidence(chunk: HeuristicEvalChunk): boolean {
  if (chunk.structureType === 'table') return true;
  const locator = asRecord(chunk.locator);
  if (!locator || locator.kind !== 'pdf') return false;
  return (
    typeof locator.paragraphId === 'string' &&
    TABLE_PARAGRAPH_ID_PATTERN.test(locator.paragraphId)
  );
}

/**
 * chunk の page evidence だけからページカバレッジを概算する。
 * `documentIr` に使えるページ情報が無い時の fallback 専用（{@link evalCoverage} 参照）。
 *
 * 分母 (`totalPages`) は「観測できた distinct ページ数」ではなく
 * **観測した最大ページ番号** を使う。前者だと evidence が page 1, 3 のように
 * 飛んでいても 2/2 = 1.0 となり、間の page 2（chunk が一切無いページ）が母数から
 * 消えてカバレッジ 100% に見えてしまう。真のページ総数は documentIr 無しでは
 * 分からないため、最大ページ番号を保守的な代理母数とし、欠番を欠落として残す
 * （page 1, 3 → pagesWithText=2 / totalPages=3 ≈ 0.67）。
 */
export function summarizeChunkPageCoverage(
  chunks: readonly HeuristicEvalChunk[]
): {
  totalPages: number;
  pagesWithText: number;
} {
  let maxPage = 0;
  const pagesWithText = new Set<number>();

  for (const chunk of chunks) {
    const page = pageFromChunk(chunk);
    if (page === undefined) continue;
    if (page > maxPage) {
      maxPage = page;
    }
    if (chunk.text.trim().length > 0) {
      pagesWithText.add(page);
    }
  }

  return {
    totalPages: maxPage,
    pagesWithText: pagesWithText.size,
  };
}

import type { ConversionEvalResult } from '../conversionEvalResult';

export type SemanticRetentionEvalChunk = {
  text: string;
};

export type EvalSemanticRetentionInput<
  TChunk extends SemanticRetentionEvalChunk = SemanticRetentionEvalChunk,
> = {
  chunks: readonly TChunk[];
  expectedFields: readonly string[];
};

/**
 * Normalizes text for golden substring matching: NFKC (full/half width) and
 * collapsed ASCII / full-width whitespace.
 */
export function normalizeForSubstringMatch(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g, '');
}

function buildNormalizedCorpus(chunks: readonly SemanticRetentionEvalChunk[]): string {
  return normalizeForSubstringMatch(
    chunks.map((chunk) => chunk.text).join('\n')
  );
}

function isExpectedFieldPresent(
  normalizedField: string,
  normalizedCorpus: string
): boolean {
  if (normalizedField.length === 0) {
    return true;
  }
  return normalizedCorpus.includes(normalizedField);
}

/**
 * Golden-stage semantic retention: expected field recall via normalized substring
 * match over concatenated chunk text (Phase 3-H-2 §7.2).
 */
export function evalSemanticRetention<
  TChunk extends SemanticRetentionEvalChunk,
>(input: EvalSemanticRetentionInput<TChunk>): Pick<
  ConversionEvalResult,
  'semanticRetention'
> {
  const expectedFields = [...input.expectedFields];
  const normalizedCorpus = buildNormalizedCorpus(input.chunks);
  const missingExpectedFields: string[] = [];

  for (const field of expectedFields) {
    const normalizedField = normalizeForSubstringMatch(field);
    if (!isExpectedFieldPresent(normalizedField, normalizedCorpus)) {
      missingExpectedFields.push(field);
    }
  }

  const expectedCount = expectedFields.length;
  const foundCount = expectedCount - missingExpectedFields.length;
  const keyFieldRecall =
    expectedCount === 0 ? 1 : foundCount / expectedCount;

  return {
    semanticRetention: {
      keyFieldRecall,
      missingExpectedFields,
    },
  };
}

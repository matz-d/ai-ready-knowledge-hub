import { z } from 'zod';

export const P1D_MIXED_PDF_CHECK_SCHEMA_VERSION = 1 as const;
export const DEFAULT_P1D_MIXED_PDF_MAX_CHUNKS = 1000;

export const P1dMixedPdfExtractionStatusSchema = z.enum([
  'pass',
  'partial',
  'failed',
]);

export const P1dMixedPdfFailureReasonSchema = z.enum([
  'text_failed',
  'empty_text',
  'table_failed',
  'oversized',
  'empty_chunks',
  'too_many_chunks',
]);

export type P1dMixedPdfExtractionStatus = z.infer<
  typeof P1dMixedPdfExtractionStatusSchema
>;
export type P1dMixedPdfFailureReason = z.infer<
  typeof P1dMixedPdfFailureReasonSchema
>;

export type P1dMixedPdfClassificationInput = {
  textExtractionOk: boolean;
  textCharCount: number;
  tableExtractionOk: boolean;
  oversizedChunkCount: number;
  emptyChunkCount: number;
  chunkCount: number;
  maxChunks?: number;
};

export type P1dMixedPdfClassification = {
  largeMixedPdfExtractionStatus: P1dMixedPdfExtractionStatus;
  largeMixedPdfFailureReasons: P1dMixedPdfFailureReason[];
};

export type P1dMixedPdfHandoffCase = {
  materialType: 'large-mixed-pdf';
  fixtureOrLocalPath: string;
  command: string;
  failureSymptoms: P1dMixedPdfFailureReason[];
  expectedFallback: string;
  targetPhase: 'P1-E' | 'P2+';
};

export function classifyP1dMixedPdfExtraction(
  input: P1dMixedPdfClassificationInput
): P1dMixedPdfClassification {
  const maxChunks = input.maxChunks ?? DEFAULT_P1D_MIXED_PDF_MAX_CHUNKS;
  const reasons: P1dMixedPdfFailureReason[] = [];

  if (!input.textExtractionOk) {
    reasons.push('text_failed');
  } else if (input.textCharCount === 0) {
    reasons.push('empty_text');
  }

  if (!input.tableExtractionOk) reasons.push('table_failed');
  if (input.oversizedChunkCount > 0) reasons.push('oversized');
  if (input.emptyChunkCount > 0) reasons.push('empty_chunks');
  if (input.chunkCount > maxChunks) reasons.push('too_many_chunks');

  const largeMixedPdfExtractionStatus: P1dMixedPdfExtractionStatus =
    !input.textExtractionOk
      ? 'failed'
      : reasons.length > 0
        ? 'partial'
        : 'pass';

  return {
    largeMixedPdfExtractionStatus,
    largeMixedPdfFailureReasons: reasons,
  };
}

export function buildP1dMixedPdfHandoffCases(options: {
  localPath: string;
  command: string;
  reasons: readonly P1dMixedPdfFailureReason[];
}): P1dMixedPdfHandoffCase[] {
  if (options.reasons.length === 0) return [];

  return [
    {
      materialType: 'large-mixed-pdf',
      fixtureOrLocalPath: options.localPath,
      command: options.command,
      failureSymptoms: [...options.reasons],
      expectedFallback:
        'Pre-split large mixed PDFs, keep text extraction fail-soft when table extraction fails, and route table/chart-heavy pages through a fallback strategy.',
      targetPhase: 'P1-E',
    },
  ];
}


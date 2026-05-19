import {
  runConversionEvalHealthCheck,
  type ConversionEvalResult,
} from '../../../../src/eval/conversion';
import type { GeminiScanPiiFinding } from '../extract/geminiOcrExtractor';
import type { ScanPdfKnowledgeChunkDraft } from '../adapter/toKnowledgeChunk';

export type ScanPdfSafetyReadinessMeaning = {
  unmaskablePiiFindings: string;
  maskableChunkRate: string;
};

export const SCAN_PDF_SAFETY_READINESS_MEANING: ScanPdfSafetyReadinessMeaning =
  {
    unmaskablePiiFindings:
      'PII-like evidence Gemini OCR noticed but judged unsafe for reliable span replacement because the OCR text is uncertain, fragmented, partial, handwritten, or only context-identifying.',
    maskableChunkRate:
      'Share of produced chunk drafts that contain non-empty text and can be handed to the existing Masker pipeline as text chunks.',
  };

export function runScanPdfHealthCheck(
  chunkDrafts: ScanPdfKnowledgeChunkDraft[],
  piiFindings: GeminiScanPiiFinding[],
  schemaPassed: boolean,
  schemaErrors: string[] = []
): ConversionEvalResult {
  const result = runConversionEvalHealthCheck({
    sourceSubtype: 'scan-pdf',
    chunkDrafts,
    schemaValidity: {
      passed: schemaPassed,
      errors: [...schemaErrors],
    },
  });

  const nonEmptyChunks = chunkDrafts.filter(
    (chunk) => chunk.text.trim().length > 0
  ).length;

  result.safetyReadiness = {
    ...result.safetyReadiness,
    unmaskablePiiFindings: piiFindings.filter(
      (finding) => finding.maskability === 'unmaskable'
    ).length,
    maskableChunkRate:
      chunkDrafts.length === 0 ? 0 : nonEmptyChunks / chunkDrafts.length,
  };

  return result;
}

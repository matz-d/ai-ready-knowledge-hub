import {
  runConversionEvalHealthCheck,
  type ConversionEvalResult,
} from '../../../../src/eval/conversion';
import type { DocumentIrToKnowledgeChunkDraft } from '../adapter/toKnowledgeChunk';

export function runOfficialDocPdfHealthCheck(
  chunkDrafts: DocumentIrToKnowledgeChunkDraft[],
  schemaPassed: boolean,
  schemaErrors: string[] = []
): ConversionEvalResult {
  return runConversionEvalHealthCheck({
    sourceSubtype: 'official-doc-pdf',
    chunkDrafts,
    schemaValidity: {
      passed: schemaPassed,
      errors: [...schemaErrors],
    },
  });
}

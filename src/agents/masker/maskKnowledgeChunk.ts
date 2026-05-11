import type { KnowledgeChunk } from '../../lib/knowledgeChunkSchema';
import type { MaskingProvider } from './maskingSchema';
import { applyMask } from './provider';

export async function maskKnowledgeChunk(
  chunk: KnowledgeChunk,
  options?: { provider?: MaskingProvider }
): Promise<KnowledgeChunk> {
  if (chunk.aiUsePolicy !== 'requires_masking') {
    return chunk;
  }

  const result = await applyMask(
    {
      fileName: chunk.id,
      content: chunk.text,
      curatorContext: {
        sensitivity: chunk.sensitivity,
        aiUsePolicy: chunk.aiUsePolicy,
        // KnowledgeChunk has no businessDomain field; use fallback since
        // neither simpleMasker nor cloudDlpMasker consults this value.
        businessDomain: 'その他',
      },
    },
    { provider: options?.provider }
  );

  return {
    ...chunk,
    maskedText: result.maskedContent,
    maskedSpansCount: result.maskedSpans.length,
    ruleHits: result.ruleHits,
  };
}

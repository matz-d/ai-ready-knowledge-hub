import { maskerRiskFlow } from './flow';
import { applyMask, type ApplyMaskOptions } from './provider';
import { hashSourceContent } from './simpleMasker';
import type { MaskingInput } from './maskingSchema';
import type { PipelineOutput } from './pipelineSchema';

/**
 * SimpleMasker → maskerRiskFlow → ai_safe_ready | restricted_promoted。
 * Firestore / API は接続しない（Task 後続）。
 */
export async function maskerPipelineFlow(
  input: MaskingInput,
  options: ApplyMaskOptions = {}
): Promise<PipelineOutput> {
  const policy = input.curatorContext.aiUsePolicy;
  if (policy !== 'requires_masking') {
    throw new Error(
      `Masker pipeline は aiUsePolicy が "requires_masking" のときのみ実行できます（現在: "${policy}"）。`
    );
  }

  const maskingResult = await applyMask(input, options);

  const rawRiskOutput = await maskerRiskFlow({
    fileName: input.fileName,
    maskedContent: maskingResult.maskedContent,
  });

  const generatedAt = new Date().toISOString();
  const sourceContentHash = hashSourceContent(input.content);

  if (rawRiskOutput.recommendedSensitivity === 'Restricted') {
    return {
      decision: 'restricted_promoted',
      aiSafeVersion: null,
      curatorFeedback: {
        newSensitivity: 'Restricted',
        newAiUsePolicy: 'blocked',
        reason: rawRiskOutput.rationale,
      },
      rawRiskOutput,
      maskingResult,
    };
  }

  return {
    decision: 'ai_safe_ready',
    aiSafeVersion: {
      fileName: input.fileName,
      provider: maskingResult.provider,
      maskedContent: maskingResult.maskedContent,
      maskedSpans: maskingResult.maskedSpans,
      generatedAt,
      sourceContentHash,
      residualRisk: rawRiskOutput.residualRisk,
      schemaVersion: 1,
    },
    curatorFeedback: null,
    rawRiskOutput,
    maskingResult,
  };
}

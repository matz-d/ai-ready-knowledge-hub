import { z } from 'zod';
import { AiSafeVersion, MaskingInput, MaskingResult } from './maskingSchema';
import { ResidualRiskOutput } from './schema';

export const PipelineInput = MaskingInput;
export type PipelineInput = z.infer<typeof MaskingInput>;

export const PipelineDecisionEnum = z.enum([
  'ai_safe_ready',
  'restricted_promoted',
]);

export const CuratorPipelineFeedback = z.object({
  newSensitivity: z.literal('Restricted'),
  newAiUsePolicy: z.literal('blocked'),
  reason: z.string(),
});

export type CuratorPipelineFeedback = z.infer<typeof CuratorPipelineFeedback>;

export const PipelineOutput = z.object({
  decision: PipelineDecisionEnum,
  aiSafeVersion: AiSafeVersion.nullable(),
  curatorFeedback: CuratorPipelineFeedback.nullable(),
  rawRiskOutput: ResidualRiskOutput,
  maskingResult: MaskingResult,
});

export type PipelineOutput = z.infer<typeof PipelineOutput>;

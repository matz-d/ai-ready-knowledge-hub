import {
  ResidualRiskInput,
  ResidualRiskOutput,
  ResidualRiskOutputCore,
  type ResidualRiskOutputResult,
} from './schema';
import {
  MASKER_RISK_SYSTEM_PROMPT,
  buildMaskerRiskUserPrompt,
} from './prompt';
import { ai, generateValidated } from '../_shared/genkitClient';

/**
 * Masker residual risk flow (A8).
 *
 * 構造化出力のリカバリは `_shared/genkitClient.ts#generateValidated` に集約。
 * Masker は 3 段フォールバックで運用しているため `includeBareJsonFallback` は付けない。
 */
export const maskerRiskFlow = ai.defineFlow(
  {
    name: 'maskerRiskFlow',
    inputSchema: ResidualRiskInput,
    outputSchema: ResidualRiskOutput,
  },
  async (input): Promise<ResidualRiskOutputResult> =>
    generateValidated<ResidualRiskOutputResult>({
      label: 'Residual risk',
      system: MASKER_RISK_SYSTEM_PROMPT,
      prompt: buildMaskerRiskUserPrompt(input),
      coreSchema: ResidualRiskOutputCore,
      validate: (output) => ResidualRiskOutput.safeParse(output),
    })
);

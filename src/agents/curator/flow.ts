import {
  CuratorInput,
  CuratorOutput,
  CuratorOutputCore,
  type CuratorOutputResult,
} from './schema';
import { CURATOR_SYSTEM_PROMPT, buildCuratorUserPrompt } from './prompt';
import { ai, generateValidated } from '../_shared/genkitClient';

/**
 * Curator flow.
 *
 * 構造化出力のリカバリは `_shared/genkitClient.ts#generateValidated` に集約。
 * Curator は 4 段フォールバック (structured / structured-text / json+schema /
 * format=json) を要するため `includeBareJsonFallback: true`。
 */
export const curatorFlow = ai.defineFlow(
  {
    name: 'curatorFlow',
    inputSchema: CuratorInput,
    outputSchema: CuratorOutput,
  },
  async (input): Promise<CuratorOutputResult> =>
    generateValidated<CuratorOutputResult>({
      label: 'Curator',
      system: CURATOR_SYSTEM_PROMPT,
      prompt: buildCuratorUserPrompt(input),
      coreSchema: CuratorOutputCore,
      validate: (output) => CuratorOutput.safeParse(output),
      includeBareJsonFallback: true,
    })
);

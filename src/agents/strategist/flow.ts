import {
  StrategistInputSchema,
  StrategistOutputSchema,
  StrategistOutputCoreSchema,
  strategistOutputUnknownChunkRefMessage,
  type StrategistOutput,
} from './schema';
import { STRATEGIST_SYSTEM_PROMPT, buildStrategistUserPrompt } from './prompt';
import { ai, generateValidated } from '../_shared/genkitClient';

/**
 * Strategist flow.
 *
 * safety gate 通過済みの chunk + 親 Inventory メタを入力に、
 * included / excluded / missing / humanReviewQuestions の4ブロックを返す。
 *
 * - safetyGate は呼ばない（orchestrator 担当）
 * - Inventory join は行わない（orchestrator 担当）
 * - ContextPackage merge は行わない（orchestrator 担当）
 *
 * 構造化出力のリカバリは `_shared/genkitClient.ts#generateValidated` に集約。
 * 4段フォールバック (structured / structured-text / json+schema / format=json) を
 * 要するため `includeBareJsonFallback: true`。
 * 最終 `validate` では `StrategistOutputSchema` に加え、included/excluded の
 * docId+chunkId と `humanReviewQuestions.relatedChunkIds` を `chunkInputs` と照合する。
 */
export const strategistFlow = ai.defineFlow(
  {
    name: 'strategistFlow',
    inputSchema: StrategistInputSchema,
    outputSchema: StrategistOutputSchema,
  },
  async (input): Promise<StrategistOutput> =>
    generateValidated<StrategistOutput>({
      label: 'Strategist',
      system: STRATEGIST_SYSTEM_PROMPT,
      prompt: buildStrategistUserPrompt(input),
      coreSchema: StrategistOutputCoreSchema,
      validate: (output) => {
        const parsed = StrategistOutputSchema.safeParse(output);
        if (!parsed.success) {
          return { success: false, error: { message: parsed.error.message } };
        }
        const refMsg = strategistOutputUnknownChunkRefMessage(input, parsed.data);
        if (refMsg !== undefined) {
          return { success: false, error: { message: refMsg } };
        }
        return { success: true, data: parsed.data };
      },
      includeBareJsonFallback: true,
    })
);

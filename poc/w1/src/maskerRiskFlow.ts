import { z } from 'zod';
import {
  ResidualRiskInput,
  ResidualRiskOutput,
  ResidualRiskOutputCore,
  type ResidualRiskOutputResult,
} from './maskerRiskSchema.js';
import {
  MASKER_RISK_SYSTEM_PROMPT,
  buildMaskerRiskUserPrompt,
} from './maskerRiskPrompt.js';
import { ai, modelRef, parseJsonFromModelText } from './genkitClient.js';

async function generateResidualRiskValidated(
  input: z.infer<typeof ResidualRiskInput>
): Promise<ResidualRiskOutputResult> {
  const base = {
    model: modelRef(),
    system: MASKER_RISK_SYSTEM_PROMPT,
    prompt: buildMaskerRiskUserPrompt(input),
    config: { temperature: 0 },
  };

  const attempts: string[] = [];

  const primary = await ai.generate({
    ...base,
    output: {
      schema: ResidualRiskOutputCore,
      constrained: true,
    },
  });

  let validated = ResidualRiskOutput.safeParse(primary.output);
  if (validated.success) {
    return validated.data;
  }
  attempts.push(`structured(output): ${validated.error.message}`);

  if (primary.text) {
    try {
      const parsed = parseJsonFromModelText(primary.text);
      validated = ResidualRiskOutput.safeParse(parsed);
      if (validated.success) {
        return validated.data;
      }
      attempts.push(`structured(text): ${validated.error.message}`);
    } catch (e) {
      attempts.push(
        `structured(text JSON.parse): ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  const looseJson = await ai.generate({
    ...base,
    output: {
      format: 'json',
      schema: ResidualRiskOutputCore,
      constrained: false,
    },
  });

  validated = ResidualRiskOutput.safeParse(looseJson.output);
  if (validated.success) {
    return validated.data;
  }
  attempts.push(`json+schema(unconstrained output): ${validated.error.message}`);

  if (looseJson.text) {
    try {
      const parsed = parseJsonFromModelText(looseJson.text);
      validated = ResidualRiskOutput.safeParse(parsed);
      if (validated.success) {
        return validated.data;
      }
      attempts.push(`json+schema(text): ${validated.error.message}`);
    } catch (e) {
      attempts.push(
        `json+schema(text JSON.parse): ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  throw new Error(
    `Residual risk 出力を Zod で検証できませんでした。\n${attempts.join('\n')}`
  );
}

export const maskerRiskFlow = ai.defineFlow(
  {
    name: 'maskerRiskFlow',
    inputSchema: ResidualRiskInput,
    outputSchema: ResidualRiskOutput,
  },
  async (input) => generateResidualRiskValidated(input)
);

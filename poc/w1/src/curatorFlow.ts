import { z } from 'zod';
import {
  CuratorInput,
  CuratorOutput,
  CuratorOutputCore,
  type CuratorOutputResult,
} from './curatorSchema.js';
import {
  CURATOR_SYSTEM_PROMPT,
  buildCuratorUserPrompt,
} from './curatorPrompt.js';
import { ai, modelRef, parseJsonFromModelText } from './genkitClient.js';

async function generateCuratorValidated(
  input: z.infer<typeof CuratorInput>
): Promise<CuratorOutputResult> {
  const base = {
    model: modelRef(),
    system: CURATOR_SYSTEM_PROMPT,
    prompt: buildCuratorUserPrompt(input),
    config: { temperature: 0 },
  };

  const attempts: string[] = [];

  const primary = await ai.generate({
    ...base,
    output: {
      schema: CuratorOutputCore,
      constrained: true,
    },
  });

  let validated = CuratorOutput.safeParse(primary.output);
  if (validated.success) {
    return validated.data;
  }
  attempts.push(`structured(output): ${validated.error.message}`);

  if (primary.text) {
    try {
      const parsed = parseJsonFromModelText(primary.text);
      validated = CuratorOutput.safeParse(parsed);
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
      schema: CuratorOutputCore,
      constrained: false,
    },
  });

  validated = CuratorOutput.safeParse(looseJson.output);
  if (validated.success) {
    return validated.data;
  }
  attempts.push(`json+schema(unconstrained output): ${validated.error.message}`);

  if (looseJson.text) {
    try {
      const parsed = parseJsonFromModelText(looseJson.text);
      validated = CuratorOutput.safeParse(parsed);
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

  const fmtJson = await ai.generate({
    ...base,
    output: {
      format: 'json',
    },
  });

  validated = CuratorOutput.safeParse(fmtJson.output);
  if (validated.success) {
    return validated.data;
  }
  attempts.push(`format=json(output): ${validated.error.message}`);

  if (fmtJson.text) {
    try {
      const parsed = parseJsonFromModelText(fmtJson.text);
      validated = CuratorOutput.safeParse(parsed);
      if (validated.success) {
        return validated.data;
      }
      attempts.push(`format=json(text): ${validated.error.message}`);
    } catch (e) {
      attempts.push(
        `format=json(JSON.parse): ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  throw new Error(
    `Curator 出力を Zod で検証できませんでした。\n${attempts.join('\n')}`
  );
}

export const curatorFlow = ai.defineFlow(
  {
    name: 'curatorFlow',
    inputSchema: CuratorInput,
    outputSchema: CuratorOutput,
  },
  async (input) => generateCuratorValidated(input)
);

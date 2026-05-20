import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';
import type { ZodType } from 'zod';

/**
 * Curator / Masker (residual risk) 双方で共有する Genkit クライアント。
 *
 * - Cloud Run 上では metadata server から projectId が取れる前提
 * - ローカル / scripts/ 実行では `.env.local` から読む（ロードは scripts 側責務）
 */

export const location = process.env.GOOGLE_CLOUD_LOCATION ?? 'asia-northeast1';
const projectId = process.env.GOOGLE_CLOUD_PROJECT;

if (!projectId && process.env.NODE_ENV !== 'production') {
  console.warn(
    '[genkit] GOOGLE_CLOUD_PROJECT が未設定です。.env.local を設定するか docs/setup-gcp.md を参照してください。'
  );
}

export const modelId = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

export const ai = genkit({
  plugins: [
    vertexAI({
      location,
      projectId,
    }),
  ],
  model: vertexAI.model(modelId),
});

export function modelRef() {
  return vertexAI.model(modelId);
}

/**
 * Vertex/Gemini が ` ```json ... ``` ` でフェンスして返すケースを許容する内部ユーティリティ。
 * `generateValidated` のフォールバック段でしか使わないので外部公開しない。
 */
function parseJsonFromModelText(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  const raw = fence ? fence[1]!.trim() : trimmed;
  return JSON.parse(raw) as unknown;
}

/**
 * Vertex AI structured output の段階的フォールバック共通実装。
 *
 * Curator / Masker (residual risk) が共有するリカバリ手順を 1 か所に閉じる:
 *   1. structured output (responseJsonSchema constrained)
 *   2. structured output の `text` から JSON.parse
 *   3. (任意) format=json + schema (unconstrained)
 *   4. (任意) format=json (schema なし)
 *
 * `coreSchema` は responseJsonSchema 用で `.refine` を含めない。
 * 最終整合性検証は `validate` (= `superRefine` 込みの schema) で行う。
 */
export type GenerateValidatedOptions<TFinal> = {
  /** エラーメッセージで agent を識別するための短いラベル (例: "Curator") */
  label: string;
  /** Vertex に渡す system prompt */
  system: string;
  /** Vertex に渡す user prompt */
  prompt: string;
  /**
   * structured output 用 schema (`responseJsonSchema` に積まれるため refine なし)。
   * `unknown` 型で扱うのは genkit の型制約と Zod の型推論の相互運用を強制しないため。
   */
  coreSchema: ZodType<unknown>;
  /** `coreSchema` 出力を superRefine 込みで最終検証する関数 */
  validate: (output: unknown) => { success: true; data: TFinal } | { success: false; error: { message: string } };
  /** 4 段目の format=json (schema なし) を試すか。Curator のみ true で運用。 */
  includeBareJsonFallback?: boolean;
};

export async function generateValidated<TFinal>(
  options: GenerateValidatedOptions<TFinal>
): Promise<TFinal> {
  const base = {
    model: modelRef(),
    system: options.system,
    prompt: options.prompt,
    config: { temperature: 0 },
  };

  const attempts: string[] = [];

  const tryValidate = (
    stage: string,
    candidate: unknown
  ): TFinal | undefined => {
    const result = options.validate(candidate);
    if (result.success) return result.data;
    attempts.push(`${stage}: ${result.error.message}`);
    return undefined;
  };

  const tryParseText = (
    stage: string,
    text: string | undefined
  ): TFinal | undefined => {
    if (!text) return undefined;
    try {
      const parsed = parseJsonFromModelText(text);
      return tryValidate(stage, parsed);
    } catch (e) {
      attempts.push(
        `${stage} (JSON.parse): ${e instanceof Error ? e.message : String(e)}`
      );
      return undefined;
    }
  };

  // Stage 1: structured output (constrained)
  const primary = await ai.generate({
    ...base,
    output: { schema: options.coreSchema, constrained: true },
  });
  const fromPrimary = tryValidate('structured(output)', primary.output);
  if (fromPrimary) return fromPrimary;

  // Stage 2: structured output の text を JSON.parse
  const fromPrimaryText = tryParseText('structured(text)', primary.text);
  if (fromPrimaryText) return fromPrimaryText;

  // Stage 3: format=json + schema (unconstrained)
  const looseJson = await ai.generate({
    ...base,
    output: { format: 'json', schema: options.coreSchema, constrained: false },
  });
  const fromLoose = tryValidate('json+schema(output)', looseJson.output);
  if (fromLoose) return fromLoose;

  const fromLooseText = tryParseText('json+schema(text)', looseJson.text);
  if (fromLooseText) return fromLooseText;

  // Stage 4 (任意): format=json のみ。schema を外す最終手段。
  if (options.includeBareJsonFallback) {
    const bareJson = await ai.generate({
      ...base,
      output: { format: 'json' },
    });
    const fromBare = tryValidate('format=json(output)', bareJson.output);
    if (fromBare) return fromBare;

    const fromBareText = tryParseText('format=json(text)', bareJson.text);
    if (fromBareText) return fromBareText;
  }

  throw new Error(
    `${options.label} 出力を Zod で検証できませんでした。\n${attempts.join('\n')}`
  );
}

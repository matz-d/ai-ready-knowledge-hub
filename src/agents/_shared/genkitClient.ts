import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';

/**
 * Curator / Masker (residual risk) 双方で共有する Genkit クライアント。
 *
 * - Cloud Run 上では metadata server から projectId が取れる前提
 * - ローカル / scripts/ 実行では `.env.local` から読む（ロードは scripts 側責務）
 */

const location = process.env.GOOGLE_CLOUD_LOCATION ?? 'asia-northeast1';
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

export function parseJsonFromModelText(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  const raw = fence ? fence[1]!.trim() : trimmed;
  return JSON.parse(raw) as unknown;
}

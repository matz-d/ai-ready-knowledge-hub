import './loadEnv.js';
import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';

const location = process.env.GOOGLE_CLOUD_LOCATION ?? 'asia-northeast1';
const projectId = process.env.GOOGLE_CLOUD_PROJECT;

if (!projectId) {
  console.warn(
    '[genkit] GOOGLE_CLOUD_PROJECT が未設定です。poc/w1/.env.local を設定するか docs/setup-gcp.md を参照してください。'
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

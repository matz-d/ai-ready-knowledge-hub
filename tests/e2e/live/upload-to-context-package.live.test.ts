import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const adcPath = join(
  homedir(),
  '.config',
  'gcloud',
  'application_default_credentials.json'
);

const liveEnv = {
  project: process.env.GOOGLE_CLOUD_PROJECT?.trim(),
  bucket: process.env.KNOWLEDGE_HUB_BUCKET?.trim(),
  explicitCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim(),
  adcFileExists: existsSync(adcPath),
  geminiModel: process.env.GEMINI_MODEL?.trim(),
};

const missing = [
  liveEnv.project ? null : 'GOOGLE_CLOUD_PROJECT',
  liveEnv.bucket ? null : 'KNOWLEDGE_HUB_BUCKET',
  liveEnv.explicitCredentials || liveEnv.adcFileExists
    ? null
    : 'GOOGLE_APPLICATION_CREDENTIALS or ADC',
].filter(Boolean);

const describeLive = missing.length > 0 ? describe.skip : describe;

describeLive('Upload to Context Package live E2E skeleton', () => {
  it('documents the live E2E prerequisites without creating external resources yet', () => {
    console.info(
      [
        '[live-e2e] prerequisites detected.',
        `GOOGLE_CLOUD_PROJECT=${liveEnv.project}`,
        `KNOWLEDGE_HUB_BUCKET=${liveEnv.bucket}`,
        `GEMINI_MODEL=${liveEnv.geminiModel || '(default model)'}`,
        'This skeleton is intentionally non-destructive and does not clean up resources.',
      ].join('\n')
    );

    expect(liveEnv.project).toBeTruthy();
    expect(liveEnv.bucket).toBeTruthy();
    expect(liveEnv.explicitCredentials || liveEnv.adcFileExists).toBeTruthy();
  });
});

if (missing.length > 0) {
  console.info(
    `[live-e2e] skipped because required environment is missing: ${missing.join(
      ', '
    )}`
  );
}

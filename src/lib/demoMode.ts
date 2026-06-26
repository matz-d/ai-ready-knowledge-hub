export const DEMO_SAMPLE_SET_ID = 'accounting-office';
export const DEMO_SAMPLE_SET_FIELD = 'demoSampleSet';
export const DEMO_MAX_PURPOSE_LENGTH = 800;

export type DemoSampleSetId = typeof DEMO_SAMPLE_SET_ID;

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE?.trim().toLowerCase() === 'true';
}

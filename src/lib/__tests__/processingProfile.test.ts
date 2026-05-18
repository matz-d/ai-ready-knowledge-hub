import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PROCESSING_PROFILE_PRESETS,
  type ProcessingProfile,
  type ProcessingProfileName,
} from '../processingProfile';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PHASE_3_E_DOC = join(__dirname, '../../../docs/phase-3-e-direction.md');

function readPhase3EDoc(): string {
  return readFileSync(PHASE_3_E_DOC, 'utf8');
}

describe('processingProfile presets', () => {
  it('cloud-managed matches the MVP preset triple documented in phase-3-e-direction.md §3.3', () => {
    const preset: ProcessingProfile = PROCESSING_PROFILE_PRESETS['cloud-managed'];
    expect(preset).toEqual({
      profileName: 'cloud-managed',
      ingressBoundary: 'tenant-cloud',
      sanitizationStage: 'post-ingress',
      inferenceScope: 'shared-cloud',
    });

    const doc = readPhase3EDoc();
    expect(doc).toContain(
      '`cloud-managed` | `tenant-cloud / post-ingress / shared-cloud`'
    );
  });

  it('cloud-sanitized-ingress matches the MVP preset triple documented in phase-3-e-direction.md §3.3', () => {
    const preset: ProcessingProfile =
      PROCESSING_PROFILE_PRESETS['cloud-sanitized-ingress'];
    expect(preset).toEqual({
      profileName: 'cloud-sanitized-ingress',
      ingressBoundary: 'tenant-edge',
      sanitizationStage: 'pre-ingress',
      inferenceScope: 'shared-cloud',
    });

    const doc = readPhase3EDoc();
    expect(doc).toContain(
      '`cloud-sanitized-ingress` | `tenant-edge / pre-ingress / shared-cloud`'
    );
  });

  it('preset keys cover every ProcessingProfileName exactly once', () => {
    const keys = Object.keys(
      PROCESSING_PROFILE_PRESETS
    ) as ProcessingProfileName[];
    expect(keys.sort()).toEqual(['cloud-managed', 'cloud-sanitized-ingress']);
    for (const name of keys) {
      expect(PROCESSING_PROFILE_PRESETS[name].profileName).toBe(name);
    }
  });
});

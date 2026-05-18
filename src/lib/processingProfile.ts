/**
 * Phase 3-E ProcessingProfile — trusted boundary attributes for upload → mask → AI paths.
 * Authoritative narrative: docs/phase-3-e-direction.md (§3 TCB と ProcessingProfile).
 */

export type ProcessingProfileName = 'cloud-managed' | 'cloud-sanitized-ingress';

export type IngressBoundary = 'tenant-cloud' | 'tenant-edge';

export type SanitizationStage = 'post-ingress' | 'pre-ingress';

export type InferenceScope = 'shared-cloud' | 'tenant-isolated';

export type ProcessingProfile = {
  profileName: ProcessingProfileName;
  ingressBoundary: IngressBoundary;
  sanitizationStage: SanitizationStage;
  inferenceScope: InferenceScope;
};

/**
 * MVP presets (docs/phase-3-e-direction.md §3.3 MVP preset).
 * `cloud-managed` is the implemented standard; `cloud-sanitized-ingress` is contract-only for now.
 */
export const PROCESSING_PROFILE_PRESETS = {
  'cloud-managed': {
    profileName: 'cloud-managed',
    ingressBoundary: 'tenant-cloud',
    sanitizationStage: 'post-ingress',
    inferenceScope: 'shared-cloud',
  },
  'cloud-sanitized-ingress': {
    profileName: 'cloud-sanitized-ingress',
    ingressBoundary: 'tenant-edge',
    sanitizationStage: 'pre-ingress',
    inferenceScope: 'shared-cloud',
  },
} as const satisfies Record<ProcessingProfileName, ProcessingProfile>;

/**
 * Feature-flag reader — Phase 3-H-2 M1.
 * Authoritative design: docs/phase-3-h-2-direction.md §4 / decisions.md D-P3-H-4 (判断 1=C).
 *
 * Runtime: Cloud Run reads `feature_flags/{flagId}` from Firestore.
 * Schema: allow-list + optional expiry.
 *   - `enabledTenants`: tenants explicitly granted access (allow-list)
 *   - `expiresAt`:      ISO 8601 datetime; absent = no expiry
 *   - `defaultEnabled`: fallback for tenants not in allow-list
 */
import type { Firestore } from '@google-cloud/firestore';
import { z } from 'zod';

// ── Known flag IDs ─────────────────────────────────────────────────────────
// Extend this list when a new experimental feature lands.
// Using `as const satisfies` keeps element literals narrow for z.enum() below.
export const FEATURE_FLAG_IDS = [
  'pdf-conversion-subtype-1', // official-doc-pdf pipeline (Phase 3-H-2 M1)
  'pdf-conversion-subtype-2', // slide-pdf pipeline (Phase 3-H-3 M1)
  'pdf-conversion-subtype-3', // scan-pdf pipeline (Phase 3-H-3 M6)
] as const satisfies readonly string[];

export type FeatureFlagId = (typeof FEATURE_FLAG_IDS)[number];

// ── Schema ─────────────────────────────────────────────────────────────────
//
// Decisions from docs/decisions.md D-P3-H-4 (判断 1=C):
//   flagId          – z.enum([...FEATURE_FLAG_IDS]) gives compile-time typo safety;
//                     all known flags are declared in FEATURE_FLAG_IDS above.
//   enabledTenants  – z.array(z.string().min(1)): tenant IDs, NOT email addresses.
//                     normalizeTenantId() keeps dots: "makoto@m-grow-ai.com" -> "m-grow-ai.com".
//   defaultEnabled  – z.boolean(): fallback for tenants not in enabledTenants.
//                     Usually false; set to true for a full rollout.
//   expiresAt       – z.string().datetime().optional(): ISO 8601 expiry timestamp.
//                     Absent = flag never expires on its own.
//                     isFeatureEnabled() enforces the expiry check at read time.
//                     (future-only validation at write time is a Firestore Security Rules concern)
export const FeatureFlagSchema = z.object({
  flagId: z.enum(FEATURE_FLAG_IDS),
  defaultEnabled: z.boolean(),
  enabledTenants: z.array(z.string().min(1)),
  expiresAt: z.string().datetime().optional(),
});

export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;

// ── Firestore path ─────────────────────────────────────────────────────────
/** Top-level Firestore collection that stores feature flag documents. */
export const FEATURE_FLAGS_COLLECTION = 'feature_flags' as const;

export async function getFeatureFlag(
  db: Firestore,
  flagId: FeatureFlagId
): Promise<FeatureFlag | null> {
  const snapshot = await db
    .collection(FEATURE_FLAGS_COLLECTION)
    .doc(flagId)
    .get();

  if (!snapshot.exists) return null;

  const parsed = FeatureFlagSchema.safeParse(snapshot.data());
  if (!parsed.success) {
    console.warn('[featureFlags] invalid feature flag document ignored', {
      flagId,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return null;
  }

  if (parsed.data.flagId !== flagId) {
    console.warn('[featureFlags] feature flag document id mismatch ignored', {
      requestedFlagId: flagId,
      documentFlagId: parsed.data.flagId,
    });
    return null;
  }

  return parsed.data;
}

// ── Runtime helper ─────────────────────────────────────────────────────────
/**
 * Returns `true` if `flag` grants access to `tenantId` at `now`.
 *
 * Evaluation order:
 *   1. flag is null/undefined          → false  (flag not found in Firestore)
 *   2. expiresAt is set AND now >= that → false  (expired)
 *   3. tenantId is in enabledTenants    → true   (explicitly allowed)
 *   4. defaultEnabled is true           → true   (open to all tenants)
 *   5. otherwise                        → false
 *
 * The `now` parameter is injectable so tests can control the clock.
 */
export function isFeatureEnabled(
  flag: FeatureFlag | null | undefined,
  tenantId: string,
  now: Date = new Date()
): boolean {
  if (flag == null) return false;

  if (flag.expiresAt !== undefined && now >= new Date(flag.expiresAt)) {
    return false;
  }

  if (flag.enabledTenants.includes(tenantId)) return true;

  return flag.defaultEnabled;
}

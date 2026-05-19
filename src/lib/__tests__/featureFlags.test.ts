import type { Firestore } from '@google-cloud/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  FEATURE_FLAG_IDS,
  FEATURE_FLAGS_COLLECTION,
  FeatureFlagSchema,
  getFeatureFlag,
  isFeatureEnabled,
  type FeatureFlag,
  type FeatureFlagId,
} from '../featureFlags';

function fakeFirestoreWithFlag(data: Record<string, unknown> | null): {
  db: Firestore;
  collection: ReturnType<typeof vi.fn>;
  doc: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn(async () => ({
    exists: data !== null,
    data: () => data,
  }));
  const doc = vi.fn(() => ({ get }));
  const collection = vi.fn(() => ({ doc }));
  return {
    db: { collection } as unknown as Firestore,
    collection,
    doc,
    get,
  };
}

// ── Schema parse tests ─────────────────────────────────────────────────────

describe('FeatureFlagSchema', () => {
  it('parses a valid flag with an allow-list and no expiry', () => {
    const flag = FeatureFlagSchema.parse({
      flagId: 'pdf-conversion-subtype-1',
      enabledTenants: ['m-grow-ai.com', 'example.com'],
      defaultEnabled: false,
    });
    expect(flag.enabledTenants).toEqual(['m-grow-ai.com', 'example.com']);
    expect(flag.defaultEnabled).toBe(false);
    expect(flag.expiresAt).toBeUndefined();
  });

  it('parses a valid flag with expiresAt set', () => {
    const flag = FeatureFlagSchema.parse({
      flagId: 'pdf-conversion-subtype-1',
      enabledTenants: [],
      defaultEnabled: true,
      expiresAt: '2026-12-31T23:59:59.000Z',
    });
    expect(flag.expiresAt).toBe('2026-12-31T23:59:59.000Z');
  });

  it('rejects a flag with invalid expiresAt format', () => {
    expect(() =>
      FeatureFlagSchema.parse({
        flagId: 'pdf-conversion-subtype-1',
        enabledTenants: [],
        defaultEnabled: false,
        expiresAt: 'not-a-date',
      })
    ).toThrow();
  });

  it('rejects a flag with an unknown flagId', () => {
    expect(() =>
      FeatureFlagSchema.parse({
        flagId: 'unknown-flag',
        enabledTenants: [],
        defaultEnabled: false,
      })
    ).toThrow();
  });

  it('rejects enabledTenants containing an empty string', () => {
    expect(() =>
      FeatureFlagSchema.parse({
        flagId: 'pdf-conversion-subtype-1',
        enabledTenants: [''],
        defaultEnabled: false,
      })
    ).toThrow();
  });
});

// ── isFeatureEnabled tests ─────────────────────────────────────────────────

describe('isFeatureEnabled', () => {
  /** Helper: parse a valid FeatureFlag with given overrides. */
  function makeFlag(
    overrides: Partial<{
      enabledTenants: string[];
      defaultEnabled: boolean;
      expiresAt: string;
    }>
  ): FeatureFlag {
    return FeatureFlagSchema.parse({
      flagId: 'pdf-conversion-subtype-1',
      enabledTenants: [],
      defaultEnabled: false,
      ...overrides,
    });
  }

  it('returns false when flag is null', () => {
    expect(isFeatureEnabled(null, 'm-grow-ai.com')).toBe(false);
  });

  it('returns false when flag is undefined', () => {
    expect(isFeatureEnabled(undefined, 'm-grow-ai.com')).toBe(false);
  });

  it('returns true when tenantId is in enabledTenants', () => {
    const flag = makeFlag({ enabledTenants: ['m-grow-ai.com'] });
    expect(isFeatureEnabled(flag, 'm-grow-ai.com')).toBe(true);
  });

  it('returns false when tenantId is NOT in enabledTenants and defaultEnabled=false', () => {
    const flag = makeFlag({ enabledTenants: ['other.com'], defaultEnabled: false });
    expect(isFeatureEnabled(flag, 'm-grow-ai.com')).toBe(false);
  });

  it('returns true when tenantId is NOT in enabledTenants but defaultEnabled=true', () => {
    const flag = makeFlag({ defaultEnabled: true });
    expect(isFeatureEnabled(flag, 'any-tenant')).toBe(true);
  });

  it('returns false when flag is expired (now >= expiresAt)', () => {
    const flag = makeFlag({
      enabledTenants: ['m-grow-ai.com'],
      expiresAt: '2026-01-01T00:00:00.000Z',
    });
    const afterExpiry = new Date('2026-06-01T00:00:00.000Z');
    expect(isFeatureEnabled(flag, 'm-grow-ai.com', afterExpiry)).toBe(false);
  });

  it('returns false at the exact moment of expiry (boundary: now === expiresAt)', () => {
    const flag = makeFlag({
      enabledTenants: ['m-grow-ai.com'],
      expiresAt: '2026-06-01T00:00:00.000Z',
    });
    const exactExpiry = new Date('2026-06-01T00:00:00.000Z');
    expect(isFeatureEnabled(flag, 'm-grow-ai.com', exactExpiry)).toBe(false);
  });

  it('returns true when flag has expiresAt set but has not expired yet', () => {
    const flag = makeFlag({
      enabledTenants: ['m-grow-ai.com'],
      expiresAt: '2027-12-31T23:59:59.000Z',
    });
    const now = new Date('2026-06-01T00:00:00.000Z');
    expect(isFeatureEnabled(flag, 'm-grow-ai.com', now)).toBe(true);
  });

  it('expiry overrides allow-list: expired flag returns false even for listed tenant', () => {
    const flag = makeFlag({
      enabledTenants: ['m-grow-ai.com'],
      defaultEnabled: true,
      expiresAt: '2026-01-01T00:00:00.000Z',
    });
    const afterExpiry = new Date('2026-06-01T00:00:00.000Z');
    expect(isFeatureEnabled(flag, 'm-grow-ai.com', afterExpiry)).toBe(false);
  });
});

// ── Firestore reader tests ─────────────────────────────────────────────────

describe('getFeatureFlag', () => {
  it('reads feature_flags/{flagId} and returns a parsed flag', async () => {
    const { db, collection, doc } = fakeFirestoreWithFlag({
      flagId: 'pdf-conversion-subtype-1',
      enabledTenants: ['m-grow-ai.com'],
      defaultEnabled: false,
    });

    const flag = await getFeatureFlag(db, 'pdf-conversion-subtype-1');

    expect(collection).toHaveBeenCalledWith(FEATURE_FLAGS_COLLECTION);
    expect(doc).toHaveBeenCalledWith('pdf-conversion-subtype-1');
    expect(flag).toEqual({
      flagId: 'pdf-conversion-subtype-1',
      enabledTenants: ['m-grow-ai.com'],
      defaultEnabled: false,
    });
  });

  it('returns null when the flag document does not exist', async () => {
    const { db } = fakeFirestoreWithFlag(null);

    await expect(
      getFeatureFlag(db, 'pdf-conversion-subtype-1')
    ).resolves.toBeNull();
  });

  it('returns null for an invalid flag document and fails closed', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db } = fakeFirestoreWithFlag({
      flagId: 'pdf-conversion-subtype-1',
      enabledTenants: ['m-grow-ai.com'],
      defaultEnabled: 'yes',
    });

    try {
      await expect(
        getFeatureFlag(db, 'pdf-conversion-subtype-1')
      ).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        '[featureFlags] invalid feature flag document ignored',
        expect.objectContaining({ flagId: 'pdf-conversion-subtype-1' })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ── Constants tests ────────────────────────────────────────────────────────

describe('FEATURE_FLAG_IDS', () => {
  it('includes pdf-conversion-subtype-1', () => {
    const ids: readonly FeatureFlagId[] = FEATURE_FLAG_IDS;
    expect(ids).toContain('pdf-conversion-subtype-1');
  });

  it('each ID is a non-empty string', () => {
    for (const id of FEATURE_FLAG_IDS) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });
});

describe('FEATURE_FLAGS_COLLECTION', () => {
  it('is the Firestore collection name from D-P3-H-4', () => {
    expect(FEATURE_FLAGS_COLLECTION).toBe('feature_flags');
  });
});

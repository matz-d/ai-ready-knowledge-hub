import { describe, expect, it } from 'vitest';
import {
  ACTOR_EMAIL_HEADER,
  AUTH_PROVIDER_HEADER,
  IAP_AUTHENTICATED_USER_EMAIL_HEADER,
  MissingAuthContextError,
  TENANT_ID_HEADER,
  normalizeIapAuthenticatedUserEmail,
  resolveTenantIdFromAuth,
} from '../resolveTenantIdFromAuth';

describe('normalizeIapAuthenticatedUserEmail', () => {
  it('normalizes the Cloud IAP provider-prefixed email header', () => {
    expect(
      normalizeIapAuthenticatedUserEmail('accounts.google.com:Owner@Example.COM')
    ).toBe('owner@example.com');
  });

  it('rejects malformed values', () => {
    expect(normalizeIapAuthenticatedUserEmail('accounts.google.com:not-email')).toBe(
      null
    );
  });
});

describe('resolveTenantIdFromAuth', () => {
  it('uses the IAP email domain as the tenant id by default', () => {
    const headers = new Headers({
      [IAP_AUTHENTICATED_USER_EMAIL_HEADER]:
        'accounts.google.com:alice@customer.example',
    });

    expect(resolveTenantIdFromAuth(headers)).toEqual({
      tenantId: 'customer.example',
      provider: 'iap',
      actor: {
        userId: 'alice@customer.example',
        email: 'alice@customer.example',
      },
    });
  });

  it('prefers a configured tenant id override when provided', () => {
    const headers = new Headers({
      [IAP_AUTHENTICATED_USER_EMAIL_HEADER]:
        'accounts.google.com:alice@customer.example',
    });

    expect(
      resolveTenantIdFromAuth(headers, { tenantIdOverride: 'Tenant One' })
        .tenantId
    ).toBe('tenant-one');
  });

  it('accepts middleware-forwarded auth headers', () => {
    const headers = new Headers({
      [TENANT_ID_HEADER]: 'customer.example',
      [ACTOR_EMAIL_HEADER]: 'bob@customer.example',
      [AUTH_PROVIDER_HEADER]: 'iap',
    });

    expect(resolveTenantIdFromAuth(headers).actor.userId).toBe(
      'bob@customer.example'
    );
  });

  it('falls back to local-dev only when explicitly allowed', () => {
    expect(
      resolveTenantIdFromAuth(new Headers(), { allowLocalFallback: true })
    ).toEqual({
      tenantId: 'local-dev',
      provider: 'local-dev',
      actor: {
        userId: 'local-dev@localhost.local',
        email: 'local-dev@localhost.local',
      },
    });
  });

  it('throws when no auth context is present and fallback is disabled', () => {
    expect(() => resolveTenantIdFromAuth(new Headers())).toThrow(
      MissingAuthContextError
    );
  });
});


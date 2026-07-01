import { beforeAll, describe, expect, it } from 'vitest';
import {
  ACTOR_EMAIL_HEADER,
  AUTH_PROVIDER_HEADER,
  IAP_AUTHENTICATED_USER_EMAIL_HEADER,
  MissingAuthContextError,
  TENANT_ID_HEADER,
} from '../resolveTenantIdFromAuth';
import { prepareRequestAuthHeaders } from '../prepareRequestAuthHeaders';
import {
  IAP_TEST_AUDIENCE,
  createIapJwtTestFixtures,
  headersWithIapAssertion,
  type IapJwtTestFixtures,
} from './iapJwtTestFixtures';

describe('prepareRequestAuthHeaders (middleware auth integration)', () => {
  let fixtures: IapJwtTestFixtures;

  beforeAll(async () => {
    fixtures = await createIapJwtTestFixtures();
  });

  it('binds verified JWT identity and ignores spoofed client headers in IAP mode', async () => {
    const headers = await headersWithIapAssertion(fixtures, {
      email: 'alice@customer.example',
      extra: {
        [IAP_AUTHENTICATED_USER_EMAIL_HEADER]:
          'accounts.google.com:attacker@evil.example',
        [TENANT_ID_HEADER]: 'attacker.example',
        [ACTOR_EMAIL_HEADER]: 'attacker@evil.example',
        [AUTH_PROVIDER_HEADER]: 'iap',
      },
    });

    const trusted = await prepareRequestAuthHeaders(headers, {
      authMode: 'iap',
      iapJwtAudience: IAP_TEST_AUDIENCE,
      jwkSet: fixtures.localJwkSet,
    });

    expect(trusted.get(TENANT_ID_HEADER)).toBe('customer.example');
    expect(trusted.get(ACTOR_EMAIL_HEADER)).toBe('alice@customer.example');
    expect(trusted.get(AUTH_PROVIDER_HEADER)).toBe('iap');
    expect(trusted.get(IAP_AUTHENTICATED_USER_EMAIL_HEADER)).toBe(
      'accounts.google.com:alice@customer.example'
    );
  });

  it('does not trust a client-supplied IAP email header without a verified JWT', async () => {
    const headers = new Headers({
      [IAP_AUTHENTICATED_USER_EMAIL_HEADER]:
        'accounts.google.com:attacker@evil.example',
      [TENANT_ID_HEADER]: 'attacker.example',
      [ACTOR_EMAIL_HEADER]: 'attacker@evil.example',
    });

    await expect(
      prepareRequestAuthHeaders(headers, {
        authMode: 'iap',
        iapJwtAudience: IAP_TEST_AUDIENCE,
        jwkSet: fixtures.localJwkSet,
      })
    ).rejects.toBeInstanceOf(MissingAuthContextError);
  });

  it('rejects IAP mode when the JWT assertion is missing', async () => {
    const headers = new Headers({
      [IAP_AUTHENTICATED_USER_EMAIL_HEADER]:
        'accounts.google.com:alice@customer.example',
    });

    await expect(
      prepareRequestAuthHeaders(headers, {
        authMode: 'iap',
        iapJwtAudience: IAP_TEST_AUDIENCE,
        jwkSet: fixtures.localJwkSet,
      })
    ).rejects.toBeInstanceOf(MissingAuthContextError);
  });

  it('ignores spoofed forwarded headers in local mode', async () => {
    const headers = new Headers({
      [TENANT_ID_HEADER]: 'attacker.example',
      [ACTOR_EMAIL_HEADER]: 'attacker@evil.example',
      [AUTH_PROVIDER_HEADER]: 'iap',
      [IAP_AUTHENTICATED_USER_EMAIL_HEADER]:
        'accounts.google.com:attacker@evil.example',
    });

    const trusted = await prepareRequestAuthHeaders(headers, {
      authMode: 'local',
    });

    expect(trusted.get(TENANT_ID_HEADER)).toBe('local-dev');
    expect(trusted.get(ACTOR_EMAIL_HEADER)).toBe('local-dev@localhost.local');
    expect(trusted.get(AUTH_PROVIDER_HEADER)).toBe('local-dev');
    expect(trusted.get(IAP_AUTHENTICATED_USER_EMAIL_HEADER)).toBeNull();
  });

  it('applies tenant override after verified JWT identity is bound', async () => {
    const headers = await headersWithIapAssertion(fixtures, {
      email: 'alice@customer.example',
    });

    const trusted = await prepareRequestAuthHeaders(headers, {
      authMode: 'iap',
      iapJwtAudience: IAP_TEST_AUDIENCE,
      tenantIdOverride: 'public-demo',
      jwkSet: fixtures.localJwkSet,
    });

    expect(trusted.get(TENANT_ID_HEADER)).toBe('public-demo');
    expect(trusted.get(ACTOR_EMAIL_HEADER)).toBe('alice@customer.example');
  });
});

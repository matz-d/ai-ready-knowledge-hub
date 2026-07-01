import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IAP_JWT_ASSERTION_HEADER } from '../lib/auth/verifyIapJwt';

describe('middleware', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('returns 401 in IAP mode when the JWT assertion is missing', async () => {
    vi.stubEnv('AUTH_MODE', 'iap');
    vi.stubEnv('IAP_JWT_AUDIENCE', '/projects/123/services/demo');

    const { middleware } = await import('../middleware');
    const request = new NextRequest('http://localhost/api/documents');
    const response = await middleware(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'authentication_required',
    });
  });

  it('allows local mode without IAP assertion', async () => {
    vi.stubEnv('AUTH_MODE', 'local');

    const { middleware } = await import('../middleware');
    const request = new NextRequest('http://localhost/api/documents', {
      headers: {
        'x-knowledge-hub-tenant-id': 'attacker.example',
        'x-knowledge-hub-actor-email': 'attacker@evil.example',
        'x-goog-authenticated-user-email':
          'accounts.google.com:attacker@evil.example',
      },
    });
    const response = await middleware(request);

    expect(response.status).toBe(200);
  });

  it('returns 401 in IAP mode when only a spoofed IAP email header is present', async () => {
    vi.stubEnv('AUTH_MODE', 'iap');
    vi.stubEnv('IAP_JWT_AUDIENCE', '/projects/123/services/demo');

    const { middleware } = await import('../middleware');
    const request = new NextRequest('http://localhost/api/documents', {
      headers: {
        'x-goog-authenticated-user-email':
          'accounts.google.com:attacker@evil.example',
      },
    });
    const response = await middleware(request);

    expect(response.status).toBe(401);
  });

  it('returns 401 in IAP mode when the assertion header is empty', async () => {
    vi.stubEnv('AUTH_MODE', 'iap');
    vi.stubEnv('IAP_JWT_AUDIENCE', '/projects/123/services/demo');

    const { middleware } = await import('../middleware');
    const request = new NextRequest('http://localhost/api/documents', {
      headers: {
        [IAP_JWT_ASSERTION_HEADER]: '   ',
      },
    });
    const response = await middleware(request);

    expect(response.status).toBe(401);
  });
});

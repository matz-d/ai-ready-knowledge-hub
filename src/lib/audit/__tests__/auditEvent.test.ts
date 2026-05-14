import { describe, expect, it } from 'vitest';
import {
  auditActorFromRequest,
  ipAddressFromHeaders,
  userAgentFromHeaders,
} from '../auditEvent';
import { IAP_AUTHENTICATED_USER_EMAIL_HEADER } from '../../auth/resolveTenantIdFromAuth';

describe('audit request metadata helpers', () => {
  it('extracts the client ip from the first x-forwarded-for hop', () => {
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.10, 10.0.0.1',
    });

    expect(ipAddressFromHeaders(headers)).toBe('203.0.113.10');
  });

  it('uses unknown for missing user agent', () => {
    expect(userAgentFromHeaders(new Headers())).toBe('unknown');
  });

  it('builds actor metadata from IAP headers', () => {
    const request = new Request('https://example.test/api/documents', {
      headers: {
        [IAP_AUTHENTICATED_USER_EMAIL_HEADER]:
          'accounts.google.com:alice@customer.example',
        'user-agent': 'vitest',
        'x-forwarded-for': '203.0.113.10',
      },
    });

    expect(auditActorFromRequest(request)).toEqual({
      tenantId: 'customer.example',
      actor: {
        userId: 'alice@customer.example',
        ipAddress: '203.0.113.10',
        userAgent: 'vitest',
      },
    });
  });
});


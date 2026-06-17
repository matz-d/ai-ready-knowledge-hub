import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PDF_TABLE_ASSIST_TASK_SIGNATURE_MAX_AGE_MS,
  signPdfTableAssistTaskPayload,
  verifyPdfTableAssistTaskPayload,
} from '../pdfTableAssistTaskSigning';

const actor = {
  userId: 'user-1',
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
};

const input = {
  docId: 'doc-1',
  tenantId: 'tenant-1',
  actor,
};

beforeEach(() => {
  delete process.env.PDF_TABLE_ASSIST_TASK_SIGNING_SECRET;
  vi.unstubAllEnvs();
});

afterEach(() => {
  delete process.env.PDF_TABLE_ASSIST_TASK_SIGNING_SECRET;
  vi.unstubAllEnvs();
});

describe('signPdfTableAssistTaskPayload', () => {
  it('signs a canonical payload with HMAC-SHA256', () => {
    const signed = signPdfTableAssistTaskPayload(input, {
      secret: 'signing-secret',
      issuedAt: '2026-06-17T00:00:00.000Z',
    });

    expect(signed).toEqual({
      ...input,
      issuedAt: '2026-06-17T00:00:00.000Z',
      signature: expect.any(String),
    });
    expect(signed.signature).toHaveLength(64);
  });

  it('rejects signing when the secret is missing', () => {
    expect(() => signPdfTableAssistTaskPayload(input)).toThrow(
      /PDF_TABLE_ASSIST_TASK_SIGNING_SECRET/
    );
  });
});

describe('verifyPdfTableAssistTaskPayload', () => {
  it('accepts a valid signed payload', () => {
    const signed = signPdfTableAssistTaskPayload(input, {
      secret: 'signing-secret',
      issuedAt: '2026-06-17T00:00:00.000Z',
    });

    const verified = verifyPdfTableAssistTaskPayload(signed, {
      secret: 'signing-secret',
      now: new Date('2026-06-17T01:00:00.000Z'),
    });

    expect(verified).toEqual({ ok: true, payload: signed });
  });

  it('rejects a tampered tenantId', () => {
    const signed = signPdfTableAssistTaskPayload(input, {
      secret: 'signing-secret',
      issuedAt: '2026-06-17T00:00:00.000Z',
    });

    const verified = verifyPdfTableAssistTaskPayload(
      { ...signed, tenantId: 'other-tenant' },
      {
        secret: 'signing-secret',
        now: new Date('2026-06-17T01:00:00.000Z'),
      }
    );

    expect(verified).toEqual({ ok: false, code: 'task_signature_invalid' });
  });

  it('rejects an expired signature', () => {
    const signed = signPdfTableAssistTaskPayload(input, {
      secret: 'signing-secret',
      issuedAt: '2026-06-01T00:00:00.000Z',
    });

    const verified = verifyPdfTableAssistTaskPayload(signed, {
      secret: 'signing-secret',
      now: new Date('2026-06-17T00:00:00.000Z'),
      maxAgeMs: PDF_TABLE_ASSIST_TASK_SIGNATURE_MAX_AGE_MS,
    });

    expect(verified).toEqual({ ok: false, code: 'task_signature_expired' });
  });

  it('requires a signature in production even when the secret env is unset', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const verified = verifyPdfTableAssistTaskPayload(input);

    expect(verified).toEqual({ ok: false, code: 'task_signature_required' });
  });

  it('allows unsigned payloads in dev when signing is not configured', () => {
    const verified = verifyPdfTableAssistTaskPayload(input);

    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.tenantId).toBe('tenant-1');
    }
  });
});

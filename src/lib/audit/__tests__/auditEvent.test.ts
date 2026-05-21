import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createMock, getFirestoreClientMock, serverTimestampMock } = vi.hoisted(
  () => ({
    createMock: vi.fn(),
    getFirestoreClientMock: vi.fn(),
    serverTimestampMock: vi.fn(),
  })
);

vi.mock('../../firestore', () => ({
  FieldValue: {
    serverTimestamp: serverTimestampMock,
  },
  getFirestoreClient: getFirestoreClientMock,
}));

import {
  AUDIT_EVENTS_COLLECTION,
  assertConversionInferenceDestinationInvariant,
  assertConversionUnmaskablePiiFindingsInvariant,
  auditActorFromRequest,
  ipAddressFromHeaders,
  recordAuditEvent,
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

describe('recordAuditEvent', () => {
  beforeEach(() => {
    createMock.mockReset();
    getFirestoreClientMock.mockReset();
    serverTimestampMock.mockReturnValue('SERVER_TIMESTAMP');
    getFirestoreClientMock.mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          create: createMock,
        })),
      })),
    });
  });

  it('appends document.convert with conversion metadata and no inferenceDestination', async () => {
    const eventId = await recordAuditEvent({
      tenantId: 'customer.example',
      actor: {
        userId: 'alice@customer.example',
        ipAddress: '203.0.113.10',
        userAgent: 'vitest',
      },
      action: 'document.convert',
      target: {
        docId: 'doc-pdf-1',
        fileName: 'sample.pdf',
        sourceKind: 'upload',
        sensitivity: 'Internal',
      },
      result: 'success',
      conversion: {
        converterId: 'pdf-parse',
        sourceSubtype: 'official-doc-pdf',
        evalStatus: 'pass',
      },
    });

    expect(eventId).toMatch(/^[0-9a-z]+-[0-9a-f]{16}$/);
    expect(getFirestoreClientMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledTimes(1);

    const [written] = createMock.mock.calls[0] as [Record<string, unknown>];
    expect(written).toEqual(
      expect.objectContaining({
        eventId,
        occurredAt: 'SERVER_TIMESTAMP',
        tenantId: 'customer.example',
        action: 'document.convert',
        result: 'success',
        conversion: {
          converterId: 'pdf-parse',
          sourceSubtype: 'official-doc-pdf',
          evalStatus: 'pass',
        },
      })
    );
    expect(written.inferenceDestination).toBeUndefined();
    expect(getFirestoreClientMock.mock.results[0]?.value.collection).toHaveBeenCalledWith(
      AUDIT_EVENTS_COLLECTION
    );
  });

  it('accepts warn and fail evalStatus values on document.convert', async () => {
    await recordAuditEvent({
      tenantId: 'customer.example',
      actor: {
        userId: 'alice@customer.example',
        ipAddress: '203.0.113.10',
        userAgent: 'vitest',
      },
      action: 'document.convert',
      target: {
        docId: 'doc-pdf-2',
        fileName: 'scan.pdf',
        sourceKind: 'upload',
        sensitivity: 'Confidential',
      },
      result: 'partial',
      conversion: {
        converterId: 'pdf-parse',
        sourceSubtype: 'scan-pdf',
        evalStatus: 'warn',
      },
    });

    await recordAuditEvent({
      tenantId: 'customer.example',
      actor: {
        userId: 'alice@customer.example',
        ipAddress: '203.0.113.10',
        userAgent: 'vitest',
      },
      action: 'document.convert',
      target: {
        docId: 'doc-pdf-3',
        fileName: 'slides.pdf',
        sourceKind: 'upload',
        sensitivity: 'Internal',
      },
      result: 'partial',
      conversion: {
        converterId: 'pdf-parse',
        sourceSubtype: 'slide-pdf',
        evalStatus: 'fail',
      },
    });

    expect(createMock).toHaveBeenCalledTimes(2);
    const warnBody = createMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const failBody = createMock.mock.calls[1]?.[0] as Record<string, unknown>;
    expect((warnBody.conversion as { evalStatus: string }).evalStatus).toBe('warn');
    expect((failBody.conversion as { evalStatus: string }).evalStatus).toBe('fail');
  });

  it('appends document.convert for slide-pdf gemini-direct-read with inferenceDestination', async () => {
    await recordAuditEvent({
      tenantId: 'customer.example',
      actor: {
        userId: 'alice@customer.example',
        ipAddress: '203.0.113.10',
        userAgent: 'vitest',
      },
      action: 'document.convert',
      target: {
        docId: 'doc-slide-1',
        fileName: 'slides.pdf',
        sourceKind: 'upload',
        sensitivity: 'Internal',
      },
      result: 'success',
      conversion: {
        converterId: 'gemini-direct-read',
        sourceSubtype: 'slide-pdf',
        evalStatus: 'pass',
      },
      inferenceDestination: {
        vendor: 'vertex',
        region: 'asia-northeast1',
        model: 'gemini-2.5-flash',
      },
    });

    const [written] = createMock.mock.calls[0] as [Record<string, unknown>];
    expect(written.inferenceDestination).toEqual({
      vendor: 'vertex',
      region: 'asia-northeast1',
      model: 'gemini-2.5-flash',
    });
    expect((written.conversion as { converterId: string }).converterId).toBe(
      'gemini-direct-read'
    );
  });

  it('appends document.convert for scan-pdf gemini-vertex-ocr with inferenceDestination and unmaskablePiiFindings count', async () => {
    await recordAuditEvent({
      tenantId: 'customer.example',
      actor: {
        userId: 'alice@customer.example',
        ipAddress: '203.0.113.10',
        userAgent: 'vitest',
      },
      action: 'document.convert',
      target: {
        docId: 'doc-scan-1',
        fileName: 'scan.pdf',
        sourceKind: 'upload',
        sensitivity: 'Confidential',
      },
      result: 'success',
      conversion: {
        converterId: 'gemini-vertex-ocr',
        sourceSubtype: 'scan-pdf',
        evalStatus: 'pass',
        unmaskablePiiFindings: { count: 0 },
      },
      inferenceDestination: {
        vendor: 'vertex',
        region: 'us-central1',
        model: 'gemini-2.5-pro',
      },
    });

    const [written] = createMock.mock.calls[0] as [Record<string, unknown>];
    expect(written.inferenceDestination).toEqual({
      vendor: 'vertex',
      region: 'us-central1',
      model: 'gemini-2.5-pro',
    });
    expect(
      (written.conversion as { unmaskablePiiFindings: { count: number } })
        .unmaskablePiiFindings
    ).toEqual({ count: 0 });
  });

  it('appends document.convert for slide-pdf pdf-parse-fallback without inferenceDestination', async () => {
    await recordAuditEvent({
      tenantId: 'customer.example',
      actor: {
        userId: 'alice@customer.example',
        ipAddress: '203.0.113.10',
        userAgent: 'vitest',
      },
      action: 'document.convert',
      target: {
        docId: 'doc-slide-fb',
        fileName: 'slides.pdf',
        sourceKind: 'upload',
        sensitivity: 'Internal',
      },
      result: 'partial',
      conversion: {
        converterId: 'pdf-parse-fallback',
        sourceSubtype: 'slide-pdf',
        evalStatus: 'warn',
      },
    });

    const [written] = createMock.mock.calls[0] as [Record<string, unknown>];
    expect(written.inferenceDestination).toBeUndefined();
    expect((written.conversion as { converterId: string }).converterId).toBe(
      'pdf-parse-fallback'
    );
  });

  it('throws when slide-pdf gemini-direct-read is missing inferenceDestination', async () => {
    await expect(
      recordAuditEvent({
        tenantId: 'customer.example',
        actor: {
          userId: 'alice@customer.example',
          ipAddress: '203.0.113.10',
          userAgent: 'vitest',
        },
        action: 'document.convert',
        target: {
          docId: 'doc-slide-2',
          fileName: 'slides.pdf',
          sourceKind: 'upload',
          sensitivity: 'Internal',
        },
        result: 'success',
        conversion: {
          converterId: 'gemini-direct-read',
          sourceSubtype: 'slide-pdf',
          evalStatus: 'pass',
        },
      })
    ).rejects.toThrow(/inferenceDestination is required/);

    expect(createMock).not.toHaveBeenCalled();
  });

  it('throws when official-doc-pdf pdf-parse includes inferenceDestination', async () => {
    await expect(
      recordAuditEvent({
        tenantId: 'customer.example',
        actor: {
          userId: 'alice@customer.example',
          ipAddress: '203.0.113.10',
          userAgent: 'vitest',
        },
        action: 'document.convert',
        target: {
          docId: 'doc-official-1',
          fileName: 'guide.pdf',
          sourceKind: 'upload',
          sensitivity: 'Internal',
        },
        result: 'success',
        conversion: {
          converterId: 'pdf-parse',
          sourceSubtype: 'official-doc-pdf',
          evalStatus: 'pass',
        },
        inferenceDestination: {
          vendor: 'vertex',
          region: 'asia-northeast1',
          model: 'gemini-2.5-flash',
        },
      })
    ).rejects.toThrow(/inferenceDestination must not be set/);

    expect(createMock).not.toHaveBeenCalled();
  });

  it('throws when slide-pdf pdf-parse-fallback includes inferenceDestination', async () => {
    await expect(
      recordAuditEvent({
        tenantId: 'customer.example',
        actor: {
          userId: 'alice@customer.example',
          ipAddress: '203.0.113.10',
          userAgent: 'vitest',
        },
        action: 'document.convert',
        target: {
          docId: 'doc-slide-fb-2',
          fileName: 'slides.pdf',
          sourceKind: 'upload',
          sensitivity: 'Internal',
        },
        result: 'partial',
        conversion: {
          converterId: 'pdf-parse-fallback',
          sourceSubtype: 'slide-pdf',
          evalStatus: 'warn',
        },
        inferenceDestination: {
          vendor: 'vertex',
          region: 'asia-northeast1',
          model: 'gemini-2.5-flash',
        },
      })
    ).rejects.toThrow(/inferenceDestination must not be set/);
  });
});

describe('assertConversionInferenceDestinationInvariant', () => {
  it('accepts official-doc-pdf + pdf-parse without inferenceDestination', () => {
    expect(() =>
      assertConversionInferenceDestinationInvariant({
        conversion: {
          converterId: 'pdf-parse',
          sourceSubtype: 'official-doc-pdf',
          evalStatus: 'pass',
        },
        inferenceDestination: undefined,
      })
    ).not.toThrow();
  });

  it('accepts slide-pdf + pdf-parse-fallback without inferenceDestination', () => {
    expect(() =>
      assertConversionInferenceDestinationInvariant({
        conversion: {
          converterId: 'pdf-parse-fallback',
          sourceSubtype: 'slide-pdf',
          evalStatus: 'warn',
        },
        inferenceDestination: undefined,
      })
    ).not.toThrow();
  });

  it('accepts slide-pdf + gemini-direct-read with inferenceDestination', () => {
    expect(() =>
      assertConversionInferenceDestinationInvariant({
        conversion: {
          converterId: 'gemini-direct-read',
          sourceSubtype: 'slide-pdf',
          evalStatus: 'pass',
        },
        inferenceDestination: {
          vendor: 'vertex',
          region: 'asia-northeast1',
          model: 'gemini-2.5-flash',
        },
      })
    ).not.toThrow();
  });

  it('throws when Vertex converter on slide-pdf is missing inferenceDestination', () => {
    expect(() =>
      assertConversionInferenceDestinationInvariant({
        conversion: {
          converterId: 'gemini-direct-read',
          sourceSubtype: 'slide-pdf',
          evalStatus: 'pass',
        },
        inferenceDestination: undefined,
      })
    ).toThrow(/required/);
  });

  it('throws when inferenceDestination is provided with a non-Vertex converter', () => {
    expect(() =>
      assertConversionInferenceDestinationInvariant({
        conversion: {
          converterId: 'pdf-parse-fallback',
          sourceSubtype: 'slide-pdf',
          evalStatus: 'warn',
        },
        inferenceDestination: {
          vendor: 'vertex',
          region: 'asia-northeast1',
          model: 'gemini-2.5-flash',
        },
      })
    ).toThrow(/must not be set/);
  });

  it('throws when inferenceDestination is provided on official-doc-pdf', () => {
    expect(() =>
      assertConversionInferenceDestinationInvariant({
        conversion: {
          converterId: 'pdf-parse',
          sourceSubtype: 'official-doc-pdf',
          evalStatus: 'pass',
        },
        inferenceDestination: {
          vendor: 'vertex',
          region: 'asia-northeast1',
          model: 'gemini-2.5-flash',
        },
      })
    ).toThrow(/must not be set/);
  });
});

describe('assertConversionUnmaskablePiiFindingsInvariant', () => {
  it('accepts scan-pdf + gemini-vertex-ocr + success + count 0', () => {
    expect(() =>
      assertConversionUnmaskablePiiFindingsInvariant({
        conversion: {
          converterId: 'gemini-vertex-ocr',
          sourceSubtype: 'scan-pdf',
          evalStatus: 'pass',
          unmaskablePiiFindings: { count: 0 },
        },
        result: 'success',
      })
    ).not.toThrow();
  });

  it('accepts scan-pdf + gemini-vertex-ocr + success + count 3', () => {
    expect(() =>
      assertConversionUnmaskablePiiFindingsInvariant({
        conversion: {
          converterId: 'gemini-vertex-ocr',
          sourceSubtype: 'scan-pdf',
          evalStatus: 'pass',
          unmaskablePiiFindings: { count: 3 },
        },
        result: 'success',
      })
    ).not.toThrow();
  });

  it('throws when scan-pdf + gemini-vertex-ocr + success + count is missing', () => {
    expect(() =>
      assertConversionUnmaskablePiiFindingsInvariant({
        conversion: {
          converterId: 'gemini-vertex-ocr',
          sourceSubtype: 'scan-pdf',
          evalStatus: 'pass',
        },
        result: 'success',
      })
    ).toThrow(/unmaskablePiiFindings\.count is required/);
  });

  it('throws when slide-pdf + gemini-direct-read + success + unmaskablePiiFindings set', () => {
    expect(() =>
      assertConversionUnmaskablePiiFindingsInvariant({
        conversion: {
          converterId: 'gemini-direct-read',
          sourceSubtype: 'slide-pdf',
          evalStatus: 'pass',
          unmaskablePiiFindings: { count: 1 },
        },
        result: 'success',
      })
    ).toThrow(/must not be set/);
  });

  it('throws when scan-pdf + pdf-parse-fallback + success + unmaskablePiiFindings set', () => {
    expect(() =>
      assertConversionUnmaskablePiiFindingsInvariant({
        conversion: {
          converterId: 'pdf-parse-fallback',
          sourceSubtype: 'scan-pdf',
          evalStatus: 'warn',
          unmaskablePiiFindings: { count: 1 },
        },
        result: 'success',
      })
    ).toThrow(/must not be set/);
  });
});


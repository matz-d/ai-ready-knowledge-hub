import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditActorFromRequestMock, reprocessPdfWithTableAssistMock } =
  vi.hoisted(() => ({
    auditActorFromRequestMock: vi.fn(),
    reprocessPdfWithTableAssistMock: vi.fn(),
  }));

vi.mock('../../../../../../lib/audit/auditEvent', () => ({
  auditActorFromRequest: auditActorFromRequestMock,
}));

vi.mock('../../../../../../lib/pdfTableAssistReprocessor', () => ({
  reprocessPdfWithTableAssist: reprocessPdfWithTableAssistMock,
}));

vi.mock('../../../../../../lib/extractors/pdfExtractionDispatcher', () => ({
  PDF_UPLOAD_BETA_DISABLED_MESSAGE: 'PDF upload disabled',
  PDF_CONFLICTING_SUBTYPE_FLAGS_MESSAGE: 'PDF flags conflict',
  PDF_EXTRACTION_FAILED_MESSAGE: 'PDF extraction failed',
}));

import { POST } from '../route';

function request(): Request {
  return new Request('http://localhost/api/documents/doc-1/table-assist', {
    method: 'POST',
  });
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  auditActorFromRequestMock.mockReturnValue({
    tenantId: 'tenant-1',
    actor: {
      userId: 'user-1',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    },
  });
  reprocessPdfWithTableAssistMock.mockResolvedValue({
    ok: true,
    result: {
      body: {
        docId: 'doc-1',
        fileName: 'sample.pdf',
        contentType: 'application/pdf',
        byteSize: 123,
        storagePath: 'raw/doc-1/sample.pdf',
        status: 'curated',
        kind: 'overwritten',
        curator: {
          documentType: '手順書',
          businessDomain: '社内手順',
          sensitivity: 'Internal',
          freshness: 'current',
          isAuthoritativeCandidate: true,
          aiUsePolicy: 'direct',
          rationale: 'ok',
          completedAt: '2026-06-01T00:00:00.000Z',
          modelId: 'test-model',
        },
        tableAssist: {
          mode: 'async',
          enabled: true,
          pagesSelected: 1,
          pagesSucceeded: 1,
          pagesFailed: 0,
          candidatesGrounded: 2,
          candidatesRejected: 0,
          blocksAdded: 1,
        },
      },
    },
  });
});

describe('POST /api/documents/[docId]/table-assist', () => {
  it('runs the product table-assist reprocess path for the authenticated tenant', async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ docId: 'doc-1' }),
    });

    expect(response.status).toBe(200);
    await expect(parseJson(response)).resolves.toEqual(
      expect.objectContaining({
        docId: 'doc-1',
        kind: 'overwritten',
        tableAssist: expect.objectContaining({ blocksAdded: 1 }),
      })
    );
    expect(reprocessPdfWithTableAssistMock).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 'doc-1',
        tenantId: 'tenant-1',
        auditContext: expect.objectContaining({
          tenantId: 'tenant-1',
        }),
      })
    );
  });

  it('returns 401 when tenant context cannot be resolved', async () => {
    auditActorFromRequestMock.mockImplementation(() => {
      throw new Error('missing tenant');
    });

    const response = await POST(request(), {
      params: Promise.resolve({ docId: 'doc-1' }),
    });

    expect(response.status).toBe(401);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'tenant_required',
    });
    expect(reprocessPdfWithTableAssistMock).not.toHaveBeenCalled();
  });

  it('maps non-reprocessable documents to 409', async () => {
    reprocessPdfWithTableAssistMock.mockResolvedValue({
      ok: false,
      failure: { code: 'document_not_reprocessable', status: 'curating' },
    });

    const response = await POST(request(), {
      params: Promise.resolve({ docId: 'doc-1' }),
    });

    expect(response.status).toBe(409);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'document_not_reprocessable',
      status: 'curating',
    });
  });
});

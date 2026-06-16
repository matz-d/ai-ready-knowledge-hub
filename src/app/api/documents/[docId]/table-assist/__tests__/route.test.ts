import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  auditActorFromRequestMock,
  reprocessPdfWithTableAssistMock,
  CuratorPhaseErrorMock,
  MaskerPhaseErrorMock,
} =
  vi.hoisted(() => ({
    auditActorFromRequestMock: vi.fn(),
    reprocessPdfWithTableAssistMock: vi.fn(),
    CuratorPhaseErrorMock: class CuratorPhaseErrorMock extends Error {
      docId: string;
      constructor(docId: string, cause: unknown) {
        super(cause instanceof Error ? cause.message : String(cause));
        this.name = 'CuratorPhaseError';
        this.docId = docId;
      }
    },
    MaskerPhaseErrorMock: class MaskerPhaseErrorMock extends Error {
      docId: string;
      constructor(docId: string, cause: unknown) {
        super(cause instanceof Error ? cause.message : String(cause));
        this.name = 'MaskerPhaseError';
        this.docId = docId;
      }
    },
  }));

vi.mock('../../../../../../lib/audit/auditEvent', () => ({
  auditActorFromRequest: auditActorFromRequestMock,
}));

vi.mock('../../../../../../lib/pdfTableAssistReprocessor', () => ({
  reprocessPdfWithTableAssist: reprocessPdfWithTableAssistMock,
}));

vi.mock('../../../../../../lib/uploadOrchestrator', () => ({
  CuratorPhaseError: CuratorPhaseErrorMock,
  MaskerPhaseError: MaskerPhaseErrorMock,
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

  it('maps a held reprocess lease to 409 reprocess_in_progress', async () => {
    reprocessPdfWithTableAssistMock.mockResolvedValue({
      ok: false,
      failure: { code: 'reprocess_in_progress' },
    });

    const response = await POST(request(), {
      params: Promise.resolve({ docId: 'doc-1' }),
    });

    expect(response.status).toBe(409);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'reprocess_in_progress',
    });
  });

  it('maps curator phase throws to a structured 500', async () => {
    reprocessPdfWithTableAssistMock.mockRejectedValue(
      new CuratorPhaseErrorMock('doc-1', new Error('curator failed'))
    );

    const response = await POST(request(), {
      params: Promise.resolve({ docId: 'doc-1' }),
    });

    expect(response.status).toBe(500);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'curator_failed',
      docId: 'doc-1',
    });
  });

  it('maps masker phase throws to a structured 500', async () => {
    reprocessPdfWithTableAssistMock.mockRejectedValue(
      new MaskerPhaseErrorMock('doc-1', new Error('masker failed'))
    );

    const response = await POST(request(), {
      params: Promise.resolve({ docId: 'doc-1' }),
    });

    expect(response.status).toBe(500);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'masker_failed',
      docId: 'doc-1',
    });
  });

  it('maps unexpected reprocess throws to a structured 502', async () => {
    reprocessPdfWithTableAssistMock.mockRejectedValue(
      new Error('unexpected failure')
    );

    const response = await POST(request(), {
      params: Promise.resolve({ docId: 'doc-1' }),
    });

    expect(response.status).toBe(502);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'reprocess_failed',
    });
  });
});

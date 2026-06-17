import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { POST as POST_WORKER } from '../run/route';
import { signPdfTableAssistTaskPayload } from '../../../../../../lib/pdfTableAssistTaskSigning';

function request(): Request {
  return new Request('http://localhost/api/documents/doc-1/table-assist', {
    method: 'POST',
  });
}

function workerRequest(
  body: Record<string, unknown> = {
    docId: 'doc-1',
    tenantId: 'tenant-1',
    actor: {
      userId: 'user-1',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    },
  },
  headers?: Record<string, string>
): Request {
  return new Request('http://localhost/api/documents/doc-1/table-assist/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });
}

function signedWorkerBody(
  overrides: Partial<{
    docId: string;
    tenantId: string;
    actor: {
      userId: string;
      ipAddress: string;
      userAgent: string;
    };
  }> = {}
): Record<string, unknown> {
  return signPdfTableAssistTaskPayload(
    {
      docId: 'doc-1',
      tenantId: 'tenant-1',
      actor: {
        userId: 'user-1',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      },
      ...overrides,
    },
    {
      secret: process.env.PDF_TABLE_ASSIST_TASK_SIGNING_SECRET,
      issuedAt: '2026-06-17T00:00:00.000Z',
    }
  );
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PDF_TABLE_ASSIST_WORKER_TOKEN;
  delete process.env.CONTEXT_PACKAGE_JOB_TOKEN;
  delete process.env.PDF_TABLE_ASSIST_TASK_SIGNING_SECRET;
  vi.unstubAllEnvs();
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

afterEach(() => {
  vi.unstubAllEnvs();
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

describe('POST /api/documents/[docId]/table-assist/run', () => {
  it('runs table-assist reprocess with the tenant context from the Cloud Tasks body', async () => {
    const response = await POST_WORKER(workerRequest(), {
      params: Promise.resolve({ docId: 'doc-1' }),
    });

    expect(response.status).toBe(200);
    await expect(parseJson(response)).resolves.toEqual(
      expect.objectContaining({
        outcome: 'reprocessed',
        docId: 'doc-1',
        tableAssist: expect.objectContaining({ blocksAdded: 1 }),
      })
    );
    expect(reprocessPdfWithTableAssistMock).toHaveBeenCalledWith({
      docId: 'doc-1',
      tenantId: 'tenant-1',
      auditContext: expect.objectContaining({
        tenantId: 'tenant-1',
        actor: expect.objectContaining({ userId: 'user-1' }),
      }),
    });
  });

  it('rejects a bad worker token when configured', async () => {
    process.env.PDF_TABLE_ASSIST_WORKER_TOKEN = 'secret';

    const response = await POST_WORKER(
      workerRequest(undefined, { 'x-pdf-table-assist-worker-token': 'wrong' }),
      { params: Promise.resolve({ docId: 'doc-1' }) }
    );

    expect(response.status).toBe(401);
    expect(reprocessPdfWithTableAssistMock).not.toHaveBeenCalled();
  });

  it('accepts the configured worker token', async () => {
    process.env.PDF_TABLE_ASSIST_WORKER_TOKEN = 'secret';

    const response = await POST_WORKER(
      workerRequest(undefined, { 'x-pdf-table-assist-worker-token': 'secret' }),
      { params: Promise.resolve({ docId: 'doc-1' }) }
    );

    expect(response.status).toBe(200);
    expect(reprocessPdfWithTableAssistMock).toHaveBeenCalledTimes(1);
  });

  it('returns 503 for reprocess_in_progress so Cloud Tasks retries', async () => {
    reprocessPdfWithTableAssistMock.mockResolvedValue({
      ok: false,
      failure: { code: 'reprocess_in_progress' },
    });

    const response = await POST_WORKER(workerRequest(), {
      params: Promise.resolve({ docId: 'doc-1' }),
    });

    expect(response.status).toBe(503);
    await expect(parseJson(response)).resolves.toEqual({
      outcome: 'skipped',
      failure: { code: 'reprocess_in_progress' },
    });
  });

  it('returns 200 for terminal structured skips', async () => {
    reprocessPdfWithTableAssistMock.mockResolvedValue({
      ok: false,
      failure: { code: 'not_official_doc_pdf' },
    });

    const response = await POST_WORKER(workerRequest(), {
      params: Promise.resolve({ docId: 'doc-1' }),
    });

    expect(response.status).toBe(200);
    await expect(parseJson(response)).resolves.toEqual({
      outcome: 'skipped',
      failure: { code: 'not_official_doc_pdf' },
    });
  });

  it('rejects a mismatched body docId', async () => {
    const response = await POST_WORKER(
      workerRequest({
        docId: 'other-doc',
        tenantId: 'tenant-1',
        actor: {
          userId: 'user-1',
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        },
      }),
      { params: Promise.resolve({ docId: 'doc-1' }) }
    );

    expect(response.status).toBe(400);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'doc_id_mismatch',
    });
    expect(reprocessPdfWithTableAssistMock).not.toHaveBeenCalled();
  });

  it('rejects a tampered tenantId when task signing is configured', async () => {
    process.env.PDF_TABLE_ASSIST_TASK_SIGNING_SECRET = 'signing-secret';
    const signed = signedWorkerBody();

    const response = await POST_WORKER(
      workerRequest({ ...signed, tenantId: 'evil-tenant' }),
      { params: Promise.resolve({ docId: 'doc-1' }) }
    );

    expect(response.status).toBe(401);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'task_signature_invalid',
    });
    expect(reprocessPdfWithTableAssistMock).not.toHaveBeenCalled();
  });

  it('accepts a signed task payload when task signing is configured', async () => {
    process.env.PDF_TABLE_ASSIST_TASK_SIGNING_SECRET = 'signing-secret';

    const response = await POST_WORKER(workerRequest(signedWorkerBody()), {
      params: Promise.resolve({ docId: 'doc-1' }),
    });

    expect(response.status).toBe(200);
    expect(reprocessPdfWithTableAssistMock).toHaveBeenCalledTimes(1);
  });

  it('rejects unsigned payloads in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.PDF_TABLE_ASSIST_WORKER_TOKEN = 'secret';

    const response = await POST_WORKER(
      workerRequest(undefined, { 'x-pdf-table-assist-worker-token': 'secret' }),
      { params: Promise.resolve({ docId: 'doc-1' }) }
    );

    expect(response.status).toBe(401);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'task_signature_required',
    });
    expect(reprocessPdfWithTableAssistMock).not.toHaveBeenCalled();
  });
});

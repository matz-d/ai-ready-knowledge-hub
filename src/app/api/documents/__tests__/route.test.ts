import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

const {
  orchestrateUploadProcessingMock,
  getKnowledgeHubBucketNameMock,
  curatorPhaseErrorClass,
  maskerPhaseErrorClass,
} = vi.hoisted(() => {
  class CuratorPhaseErrorMock extends Error {
    docId: string;
    constructor(docId: string, cause: unknown) {
      super(cause instanceof Error ? cause.message : String(cause));
      this.docId = docId;
      this.name = 'CuratorPhaseError';
    }
  }

  class MaskerPhaseErrorMock extends Error {
    docId: string;
    constructor(docId: string, cause: unknown) {
      super(cause instanceof Error ? cause.message : String(cause));
      this.docId = docId;
      this.name = 'MaskerPhaseError';
    }
  }

  return {
    orchestrateUploadProcessingMock: vi.fn(),
    getKnowledgeHubBucketNameMock: vi.fn(),
    curatorPhaseErrorClass: CuratorPhaseErrorMock,
    maskerPhaseErrorClass: MaskerPhaseErrorMock,
  };
});

vi.mock('../../../../agents/_shared/genkitClient', () => ({
  modelId: 'test-model',
}));

vi.mock('../../../../lib/storage', () => ({
  getKnowledgeHubBucketName: getKnowledgeHubBucketNameMock,
}));

vi.mock('../../../../lib/uploadOrchestrator', () => ({
  orchestrateUploadProcessing: orchestrateUploadProcessingMock,
  CuratorPhaseError: curatorPhaseErrorClass,
  MaskerPhaseError: maskerPhaseErrorClass,
}));

import { POST } from '../route';

function createWorkbookBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['顧客名', '数量'],
      ['Acme', 10],
    ]),
    '顧客一覧'
  );

  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;
}

function toBlobPart(buffer: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buffer);
}

function buildRequestWithFile(file: File): Request {
  const formData = new FormData();
  formData.append('file', file);
  return new Request('http://localhost/api/documents', {
    method: 'POST',
    body: formData,
  });
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  getKnowledgeHubBucketNameMock.mockReturnValue('bucket-1');
  orchestrateUploadProcessingMock.mockResolvedValue({
    kind: 'curated',
    docId: 'doc-1',
    storagePath: 'raw/doc-1/sample.txt',
    curator: {
      documentType: 'メモ',
      businessDomain: '社内手順',
      sensitivity: 'Internal',
      freshness: 'current',
      isAuthoritativeCandidate: true,
      aiUsePolicy: 'direct',
      rationale: 'direct',
    },
    curatorCompletedAt: new Date('2026-05-08T00:00:00.000Z'),
  });
});

describe('POST /api/documents', () => {
  it('returns curated success response shape', async () => {
    const file = new File(['hello'], 'sample.txt', { type: 'text/plain' });

    const response = await POST(buildRequestWithFile(file));
    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        docId: 'doc-1',
        fileName: 'sample.txt',
        contentType: 'text/plain',
        storagePath: 'raw/doc-1/sample.txt',
        status: 'curated',
        curator: expect.objectContaining({
          aiUsePolicy: 'direct',
          modelId: 'test-model',
        }),
      })
    );
    expect(body).not.toHaveProperty('masker');
    expect(body).not.toHaveProperty('aiSafeStoragePath');
  });

  it('fills contentType from extension when MIME type is empty', async () => {
    const payload = new TextEncoder().encode('# hello');
    const file = {
      name: 'sample.md',
      type: '',
      size: payload.byteLength,
      arrayBuffer: async () => payload.buffer,
    };

    const response = await POST({
      formData: async () => ({
        getAll: (name: string) => (name === 'file' ? [file] : []),
      }),
    } as unknown as Request);
    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(orchestrateUploadProcessingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'sample.md',
        contentType: 'text/markdown',
        content: '# hello',
      })
    );
    expect(body).toEqual(
      expect.objectContaining({
        fileName: 'sample.md',
        contentType: 'text/markdown',
      })
    );
  });

  it('accepts .xlsx upload and passes raw bytes plus normalized markdown content', async () => {
    const workbookBuffer = createWorkbookBuffer();
    const file = new File([toBlobPart(workbookBuffer)], 'sales.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const response = await POST(buildRequestWithFile(file));

    expect(response.status).toBe(200);
    const uploadInput = orchestrateUploadProcessingMock.mock.calls[0]?.[0];
    expect(uploadInput).toEqual(
      expect.objectContaining({
        displayName: 'sales.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        content: expect.stringContaining('## 顧客一覧'),
      })
    );
    expect(Buffer.compare(uploadInput.buffer, workbookBuffer)).toBe(0);
    expect(uploadInput.content).toContain('| 顧客名 | 数量 |');
    expect(uploadInput.content).toContain('| Acme | 10 |');
  });

  it('fills .xlsx contentType from extension when MIME type is empty', async () => {
    const payload = createWorkbookBuffer();
    const file = {
      name: 'sales.xlsx',
      type: '',
      size: payload.byteLength,
      arrayBuffer: async () =>
        payload.buffer.slice(
          payload.byteOffset,
          payload.byteOffset + payload.byteLength
        ),
    };

    const response = await POST({
      formData: async () => ({
        getAll: (name: string) => (name === 'file' ? [file] : []),
      }),
    } as unknown as Request);

    expect(response.status).toBe(200);
    expect(orchestrateUploadProcessingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'sales.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        content: expect.stringContaining('| 顧客名 | 数量 |'),
      })
    );
  });

  it('allows official .xlsx MIME type', async () => {
    const file = new File([toBlobPart(createWorkbookBuffer())], 'sales.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const response = await POST(buildRequestWithFile(file));

    expect(response.status).toBe(200);
    expect(orchestrateUploadProcessingMock).toHaveBeenCalledTimes(1);
  });

  it('returns blocked success response shape', async () => {
    orchestrateUploadProcessingMock.mockResolvedValue({
      kind: 'blocked',
      docId: 'doc-blocked',
      storagePath: 'raw/doc-blocked/sample.txt',
      curator: {
        documentType: '契約書',
        businessDomain: '顧問契約管理',
        sensitivity: 'Restricted',
        freshness: 'current',
        isAuthoritativeCandidate: true,
        aiUsePolicy: 'blocked',
        rationale: 'blocked',
      },
      curatorCompletedAt: new Date('2026-05-08T01:00:00.000Z'),
    });
    const file = new File(['hello'], 'sample.txt', { type: 'text/plain' });

    const response = await POST(buildRequestWithFile(file));
    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        docId: 'doc-blocked',
        status: 'blocked',
        storagePath: 'raw/doc-blocked/sample.txt',
        curator: expect.objectContaining({
          aiUsePolicy: 'blocked',
        }),
      })
    );
    expect(body).not.toHaveProperty('masker');
    expect(body).not.toHaveProperty('aiSafeStoragePath');
  });

  it('returns ai_safe success response shape with masker and aiSafeStoragePath', async () => {
    orchestrateUploadProcessingMock.mockResolvedValue({
      kind: 'ai_safe',
      docId: 'doc-ai-safe',
      storagePath: 'raw/doc-ai-safe/sample.txt',
      aiSafeStoragePath: 'masked/doc-ai-safe/sample.txt',
      curator: {
        documentType: 'メモ',
        businessDomain: '顧客対応',
        sensitivity: 'Confidential',
        freshness: 'current',
        isAuthoritativeCandidate: true,
        aiUsePolicy: 'requires_masking',
        rationale: 'masking',
      },
      curatorCompletedAt: new Date('2026-05-08T02:00:00.000Z'),
      masker: {
        decision: 'ai_safe_ready',
        provider: 'simple-rule',
        maskedSpansCount: 2,
        ruleHits: { email: 1, phone_like: 1 },
        residualRisk: { detected: false, reasons: ['ok'] },
        rationale: 'safe',
        recommendedSensitivity: 'Confidential',
        completedAt: new Date('2026-05-08T02:00:01.000Z'),
        modelId: 'test-model',
      },
    });
    const file = new File(['hello'], 'sample.txt', { type: 'text/plain' });

    const response = await POST(buildRequestWithFile(file));
    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        docId: 'doc-ai-safe',
        status: 'ai_safe',
        storagePath: 'raw/doc-ai-safe/sample.txt',
        aiSafeStoragePath: 'masked/doc-ai-safe/sample.txt',
        masker: expect.objectContaining({
          decision: 'ai_safe_ready',
          provider: 'simple-rule',
          recommendedSensitivity: 'Confidential',
        }),
      })
    );
  });

  it('returns restricted success response shape with masker and no aiSafeStoragePath', async () => {
    orchestrateUploadProcessingMock.mockResolvedValue({
      kind: 'restricted',
      docId: 'doc-restricted',
      storagePath: 'raw/doc-restricted/sample.txt',
      curator: {
        documentType: '契約書',
        businessDomain: '顧客対応',
        sensitivity: 'Confidential',
        freshness: 'current',
        isAuthoritativeCandidate: true,
        aiUsePolicy: 'requires_masking',
        rationale: 'masking',
      },
      curatorCompletedAt: new Date('2026-05-08T03:00:00.000Z'),
      masker: {
        decision: 'restricted_promoted',
        provider: 'simple-rule',
        maskedSpansCount: 3,
        ruleHits: { custom: 3 },
        residualRisk: { detected: true, reasons: ['still identifiable'] },
        rationale: 'restricted',
        recommendedSensitivity: 'Restricted',
        completedAt: new Date('2026-05-08T03:00:01.000Z'),
        modelId: 'test-model',
      },
      sensitivityReason: 'risk remains',
      originalCuratorSensitivity: 'Confidential',
    });
    const file = new File(['hello'], 'sample.txt', { type: 'text/plain' });

    const response = await POST(buildRequestWithFile(file));
    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        docId: 'doc-restricted',
        status: 'restricted',
        storagePath: 'raw/doc-restricted/sample.txt',
        sensitivityReason: 'risk remains',
        originalCuratorSensitivity: 'Confidential',
        masker: expect.objectContaining({
          decision: 'restricted_promoted',
          recommendedSensitivity: 'Restricted',
        }),
      })
    );
    expect(body).not.toHaveProperty('aiSafeStoragePath');
  });

  it('returns 400 when multipart parsing fails', async () => {
    const response = await POST(
      {
        formData: async () => {
          throw new Error('bad multipart');
        },
      } as unknown as Request
    );

    expect(response.status).toBe(400);
    await expect(parseJson(response)).resolves.toEqual(
      expect.objectContaining({
        error: 'multipart フォームを解析できませんでした。',
      })
    );
  });

  it('returns 400 when file field count is not exactly one', async () => {
    const formData = new FormData();
    const response = await POST(
      new Request('http://localhost/api/documents', {
        method: 'POST',
        body: formData,
      })
    );

    expect(response.status).toBe(400);
    await expect(parseJson(response)).resolves.toEqual(
      expect.objectContaining({
        error: 'file フィールドにはファイルを正確に1つ指定してください。',
      })
    );
  });

  it('returns 400 when file is empty', async () => {
    const file = new File([], 'empty.txt', { type: 'text/plain' });

    const response = await POST(buildRequestWithFile(file));

    expect(response.status).toBe(400);
    await expect(parseJson(response)).resolves.toEqual(
      expect.objectContaining({
        error: '空のファイルはアップロードできません。',
      })
    );
    expect(orchestrateUploadProcessingMock).not.toHaveBeenCalled();
  });

  it('returns 413 when file size exceeds 5MB', async () => {
    const oversized = new File(
      [Buffer.alloc(5 * 1024 * 1024 + 1)],
      'large.txt',
      { type: 'text/plain' }
    );

    const response = await POST(buildRequestWithFile(oversized));

    expect(response.status).toBe(413);
    await expect(parseJson(response)).resolves.toEqual(
      expect.objectContaining({
        error: 'ファイルサイズは 5 MB 以下にしてください。',
      })
    );
  });

  it('accepts file size at 5MB limit', async () => {
    const atLimit = new File([Buffer.alloc(5 * 1024 * 1024)], 'limit.txt', {
      type: 'text/plain',
    });

    const response = await POST(buildRequestWithFile(atLimit));

    expect(response.status).toBe(200);
    expect(orchestrateUploadProcessingMock).toHaveBeenCalledTimes(1);
  });

  it('returns 415 when extension is unsupported', async () => {
    const file = new File(['hello'], 'sample.pdf', { type: 'application/pdf' });

    const response = await POST(buildRequestWithFile(file));

    expect(response.status).toBe(415);
    await expect(parseJson(response)).resolves.toEqual(
      expect.objectContaining({
        error: '対応している拡張子は .txt / .md / .csv / .xlsx のみです。',
      })
    );
  });

  it('returns 415 when MIME type is unsupported', async () => {
    const file = new File(['hello'], 'sample.txt', { type: 'image/png' });

    const response = await POST(buildRequestWithFile(file));

    expect(response.status).toBe(415);
    await expect(parseJson(response)).resolves.toEqual(
      expect.objectContaining({
        error: 'このファイルの Content-Type は受け付けていません。',
      })
    );
  });

  it('returns 400 when payload is not valid UTF-8', async () => {
    const invalidUtf8 = new File(
      [new Uint8Array([0xff, 0xfe, 0xfd])],
      'bad.txt',
      { type: 'text/plain' }
    );

    const response = await POST(buildRequestWithFile(invalidUtf8));

    expect(response.status).toBe(400);
    await expect(parseJson(response)).resolves.toEqual(
      expect.objectContaining({
        error: 'UTF-8 として解釈できないバイト列です。',
      })
    );
  });

  it('returns 503 when bucket configuration is missing', async () => {
    getKnowledgeHubBucketNameMock.mockImplementation(() => {
      throw new Error('missing bucket');
    });
    const file = new File(['hello'], 'sample.txt', { type: 'text/plain' });

    const response = await POST(buildRequestWithFile(file));

    expect(response.status).toBe(503);
    await expect(parseJson(response)).resolves.toEqual(
      expect.objectContaining({
        error: 'サーバー設定 (KNOWLEDGE_HUB_BUCKET) が未完了です。',
      })
    );
  });

  it('returns 502 for unexpected orchestrator error', async () => {
    orchestrateUploadProcessingMock.mockRejectedValue(new Error('infra failure'));
    const file = new File(['hello'], 'sample.txt', { type: 'text/plain' });

    const response = await POST(buildRequestWithFile(file));

    expect(response.status).toBe(502);
    await expect(parseJson(response)).resolves.toEqual(
      expect.objectContaining({
        error: 'アップロード処理に失敗しました。',
      })
    );
  });

  it('returns 500 with docId for curator phase failure', async () => {
    orchestrateUploadProcessingMock.mockRejectedValue(
      new curatorPhaseErrorClass('doc-curator', new Error('curator failure'))
    );
    const file = new File(['hello'], 'sample.txt', { type: 'text/plain' });

    const response = await POST(buildRequestWithFile(file));

    expect(response.status).toBe(500);
    await expect(parseJson(response)).resolves.toEqual(
      expect.objectContaining({
        error: '分類処理に失敗しました。設定またはログを確認してください。',
        docId: 'doc-curator',
      })
    );
  });

  it('returns 500 with docId for masker phase failure', async () => {
    orchestrateUploadProcessingMock.mockRejectedValue(
      new maskerPhaseErrorClass('doc-masker', new Error('masker failure'))
    );
    const file = new File(['hello'], 'sample.txt', { type: 'text/plain' });

    const response = await POST(buildRequestWithFile(file));

    expect(response.status).toBe(500);
    await expect(parseJson(response)).resolves.toEqual(
      expect.objectContaining({
        error: 'マスク処理に失敗しました。設定またはログを確認してください。',
        docId: 'doc-masker',
      })
    );
  });
});

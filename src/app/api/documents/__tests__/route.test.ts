import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';

const {
  orchestrateUploadProcessingMock,
  replaceChunksForDocMock,
  getKnowledgeHubBucketNameMock,
  extractPdfFromBufferMock,
  extractSlidePdfFromBufferMock,
  extractScanPdfFromBufferMock,
  getFeatureFlagMock,
  isFeatureEnabledMock,
  getFirestoreClientMock,
  curatorPhaseErrorClass,
  maskerPhaseErrorClass,
  recordAuditEventMock,
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
    replaceChunksForDocMock: vi.fn(),
    getKnowledgeHubBucketNameMock: vi.fn(),
    extractPdfFromBufferMock: vi.fn(),
    extractSlidePdfFromBufferMock: vi.fn(),
    extractScanPdfFromBufferMock: vi.fn(),
    getFeatureFlagMock: vi.fn(),
    isFeatureEnabledMock: vi.fn(),
    getFirestoreClientMock: vi.fn(),
    curatorPhaseErrorClass: CuratorPhaseErrorMock,
    maskerPhaseErrorClass: MaskerPhaseErrorMock,
    recordAuditEventMock: vi.fn().mockResolvedValue('audit-event-1'),
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

vi.mock('../../../../lib/chunkRegenerator', () => ({
  replaceChunksForDoc: replaceChunksForDocMock,
}));

vi.mock('../../../../lib/extractors/pdfDocumentExtractor', () => ({
  extractPdfFromBuffer: extractPdfFromBufferMock,
}));

vi.mock('../../../../lib/extractors/slidePdfDocumentExtractor', () => ({
  extractSlidePdfFromBuffer: extractSlidePdfFromBufferMock,
}));

vi.mock('../../../../lib/extractors/scanPdfDocumentExtractor', () => ({
  extractScanPdfFromBuffer: extractScanPdfFromBufferMock,
}));

vi.mock('../../../../lib/featureFlags', () => ({
  getFeatureFlag: getFeatureFlagMock,
  isFeatureEnabled: isFeatureEnabledMock,
}));

vi.mock('../../../../lib/firestore', () => ({
  getFirestoreClient: getFirestoreClientMock,
}));

vi.mock('../../../../lib/audit/auditEvent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/audit/auditEvent')>();
  return {
    ...actual,
    recordAuditEvent: recordAuditEventMock,
  };
});

import { POST } from '../route';

async function createWorkbookBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('顧客一覧').addRows([
    ['顧客名', '数量'],
    ['Acme', 10],
  ]);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function toBlobPart(buffer: Buffer): BlobPart {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  const view = new Uint8Array(arrayBuffer);
  view.set(buffer);
  return view;
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

const minimalPdfExtraction = {
  textContent: 'PDF body text',
  documentIr: {
    schemaVersion: 1,
    source: {
      fileName: 'sample.pdf',
      mediaType: 'application/pdf',
      sourceKind: 'upload',
      sourceSubtype: 'official-doc-pdf',
    },
    pages: [
      {
        pageNumber: 1,
        blocks: [{ blockId: 'p1-b0', kind: 'paragraph', text: 'PDF body text' }],
      },
    ],
  },
};

const minimalSlidePdfExtraction = {
  textContent: 'Slide PDF body text',
  documentIr: {
    schemaVersion: 1,
    source: {
      fileName: 'sample.pdf',
      mediaType: 'application/pdf',
      sourceKind: 'upload',
      sourceSubtype: 'slide-pdf',
    },
    pages: [
      {
        pageNumber: 1,
        blocks: [
          {
            blockId: 's1-b1',
            kind: 'paragraph',
            text: 'Slide PDF body text',
          },
        ],
      },
    ],
  },
  conversion: {
    converterId: 'gemini-direct-read' as const,
    calledVertex: true as const,
    model: 'gemini-2.5-flash',
    region: 'asia-northeast1',
  },
};

const minimalScanPdfExtraction = {
  textContent: 'Scan PDF OCR body text',
  documentIr: {
    schemaVersion: 1,
    source: {
      fileName: 'sample.pdf',
      mediaType: 'application/pdf',
      sourceKind: 'upload',
      sourceSubtype: 'scan-pdf',
    },
    pages: [
      {
        pageNumber: 1,
        blocks: [
          {
            blockId: 'p1-ocr1',
            kind: 'paragraph',
            text: 'Scan PDF OCR body text',
          },
        ],
      },
    ],
  },
  conversion: {
    converterId: 'gemini-vertex-ocr' as const,
    calledVertex: true as const,
    model: 'gemini-2.5-flash',
    region: 'asia-northeast1',
    piiFindings: [
      {
        pageNumber: 1,
        category: 'person_name' as const,
        evidenceSnippet: '山田太郎',
        maskability: 'maskable' as const,
        reason: 'full name visible',
      },
      {
        pageNumber: 1,
        category: 'address' as const,
        evidenceSnippet: '東京都...',
        maskability: 'unmaskable' as const,
        reason: 'partial visibility',
      },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  getKnowledgeHubBucketNameMock.mockReturnValue('bucket-1');
  getFirestoreClientMock.mockReturnValue({ collection: vi.fn() });
  getFeatureFlagMock.mockImplementation(async (_db, flagId: string) => ({
    flagId,
    defaultEnabled: flagId === 'pdf-conversion-subtype-1',
    enabledTenants: flagId === 'pdf-conversion-subtype-1' ? ['m-grow-ai.com'] : [],
  }));
  isFeatureEnabledMock.mockImplementation((flag) => flag?.defaultEnabled ?? false);
  extractPdfFromBufferMock.mockResolvedValue(minimalPdfExtraction);
  extractSlidePdfFromBufferMock.mockResolvedValue(minimalSlidePdfExtraction);
  extractScanPdfFromBufferMock.mockResolvedValue(minimalScanPdfExtraction);
  replaceChunksForDocMock.mockResolvedValue(undefined);
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
        kind: 'created',
        curator: expect.objectContaining({
          aiUsePolicy: 'direct',
          modelId: 'test-model',
        }),
      })
    );
    expect(body).not.toHaveProperty('masker');
    expect(body).not.toHaveProperty('aiSafeStoragePath');
    expect(replaceChunksForDocMock).toHaveBeenCalledWith('doc-1');
    expect(
      orchestrateUploadProcessingMock.mock.invocationCallOrder[0]
    ).toBeLessThan(replaceChunksForDocMock.mock.invocationCallOrder[0]);
    expect(
      replaceChunksForDocMock.mock.invocationCallOrder[0]
    ).toBeLessThan(recordAuditEventMock.mock.invocationCallOrder[0]);
    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'document.import',
        result: 'success',
        target: {
          docId: 'doc-1',
          fileName: 'sample.txt',
          sourceKind: 'upload',
          sensitivity: 'Internal',
        },
      })
    );
  });

  it('generates chunks after .csv upload and returns curated document', async () => {
    const file = new File(['name,amount\nAcme,10\n'], 'sample.csv', {
      type: 'text/csv',
    });

    const response = await POST(buildRequestWithFile(file));
    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        docId: 'doc-1',
        status: 'curated',
        kind: 'created',
      })
    );
    expect(replaceChunksForDocMock).toHaveBeenCalledWith('doc-1');
    expect(
      orchestrateUploadProcessingMock.mock.invocationCallOrder[0]
    ).toBeLessThan(replaceChunksForDocMock.mock.invocationCallOrder[0]);
  });

  it('generates chunks after .txt upload', async () => {
    const file = new File(['plain memo'], 'memo.txt', { type: 'text/plain' });

    const response = await POST(buildRequestWithFile(file));

    expect(response.status).toBe(200);
    expect(replaceChunksForDocMock).toHaveBeenCalledWith('doc-1');
  });

  it('generates chunks after .md upload', async () => {
    const file = new File(['# Runbook\n\n- check stock'], 'runbook.md', {
      type: 'text/markdown',
    });

    const response = await POST(buildRequestWithFile(file));

    expect(response.status).toBe(200);
    expect(replaceChunksForDocMock).toHaveBeenCalledWith('doc-1');
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
        kind: 'created',
      })
    );
  });

  it('accepts .xlsx upload and passes raw bytes plus normalized markdown content', async () => {
    const workbookBuffer = await createWorkbookBuffer();
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
    expect(replaceChunksForDocMock).toHaveBeenCalledWith('doc-1');
  });

  it('fills .xlsx contentType from extension when MIME type is empty', async () => {
    const payload = await createWorkbookBuffer();
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
    const file = new File([toBlobPart(await createWorkbookBuffer())], 'sales.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const response = await POST(buildRequestWithFile(file));

    expect(response.status).toBe(200);
    expect(orchestrateUploadProcessingMock).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for invalid .xlsx bytes before orchestration', async () => {
    const file = new File([new Uint8Array([0xff, 0xfe, 0xfd])], 'broken.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const response = await POST(buildRequestWithFile(file));

    expect(response.status).toBe(400);
    await expect(parseJson(response)).resolves.toEqual(
      expect.objectContaining({
        error: '.xlsx ファイルを解析できませんでした。',
      })
    );
    expect(orchestrateUploadProcessingMock).not.toHaveBeenCalled();
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
        kind: 'created',
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
        kind: 'created',
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
        kind: 'created',
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
    const file = new File(['hello'], 'sample.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    const response = await POST(buildRequestWithFile(file));

    expect(response.status).toBe(415);
    await expect(parseJson(response)).resolves.toEqual(
      expect.objectContaining({
        error: '対応している拡張子は .txt / .md / .csv / .xlsx / .pdf のみです。',
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
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('returns 500 chunk_generation_failed when chunk generation fails', async () => {
    replaceChunksForDocMock.mockRejectedValue(new Error('chunk replace failed'));
    const file = new File(['hello'], 'sample.txt', { type: 'text/plain' });

    const response = await POST(buildRequestWithFile(file));

    expect(response.status).toBe(500);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'チャンク生成に失敗しました。設定またはログを確認してください。',
      docId: 'doc-1',
    });
    expect(orchestrateUploadProcessingMock).toHaveBeenCalledTimes(1);
    expect(replaceChunksForDocMock).toHaveBeenCalledWith('doc-1');
    expect(recordAuditEventMock).not.toHaveBeenCalled();
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
    expect(recordAuditEventMock).not.toHaveBeenCalled();
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
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  describe('PDF upload (Phase 3-H-2 M1)', () => {
    function pdfFile(): File {
      return new File(['%PDF-1.4 fake'], 'sample.pdf', {
        type: 'application/pdf',
      });
    }

    it('returns 403 when feature flag is disabled and does not call orchestrator', async () => {
      isFeatureEnabledMock.mockReturnValue(false);

      const response = await POST(buildRequestWithFile(pdfFile()));

      expect(response.status).toBe(403);
      await expect(parseJson(response)).resolves.toEqual(
        expect.objectContaining({
          error: expect.stringContaining('ベータ機能'),
        })
      );
      expect(extractPdfFromBufferMock).not.toHaveBeenCalled();
      expect(extractSlidePdfFromBufferMock).not.toHaveBeenCalled();
      expect(extractScanPdfFromBufferMock).not.toHaveBeenCalled();
      expect(orchestrateUploadProcessingMock).not.toHaveBeenCalled();
    });

    it('extracts official-doc PDF and orchestrates with extractor subtype without replaceChunksForDoc', async () => {
      const response = await POST(buildRequestWithFile(pdfFile()));

      expect(response.status).toBe(200);
      expect(extractPdfFromBufferMock).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'sample.pdf',
          sourceSubtype: 'official-doc-pdf',
        })
      );
      expect(orchestrateUploadProcessingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: 'sample.pdf',
          contentType: 'application/pdf',
          content: 'PDF body text',
          documentIr: minimalPdfExtraction.documentIr,
          sourceSubtype: 'official-doc-pdf',
          conversion: { converterId: 'pdf-parse' },
        })
      );
      expect(extractSlidePdfFromBufferMock).not.toHaveBeenCalled();
      expect(replaceChunksForDocMock).not.toHaveBeenCalled();
    });

    it('returns 403 when both pdf-conversion-subtype-1 and subtype-2 flags are enabled', async () => {
      isFeatureEnabledMock.mockImplementation(
        (flag) =>
          flag?.flagId === 'pdf-conversion-subtype-1' ||
          flag?.flagId === 'pdf-conversion-subtype-2'
      );

      const response = await POST(buildRequestWithFile(pdfFile()));

      expect(response.status).toBe(403);
      await expect(parseJson(response)).resolves.toEqual(
        expect.objectContaining({
          error: expect.stringContaining('feature flag が競合'),
        })
      );
      expect(extractPdfFromBufferMock).not.toHaveBeenCalled();
      expect(extractSlidePdfFromBufferMock).not.toHaveBeenCalled();
      expect(extractScanPdfFromBufferMock).not.toHaveBeenCalled();
      expect(orchestrateUploadProcessingMock).not.toHaveBeenCalled();
    });

    it('uses slide-pdf extractor and forwards slide subtype + DocumentIR when subtype-2 is enabled', async () => {
      isFeatureEnabledMock.mockImplementation(
        (flag) => flag?.flagId === 'pdf-conversion-subtype-2'
      );

      const response = await POST(buildRequestWithFile(pdfFile()));

      expect(response.status).toBe(200);
      expect(extractSlidePdfFromBufferMock).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'sample.pdf',
        })
      );
      expect(extractPdfFromBufferMock).not.toHaveBeenCalled();
      expect(extractScanPdfFromBufferMock).not.toHaveBeenCalled();
      expect(orchestrateUploadProcessingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: 'sample.pdf',
          contentType: 'application/pdf',
          content: 'Slide PDF body text',
          documentIr: minimalSlidePdfExtraction.documentIr,
          sourceSubtype: 'slide-pdf',
          conversion: {
            converterId: 'gemini-direct-read',
            inferenceDestination: {
              vendor: 'vertex',
              region: 'asia-northeast1',
              model: 'gemini-2.5-flash',
            },
          },
        })
      );
      expect(replaceChunksForDocMock).not.toHaveBeenCalled();
    });

    it('uses scan-pdf extractor and forwards scan subtype + Vertex inferenceDestination when subtype-3 is enabled', async () => {
      isFeatureEnabledMock.mockImplementation(
        (flag) => flag?.flagId === 'pdf-conversion-subtype-3'
      );

      const response = await POST(buildRequestWithFile(pdfFile()));

      expect(response.status).toBe(200);
      expect(extractScanPdfFromBufferMock).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'sample.pdf',
        })
      );
      expect(extractPdfFromBufferMock).not.toHaveBeenCalled();
      expect(extractSlidePdfFromBufferMock).not.toHaveBeenCalled();
      expect(orchestrateUploadProcessingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: 'sample.pdf',
          contentType: 'application/pdf',
          content: 'Scan PDF OCR body text',
          documentIr: minimalScanPdfExtraction.documentIr,
          sourceSubtype: 'scan-pdf',
          conversion: expect.objectContaining({
            converterId: 'gemini-vertex-ocr',
            inferenceDestination: {
              vendor: 'vertex',
              region: 'asia-northeast1',
              model: 'gemini-2.5-flash',
            },
          }),
        })
      );
      expect(replaceChunksForDocMock).not.toHaveBeenCalled();
    });

    it('returns 400 when scan-pdf extraction fails and does not call orchestrator', async () => {
      isFeatureEnabledMock.mockImplementation(
        (flag) => flag?.flagId === 'pdf-conversion-subtype-3'
      );
      extractScanPdfFromBufferMock.mockRejectedValue(
        new Error('Gemini OCR timeout')
      );

      const response = await POST(buildRequestWithFile(pdfFile()));

      expect(response.status).toBe(400);
      await expect(parseJson(response)).resolves.toEqual(
        expect.objectContaining({
          error: 'PDF ファイルを解析できませんでした。',
        })
      );
      expect(extractScanPdfFromBufferMock).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'sample.pdf',
        })
      );
      expect(extractPdfFromBufferMock).not.toHaveBeenCalled();
      expect(extractSlidePdfFromBufferMock).not.toHaveBeenCalled();
      expect(orchestrateUploadProcessingMock).not.toHaveBeenCalled();
    });

    it('returns 400 on scan-pdf OCR fail-closed pre-flight and does not proceed to document/chunk/document.convert audit paths', async () => {
      isFeatureEnabledMock.mockImplementation(
        (flag) => flag?.flagId === 'pdf-conversion-subtype-3'
      );
      extractScanPdfFromBufferMock.mockRejectedValue(
        new Error('scan-pdf ocr fail-closed: gemini-output-empty')
      );

      const response = await POST(buildRequestWithFile(pdfFile()));

      expect(response.status).toBe(400);
      await expect(parseJson(response)).resolves.toEqual(
        expect.objectContaining({
          error: 'PDF ファイルを解析できませんでした。',
        })
      );
      expect(extractScanPdfFromBufferMock).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'sample.pdf',
        })
      );
      expect(extractPdfFromBufferMock).not.toHaveBeenCalled();
      expect(extractSlidePdfFromBufferMock).not.toHaveBeenCalled();
      expect(orchestrateUploadProcessingMock).not.toHaveBeenCalled();
      expect(replaceChunksForDocMock).not.toHaveBeenCalled();
      expect(recordAuditEventMock).not.toHaveBeenCalled();
    });

    it('returns 403 when both subtype-1 and subtype-3 flags are enabled (3-way mutex)', async () => {
      isFeatureEnabledMock.mockImplementation(
        (flag) =>
          flag?.flagId === 'pdf-conversion-subtype-1' ||
          flag?.flagId === 'pdf-conversion-subtype-3'
      );

      const response = await POST(buildRequestWithFile(pdfFile()));

      expect(response.status).toBe(403);
      await expect(parseJson(response)).resolves.toEqual(
        expect.objectContaining({
          error: expect.stringContaining('feature flag が競合'),
        })
      );
      expect(extractPdfFromBufferMock).not.toHaveBeenCalled();
      expect(extractSlidePdfFromBufferMock).not.toHaveBeenCalled();
      expect(extractScanPdfFromBufferMock).not.toHaveBeenCalled();
      expect(orchestrateUploadProcessingMock).not.toHaveBeenCalled();
    });

    it('returns 403 when both subtype-2 and subtype-3 flags are enabled (3-way mutex)', async () => {
      isFeatureEnabledMock.mockImplementation(
        (flag) =>
          flag?.flagId === 'pdf-conversion-subtype-2' ||
          flag?.flagId === 'pdf-conversion-subtype-3'
      );

      const response = await POST(buildRequestWithFile(pdfFile()));

      expect(response.status).toBe(403);
      await expect(parseJson(response)).resolves.toEqual(
        expect.objectContaining({
          error: expect.stringContaining('feature flag が競合'),
        })
      );
      expect(extractPdfFromBufferMock).not.toHaveBeenCalled();
      expect(extractSlidePdfFromBufferMock).not.toHaveBeenCalled();
      expect(extractScanPdfFromBufferMock).not.toHaveBeenCalled();
      expect(orchestrateUploadProcessingMock).not.toHaveBeenCalled();
    });

    it('returns 403 when subtype-1, subtype-2, and subtype-3 flags are all enabled (3-way mutex)', async () => {
      isFeatureEnabledMock.mockReturnValue(true);

      const response = await POST(buildRequestWithFile(pdfFile()));

      expect(response.status).toBe(403);
      await expect(parseJson(response)).resolves.toEqual(
        expect.objectContaining({
          error: expect.stringContaining('feature flag が競合'),
        })
      );
      expect(extractPdfFromBufferMock).not.toHaveBeenCalled();
      expect(extractSlidePdfFromBufferMock).not.toHaveBeenCalled();
      expect(extractScanPdfFromBufferMock).not.toHaveBeenCalled();
      expect(orchestrateUploadProcessingMock).not.toHaveBeenCalled();
    });

    it('returns 400 when PDF parse fails and does not call orchestrator', async () => {
      extractPdfFromBufferMock.mockRejectedValue(new Error('parse failed'));

      const response = await POST(buildRequestWithFile(pdfFile()));

      expect(response.status).toBe(400);
      await expect(parseJson(response)).resolves.toEqual(
        expect.objectContaining({
          error: 'PDF ファイルを解析できませんでした。',
        })
      );
      expect(orchestrateUploadProcessingMock).not.toHaveBeenCalled();
    });

    it('returns curated success with maskingPending for requires_masking PDF', async () => {
      orchestrateUploadProcessingMock.mockResolvedValue({
        kind: 'curated',
        docId: 'doc-pdf-mask',
        storagePath: 'raw/doc-pdf-mask/sample.pdf',
        curator: {
          documentType: 'メモ',
          businessDomain: '顧客対応',
          sensitivity: 'Confidential',
          freshness: 'current',
          isAuthoritativeCandidate: true,
          aiUsePolicy: 'requires_masking',
          rationale: 'masking required',
        },
        curatorCompletedAt: new Date('2026-05-08T00:00:00.000Z'),
        maskingPending: true,
      });

      const response = await POST(buildRequestWithFile(pdfFile()));

      expect(response.status).toBe(200);
      const body = await parseJson(response);
      expect(body).toEqual(
        expect.objectContaining({
          status: 'curated',
          maskingPending: true,
        })
      );
      expect(body).not.toHaveProperty('masker');
    });
  });
});

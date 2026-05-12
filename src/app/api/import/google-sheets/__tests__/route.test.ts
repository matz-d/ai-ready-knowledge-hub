import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  orchestrateImportedSnapshotProcessingMock,
  getServiceAccountEmailMock,
  invalidGoogleSheetsInputErrorClass,
  googleSheetShareErrorClass,
  unsupportedMimeTypeErrorClass,
  driveExportErrorClass,
  importTooLargeErrorClass,
  gcsUploadErrorClass,
  curatorPhaseErrorClass,
  maskerPhaseErrorClass,
} = vi.hoisted(() => {
  class InvalidGoogleSheetsInputErrorMock extends Error {
    constructor(message = 'invalid sheets input') {
      super(message);
      this.name = 'InvalidGoogleSheetsInputError';
    }
  }

  class GoogleSheetShareErrorMock extends Error {
    constructor(message = 'share required') {
      super(message);
      this.name = 'GoogleSheetShareError';
    }
  }

  class UnsupportedMimeTypeErrorMock extends Error {
    mimeType?: string;
    constructor(mimeType?: string) {
      super(`unsupported mime: ${mimeType ?? 'unknown'}`);
      this.name = 'UnsupportedMimeTypeError';
      this.mimeType = mimeType;
    }
  }

  class DriveExportErrorMock extends Error {
    constructor(message = 'drive export failed') {
      super(message);
      this.name = 'DriveExportError';
    }
  }

  class ImportTooLargeErrorMock extends Error {
    constructor(message = 'import too large') {
      super(message);
      this.name = 'ImportTooLargeError';
    }
  }

  class GcsUploadErrorMock extends Error {
    constructor(cause: unknown) {
      super(cause instanceof Error ? cause.message : String(cause));
      this.name = 'GcsUploadError';
    }
  }

  class CuratorPhaseErrorMock extends Error {
    docId: string;
    constructor(docId: string, cause: unknown) {
      super(cause instanceof Error ? cause.message : String(cause));
      this.name = 'CuratorPhaseError';
      this.docId = docId;
    }
  }

  class MaskerPhaseErrorMock extends Error {
    docId: string;
    constructor(docId: string, cause: unknown) {
      super(cause instanceof Error ? cause.message : String(cause));
      this.name = 'MaskerPhaseError';
      this.docId = docId;
    }
  }

  return {
    orchestrateImportedSnapshotProcessingMock: vi.fn(),
    getServiceAccountEmailMock: vi.fn(),
    invalidGoogleSheetsInputErrorClass: InvalidGoogleSheetsInputErrorMock,
    googleSheetShareErrorClass: GoogleSheetShareErrorMock,
    unsupportedMimeTypeErrorClass: UnsupportedMimeTypeErrorMock,
    driveExportErrorClass: DriveExportErrorMock,
    importTooLargeErrorClass: ImportTooLargeErrorMock,
    gcsUploadErrorClass: GcsUploadErrorMock,
    curatorPhaseErrorClass: CuratorPhaseErrorMock,
    maskerPhaseErrorClass: MaskerPhaseErrorMock,
  };
});

vi.mock('../../../../../agents/_shared/genkitClient', () => ({
  modelId: 'test-model',
}));

vi.mock('../../../../../lib/importedSnapshotOrchestrator', () => ({
  orchestrateImportedSnapshotProcessing: orchestrateImportedSnapshotProcessingMock,
  ImportTooLargeError: importTooLargeErrorClass,
  GcsUploadError: gcsUploadErrorClass,
}));

vi.mock('../../../../../lib/googleWorkspaceClient', () => ({
  getServiceAccountEmail: getServiceAccountEmailMock,
}));

vi.mock('../../../../../lib/googleSheetsSnapshotImporter', () => ({
  InvalidGoogleSheetsInputError: invalidGoogleSheetsInputErrorClass,
  GoogleSheetShareError: googleSheetShareErrorClass,
  UnsupportedMimeTypeError: unsupportedMimeTypeErrorClass,
  DriveExportError: driveExportErrorClass,
}));

vi.mock('../../../../../lib/uploadOrchestrator', () => ({
  CuratorPhaseError: curatorPhaseErrorClass,
  MaskerPhaseError: maskerPhaseErrorClass,
}));

import { POST } from '../route';

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/import/google-sheets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function buildMalformedJsonRequest(): Request {
  return new Request('http://localhost/api/import/google-sheets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  getServiceAccountEmailMock.mockResolvedValue(
    'importer-sa@example.iam.gserviceaccount.com'
  );
  orchestrateImportedSnapshotProcessingMock.mockResolvedValue({
    kind: 'curated',
    docId: 'doc-1',
    storagePath: 'raw/doc-1/Revenue.xlsx',
    fileName: 'Revenue.xlsx',
    ingestKind: 'created',
    curator: {
      documentType: '料金表',
      businessDomain: '営業',
      sensitivity: 'Internal',
      freshness: 'current',
      isAuthoritativeCandidate: true,
      aiUsePolicy: 'direct',
      rationale: 'direct',
    },
    curatorCompletedAt: new Date('2026-05-12T00:00:00.000Z'),
    snapshotByteSize: 2048,
  });
});

describe('POST /api/import/google-sheets', () => {
  it('returns documents-route-compatible success body', async () => {
    const response = await POST(
      buildRequest({
        urlOrFileId: 'sheet-file-id-1234567890123',
        displayName: 'Revenue.xlsx',
      })
    );
    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        docId: 'doc-1',
        fileName: 'Revenue.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        byteSize: 2048,
        storagePath: 'raw/doc-1/Revenue.xlsx',
        status: 'curated',
        curator: expect.objectContaining({
          aiUsePolicy: 'direct',
          modelId: 'test-model',
        }),
        kind: 'created',
      })
    );
    expect(body).not.toHaveProperty('masker');
    expect(body).not.toHaveProperty('skipped');
  });

  it('returns kind overwritten and skipped when orchestrator short-circuits unchanged bytes', async () => {
    orchestrateImportedSnapshotProcessingMock.mockResolvedValue({
      kind: 'curated',
      docId: 'doc-skip',
      storagePath: 'raw/doc-skip/Revenue.xlsx',
      fileName: 'Revenue.xlsx',
      ingestKind: 'overwritten',
      skipped: true,
      curator: {
        documentType: '料金表',
        businessDomain: '営業',
        sensitivity: 'Internal',
        freshness: 'current',
        isAuthoritativeCandidate: true,
        aiUsePolicy: 'direct',
        rationale: 'direct',
      },
      curatorCompletedAt: new Date('2026-05-12T00:00:00.000Z'),
      snapshotByteSize: 2048,
    });

    const response = await POST(
      buildRequest({ urlOrFileId: 'sheet-file-id-1234567890123' })
    );
    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(body.kind).toBe('overwritten');
    expect(body.skipped).toBe(true);
  });

  it('returns the persisted imported fileName even when displayName is provided', async () => {
    orchestrateImportedSnapshotProcessingMock.mockResolvedValue({
      kind: 'curated',
      docId: 'doc-2',
      storagePath: 'raw/doc-2/Drive_Source.xlsx',
      fileName: 'Drive Source.xlsx',
      ingestKind: 'created',
      curator: {
        documentType: '料金表',
        businessDomain: '営業',
        sensitivity: 'Internal',
        freshness: 'current',
        isAuthoritativeCandidate: true,
        aiUsePolicy: 'direct',
        rationale: 'direct',
      },
      curatorCompletedAt: new Date('2026-05-12T00:00:00.000Z'),
      snapshotByteSize: 4096,
    });

    const response = await POST(
      buildRequest({
        urlOrFileId: 'sheet-file-id-1234567890123',
        displayName: 'User Supplied Name.xlsx',
      })
    );
    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        docId: 'doc-2',
        fileName: 'Drive Source.xlsx',
        storagePath: 'raw/doc-2/Drive_Source.xlsx',
        byteSize: 4096,
        kind: 'created',
      })
    );
  });

  it('returns 400 invalid_input with issues when body validation fails', async () => {
    const response = await POST(buildRequest({ displayName: 'Revenue.xlsx' }));
    const body = await parseJson(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid_input');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('returns 400 invalid_json when request body is malformed JSON', async () => {
    const response = await POST(buildMalformedJsonRequest());

    expect(response.status).toBe(400);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'invalid_json',
      message: 'Request body must be valid JSON',
    });
    expect(orchestrateImportedSnapshotProcessingMock).not.toHaveBeenCalled();
  });

  it('returns 400 invalid_url when orchestration throws InvalidGoogleSheetsInputError', async () => {
    orchestrateImportedSnapshotProcessingMock.mockRejectedValue(
      new invalidGoogleSheetsInputErrorClass()
    );

    const response = await POST(
      buildRequest({ urlOrFileId: '  ', displayName: 'Revenue.xlsx' })
    );

    expect(response.status).toBe(400);
    await expect(parseJson(response)).resolves.toEqual({ error: 'invalid_url' });
  });

  it('returns 400 invalid_url for InvalidGoogleSheetsInputError regardless of message text', async () => {
    orchestrateImportedSnapshotProcessingMock.mockRejectedValue(
      new invalidGoogleSheetsInputErrorClass(
        'Copy can change anytime without breaking status mapping.'
      )
    );

    const response = await POST(
      buildRequest({ urlOrFileId: 'x', displayName: 'Revenue.xlsx' })
    );

    expect(response.status).toBe(400);
    await expect(parseJson(response)).resolves.toEqual({ error: 'invalid_url' });
  });

  it('returns 403 sheet_not_shared with serviceAccountEmail', async () => {
    orchestrateImportedSnapshotProcessingMock.mockRejectedValue(
      new googleSheetShareErrorClass()
    );

    const response = await POST(
      buildRequest({ urlOrFileId: 'sheet-file-id-1234567890123' })
    );

    expect(response.status).toBe(403);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'sheet_not_shared',
      serviceAccountEmail: 'importer-sa@example.iam.gserviceaccount.com',
    });
  });

  it('returns 403 sheet_not_shared even when service account email lookup fails', async () => {
    orchestrateImportedSnapshotProcessingMock.mockRejectedValue(
      new googleSheetShareErrorClass()
    );
    getServiceAccountEmailMock.mockRejectedValue(new Error('ADC unavailable'));

    const response = await POST(
      buildRequest({ urlOrFileId: 'sheet-file-id-1234567890123' })
    );

    expect(response.status).toBe(403);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'sheet_not_shared',
    });
  });

  it('returns 404 sheet_not_found on Drive not found', async () => {
    orchestrateImportedSnapshotProcessingMock.mockRejectedValue({
      config: {
        url: 'https://www.googleapis.com/drive/v3/files/sheet-file-id-1234567890123',
      },
      response: { status: 404 },
    });

    const response = await POST(
      buildRequest({ urlOrFileId: 'sheet-file-id-1234567890123' })
    );

    expect(response.status).toBe(404);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'sheet_not_found',
    });
  });

  it('does not return sheet_not_found for non-Drive 404-like errors', async () => {
    orchestrateImportedSnapshotProcessingMock.mockRejectedValue({
      response: {
        status: 404,
        config: { url: 'https://example.com/internal/not-found' },
      },
    });

    const response = await POST(
      buildRequest({ urlOrFileId: 'sheet-file-id-1234567890123' })
    );

    expect(response.status).toBe(502);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'drive_export_failed',
    });
  });

  it('returns 415 not_a_spreadsheet on unsupported mime type', async () => {
    orchestrateImportedSnapshotProcessingMock.mockRejectedValue(
      new unsupportedMimeTypeErrorClass('application/pdf')
    );

    const response = await POST(
      buildRequest({ urlOrFileId: 'sheet-file-id-1234567890123' })
    );

    expect(response.status).toBe(415);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'not_a_spreadsheet',
    });
  });

  it('returns 502 drive_export_failed on Drive export failure', async () => {
    orchestrateImportedSnapshotProcessingMock.mockRejectedValue(
      new driveExportErrorClass()
    );

    const response = await POST(
      buildRequest({ urlOrFileId: 'sheet-file-id-1234567890123' })
    );

    expect(response.status).toBe(502);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'drive_export_failed',
    });
  });

  it('returns 502 gcs_failed on GCS upload failure', async () => {
    orchestrateImportedSnapshotProcessingMock.mockRejectedValue(
      new gcsUploadErrorClass(new Error('gcs failed'))
    );

    const response = await POST(
      buildRequest({ urlOrFileId: 'sheet-file-id-1234567890123' })
    );

    expect(response.status).toBe(502);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'gcs_failed',
    });
  });

  it('returns 413 import_too_large when exported snapshot exceeds limit', async () => {
    orchestrateImportedSnapshotProcessingMock.mockRejectedValue(
      new importTooLargeErrorClass()
    );

    const response = await POST(
      buildRequest({ urlOrFileId: 'sheet-file-id-1234567890123' })
    );

    expect(response.status).toBe(413);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'import_too_large',
    });
  });

  it('returns 500 curator_failed with docId', async () => {
    const err = new curatorPhaseErrorClass(
      'doc-curator',
      new Error('curator failed')
    );
    Object.assign(err, { status: 404 });
    orchestrateImportedSnapshotProcessingMock.mockRejectedValue(err);

    const response = await POST(
      buildRequest({ urlOrFileId: 'sheet-file-id-1234567890123' })
    );

    expect(response.status).toBe(500);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'curator_failed',
      docId: 'doc-curator',
    });
  });

  it('returns 500 masker_failed with docId', async () => {
    orchestrateImportedSnapshotProcessingMock.mockRejectedValue(
      new maskerPhaseErrorClass('doc-masker', new Error('masker failed'))
    );

    const response = await POST(
      buildRequest({ urlOrFileId: 'sheet-file-id-1234567890123' })
    );

    expect(response.status).toBe(500);
    await expect(parseJson(response)).resolves.toEqual({
      error: 'masker_failed',
      docId: 'doc-masker',
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getFirestoreClientMock, getGoogleDriveClientMock } = vi.hoisted(() => ({
  getFirestoreClientMock: vi.fn(),
  getGoogleDriveClientMock: vi.fn(),
}));

vi.mock('../../../../../lib/firestore', () => ({
  getFirestoreClient: getFirestoreClientMock,
}));

vi.mock('../../../../../lib/googleWorkspaceClient', () => ({
  getGoogleDriveClient: getGoogleDriveClientMock,
}));

import { GET } from '../route';

type FirestoreDoc = Record<string, unknown>;

const driveFilesGetMock = vi.fn();
const firestoreGetMock = vi.fn();

function buildRequest(docId?: string): Request {
  const url = new URL('http://localhost/api/workspace/freshness');
  if (docId !== undefined) {
    url.searchParams.set('docId', docId);
  }
  return new Request(url);
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function buildWorkspaceDocument(
  overrides: Partial<FirestoreDoc> = {}
): FirestoreDoc {
  return {
    schemaVersion: 2,
    fileName: 'Revenue.xlsx',
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    byteSize: 2048,
    contentSha256: 'hash-1',
    sourceKind: 'google_workspace',
    externalSource: {
      provider: 'google_drive',
      workspaceMimeType: 'application/vnd.google-apps.spreadsheet',
      fileId: 'drive-file-123',
      name: 'Revenue',
      modifiedTime: '2026-05-10T01:02:03.000Z',
      importedAt: '2026-05-10T01:03:00.000Z',
      exportedAt: '2026-05-10T01:03:01.000Z',
      exportMimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    storagePath: 'raw/doc-1/Revenue.xlsx',
    aiSafeStoragePath: null,
    status: 'curated',
    createdAt: '2026-05-10T01:03:02.000Z',
    updatedAt: '2026-05-10T01:03:03.000Z',
    documentType: '表',
    businessDomain: '料金管理',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    aiUsePolicy: 'direct',
    sensitivitySource: null,
    originalCuratorSensitivity: null,
    sensitivityReason: null,
    curator: {
      documentType: '表',
      businessDomain: '料金管理',
      sensitivity: 'Internal',
      freshness: 'current',
      isAuthoritativeCandidate: true,
      aiUsePolicy: 'direct',
      rationale: 'direct',
      completedAt: '2026-05-10T01:03:04.000Z',
      modelId: 'test-model',
    },
    curatorError: null,
    masker: null,
    maskerError: null,
    ...overrides,
  };
}

function mockFirestoreDocument(data: FirestoreDoc | null): void {
  firestoreGetMock.mockResolvedValue({
    id: 'doc-1',
    exists: data !== null,
    data: () => data,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getFirestoreClientMock.mockReturnValue({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: firestoreGetMock,
      })),
    })),
  });
  getGoogleDriveClientMock.mockReturnValue({
    files: {
      get: driveFilesGetMock,
    },
  });
  mockFirestoreDocument(buildWorkspaceDocument());
  driveFilesGetMock.mockResolvedValue({
    data: {
      modifiedTime: '2026-05-12T00:00:00.000Z',
    },
  });
});

describe('GET /api/workspace/freshness', () => {
  it('compares saved and latest Drive modifiedTime', async () => {
    const response = await GET(buildRequest('doc-1'));
    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      isStale: true,
      savedModifiedTime: '2026-05-10T01:02:03.000Z',
      latestModifiedTime: '2026-05-12T00:00:00.000Z',
    });
    expect(driveFilesGetMock).toHaveBeenCalledWith({
      fileId: 'drive-file-123',
      fields: 'modifiedTime',
      supportsAllDrives: true,
    });
  });

  it('returns non-stale when modifiedTime is unchanged', async () => {
    driveFilesGetMock.mockResolvedValue({
      data: {
        modifiedTime: '2026-05-10T01:02:03.000Z',
      },
    });

    const response = await GET(buildRequest('doc-1'));
    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      isStale: false,
      savedModifiedTime: '2026-05-10T01:02:03.000Z',
      latestModifiedTime: '2026-05-10T01:02:03.000Z',
    });
  });

  it('maps Drive 403 to drive_forbidden as a normal unknown freshness response', async () => {
    driveFilesGetMock.mockRejectedValue({ response: { status: 403 } });

    const response = await GET(buildRequest('doc-1'));
    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      isStale: false,
      savedModifiedTime: '2026-05-10T01:02:03.000Z',
      latestModifiedTime: '',
      code: 'drive_forbidden',
    });
  });

  it('maps Drive 404 to drive_not_found as a normal unknown freshness response', async () => {
    driveFilesGetMock.mockRejectedValue({ code: 404 });

    const response = await GET(buildRequest('doc-1'));
    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      isStale: false,
      savedModifiedTime: '2026-05-10T01:02:03.000Z',
      latestModifiedTime: '',
      code: 'drive_not_found',
    });
  });

  it('maps missing latest Drive modifiedTime to unknown freshness response', async () => {
    driveFilesGetMock.mockResolvedValue({ data: {} });

    const response = await GET(buildRequest('doc-1'));
    const body = await parseJson(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      isStale: false,
      savedModifiedTime: '2026-05-10T01:02:03.000Z',
      latestModifiedTime: '',
      code: 'latest_modified_time_unknown',
    });
  });

  it('requires docId', async () => {
    const response = await GET(buildRequest());
    const body = await parseJson(response);

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'doc_id_required' });
    expect(firestoreGetMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the Firestore document does not exist', async () => {
    mockFirestoreDocument(null);

    const response = await GET(buildRequest('missing-doc'));
    const body = await parseJson(response);

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'document_not_found' });
    expect(driveFilesGetMock).not.toHaveBeenCalled();
  });
});

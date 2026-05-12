import { describe, expect, it } from 'vitest';
import { FIRESTORE_DOCUMENT_SCHEMA_VERSION } from '../firestoreSchema';
import { parseFirestoreDocumentData } from '../parseFirestoreDocumentData';

const baseRawDocument = {
  id: 'doc-1',
  schemaVersion: FIRESTORE_DOCUMENT_SCHEMA_VERSION,
  fileName: 'sample.txt',
  contentType: 'text/plain',
  byteSize: 12,
  contentSha256: 'hash-1',
  sourceKind: 'upload',
  externalSource: null,
  storagePath: 'raw/doc-1/sample.txt',
  aiSafeStoragePath: null,
  status: 'uploaded',
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
  documentType: null,
  businessDomain: null,
  sensitivity: null,
  freshness: null,
  isAuthoritativeCandidate: null,
  aiUsePolicy: null,
  sensitivitySource: null,
  originalCuratorSensitivity: null,
  sensitivityReason: null,
  curator: null,
  curatorError: null,
  masker: null,
  maskerError: null,
} as const;

describe('parseFirestoreDocumentData', () => {
  it('accepts schemaVersion 2 shape with required upload sourceKind/externalSource', () => {
    const parsed = parseFirestoreDocumentData(baseRawDocument);

    expect(parsed.sourceKind).toBe('upload');
    expect(parsed.externalSource).toBeNull();
  });

  it('rejects schemaVersion 1 documents as parse error', () => {
    expect(() =>
      parseFirestoreDocumentData({
        ...baseRawDocument,
        schemaVersion: 1,
      })
    ).toThrow();
  });

  it('keeps sourceKind/externalSource as-is for the new document shape', () => {
    const nextShape = {
      ...baseRawDocument,
      sourceKind: 'google_workspace' as const,
      externalSource: {
        provider: 'google_drive' as const,
        workspaceMimeType:
          'application/vnd.google-apps.spreadsheet' as const,
        fileId: 'drive-file-1',
        name: 'Sales Dashboard',
        webViewLink: 'https://docs.google.com/spreadsheets/d/drive-file-1/edit',
        modifiedTime: '2026-05-11T11:22:33.000Z',
        importedAt: '2026-05-12T09:59:00.000Z',
        exportedAt: '2026-05-12T09:59:05.000Z',
        exportMimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const,
      },
    };

    const parsed = parseFirestoreDocumentData(nextShape);

    expect(parsed.sourceKind).toBe('google_workspace');
    expect(parsed.externalSource).toEqual(nextShape.externalSource);
  });

  it('accepts google docs externalSource union values', () => {
    const docsShape = {
      ...baseRawDocument,
      sourceKind: 'google_workspace' as const,
      externalSource: {
        provider: 'google_drive' as const,
        workspaceMimeType: 'application/vnd.google-apps.document' as const,
        fileId: 'drive-doc-1',
        name: 'FAQ Draft',
        importedAt: '2026-05-12T10:00:00.000Z',
        exportedAt: '2026-05-12T10:00:05.000Z',
        exportMimeType: 'text/markdown' as const,
      },
    };

    const parsed = parseFirestoreDocumentData(docsShape);
    expect(parsed.externalSource).toEqual(docsShape.externalSource);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  clearChunksForDocMock,
  deleteObjectsWithPrefixMock,
  getFirestoreClientMock,
} = vi.hoisted(() => ({
  clearChunksForDocMock: vi.fn(),
  deleteObjectsWithPrefixMock: vi.fn(),
  getFirestoreClientMock: vi.fn(),
}));

vi.mock('../chunkRegenerator', () => ({
  clearChunksForDoc: clearChunksForDocMock,
}));

vi.mock('../storage', () => ({
  deleteObjectsWithPrefix: deleteObjectsWithPrefixMock,
}));

vi.mock('../firestore', () => ({
  getFirestoreClient: getFirestoreClientMock,
}));

import { purgeDemoSampleDocuments } from '../demoSamplePurge';

function buildFirestoreClient(docIds: string[], failingDocIds: string[] = []) {
  const deleteMock = vi.fn(async (docId: string) => {
    if (failingDocIds.includes(docId)) {
      throw new Error('firestore delete failed');
    }
  });
  const docs = docIds.map((id) => ({
    id,
    ref: { id },
  }));

  return {
    collection: vi.fn(() => ({
      where: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ docs }),
      })),
      doc: vi.fn((docId: string) => ({
        delete: () => deleteMock(docId),
      })),
    })),
    deleteMock,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearChunksForDocMock.mockResolvedValue(undefined);
  deleteObjectsWithPrefixMock.mockResolvedValue(1);
});

describe('purgeDemoSampleDocuments', () => {
  it('clears chunks, deletes Firestore docs, then deletes trailing-slash GCS prefixes', async () => {
    const client = buildFirestoreClient(['doc-a', 'doc-b']);
    getFirestoreClientMock.mockReturnValue(client);

    const result = await purgeDemoSampleDocuments();

    expect(clearChunksForDocMock).toHaveBeenCalledTimes(2);
    expect(clearChunksForDocMock).toHaveBeenNthCalledWith(1, 'doc-a');
    expect(clearChunksForDocMock).toHaveBeenNthCalledWith(2, 'doc-b');
    expect(client.collection).toHaveBeenCalledWith('documents');
    expect(deleteObjectsWithPrefixMock).toHaveBeenCalledWith('raw/doc-a/');
    expect(deleteObjectsWithPrefixMock).toHaveBeenCalledWith('masked/doc-a/');
    expect(deleteObjectsWithPrefixMock).toHaveBeenCalledWith('raw/doc-b/');
    expect(deleteObjectsWithPrefixMock).toHaveBeenCalledWith('masked/doc-b/');
    expect(result.docIds).toEqual(['doc-a', 'doc-b']);
    expect(result.gcsObjectsDeleted).toBe(4);
  });

  it('skips GCS deletion when Firestore document delete fails', async () => {
    const client = buildFirestoreClient(['doc-fail'], ['doc-fail']);
    getFirestoreClientMock.mockReturnValue(client);

    const result = await purgeDemoSampleDocuments();

    expect(deleteObjectsWithPrefixMock).not.toHaveBeenCalled();
    expect(result.failures).toEqual([
      expect.objectContaining({
        docId: 'doc-fail',
        stage: 'firestore_document',
      }),
    ]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  randomUUIDMock,
  parseGoogleSheetsInputMock,
  fetchSheetsSnapshotMock,
  xlsxBufferToNormalizedContentMock,
  parseGoogleDocsInputMock,
  fetchDocsSnapshotMock,
  markdownBufferToNormalizedContentMock,
  curatorFlowMock,
  maskerPipelineFlowMock,
  uploadRawObjectMock,
  deleteRawObjectMock,
  uploadMaskedObjectMock,
  deleteMaskedObjectMock,
  replaceChunksForDocMock,
  clearChunksForDocMock,
  setMock,
  updateMock,
  deleteMock,
  docFnMock,
  collectionMock,
  whereMock,
  limitMock,
  queryGetMock,
  getFirestoreClientMock,
  serverTimestampMock,
  fieldValueDeleteMock,
} = vi.hoisted(() => ({
  randomUUIDMock: vi.fn(),
  parseGoogleSheetsInputMock: vi.fn(),
  fetchSheetsSnapshotMock: vi.fn(),
  xlsxBufferToNormalizedContentMock: vi.fn(),
  parseGoogleDocsInputMock: vi.fn(),
  fetchDocsSnapshotMock: vi.fn(),
  markdownBufferToNormalizedContentMock: vi.fn(),
  curatorFlowMock: vi.fn(),
  maskerPipelineFlowMock: vi.fn(),
  uploadRawObjectMock: vi.fn(),
  deleteRawObjectMock: vi.fn(),
  uploadMaskedObjectMock: vi.fn(),
  deleteMaskedObjectMock: vi.fn(),
  replaceChunksForDocMock: vi.fn(),
  clearChunksForDocMock: vi.fn(),
  setMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  docFnMock: vi.fn(),
  collectionMock: vi.fn(),
  whereMock: vi.fn(),
  limitMock: vi.fn(),
  queryGetMock: vi.fn(),
  getFirestoreClientMock: vi.fn(),
  serverTimestampMock: vi.fn(),
  fieldValueDeleteMock: vi.fn(),
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomUUID: randomUUIDMock,
  };
});

vi.mock('../googleSheetsSnapshotImporter', () => ({
  GOOGLE_SHEETS_MIME_TYPE: 'application/vnd.google-apps.spreadsheet',
  XLSX_EXPORT_MIME_TYPE:
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  googleSheetsWorkspaceImportAdapter: {
    workspaceMimeType: 'application/vnd.google-apps.spreadsheet',
    exportMimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileExtension: '.xlsx',
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    toNormalizedContent: xlsxBufferToNormalizedContentMock,
  },
  parseGoogleSheetsInput: parseGoogleSheetsInputMock,
  fetchSheetsSnapshot: fetchSheetsSnapshotMock,
  xlsxBufferToNormalizedContent: xlsxBufferToNormalizedContentMock,
}));

vi.mock('../googleDocsSnapshotImporter', () => ({
  GOOGLE_DOCS_MIME_TYPE: 'application/vnd.google-apps.document',
  MARKDOWN_EXPORT_MIME_TYPE: 'text/markdown',
  googleDocsWorkspaceImportAdapter: {
    workspaceMimeType: 'application/vnd.google-apps.document',
    exportMimeType: 'text/markdown',
    fileExtension: '.md',
    contentType: 'text/markdown',
    toNormalizedContent: markdownBufferToNormalizedContentMock,
  },
  parseGoogleDocsInput: parseGoogleDocsInputMock,
  fetchDocsSnapshot: fetchDocsSnapshotMock,
  markdownBufferToNormalizedContent: markdownBufferToNormalizedContentMock,
}));

vi.mock('../../agents/curator/flow', () => ({
  curatorFlow: curatorFlowMock,
}));

vi.mock('../../agents/masker/pipelineFlow', () => ({
  maskerPipelineFlow: maskerPipelineFlowMock,
}));

vi.mock('../../agents/_shared/genkitClient', () => ({
  modelId: 'test-model',
}));

vi.mock('../storage', () => ({
  uploadRawObject: uploadRawObjectMock,
  deleteRawObject: deleteRawObjectMock,
  uploadMaskedObject: uploadMaskedObjectMock,
  deleteMaskedObject: deleteMaskedObjectMock,
}));

vi.mock('../chunkRegenerator', () => ({
  replaceChunksForDoc: replaceChunksForDocMock,
  clearChunksForDoc: clearChunksForDocMock,
}));

const docMock = {
  set: setMock,
  update: updateMock,
  delete: deleteMock,
};
docFnMock.mockImplementation((id?: string) => ({
  ...docMock,
  id: id ?? 'doc-unknown',
}));
const queryChain = {
  where: whereMock,
  limit: limitMock,
  get: queryGetMock,
};
whereMock.mockImplementation(() => queryChain);
limitMock.mockImplementation(() => queryChain);
collectionMock.mockImplementation(() => ({ doc: docFnMock, where: whereMock }));
getFirestoreClientMock.mockImplementation(() => ({ collection: collectionMock }));
serverTimestampMock.mockImplementation(() => 'SERVER_TIMESTAMP');
fieldValueDeleteMock.mockImplementation(() => 'FIELD_DELETE');
vi.mock('../firestore', () => ({
  FieldValue: {
    serverTimestamp: serverTimestampMock,
    delete: fieldValueDeleteMock,
  },
  getFirestoreClient: getFirestoreClientMock,
}));

import {
  ImportTooLargeError,
  buildSafeMarkdownName,
  buildSafeXlsxName,
  orchestrateImportedDocsSnapshotProcessing,
  orchestrateImportedSnapshotProcessing,
} from '../importedSnapshotOrchestrator';
import { hashContentSha256 } from '../firestoreSchema';

const xlsxBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01]);
const markdownBuffer = Buffer.from('# Ops Guide\n\n- Step 1', 'utf-8');

const snapshot = {
  metadata: {
    fileId: 'sheet-file-id',
    name: '料金表',
    mimeType: 'application/vnd.google-apps.spreadsheet',
    webViewLink: 'https://docs.google.com/spreadsheets/d/sheet-file-id/edit',
    modifiedTime: '2026-05-10T01:02:03.000Z',
  },
  xlsxBuffer,
  exportedAt: '2026-05-12T01:00:00.000Z',
} as const;

const docsSnapshot = {
  metadata: {
    fileId: 'docs-file-id',
    name: 'Ops Guide',
    mimeType: 'application/vnd.google-apps.document',
    webViewLink: 'https://docs.google.com/document/d/docs-file-id/edit',
    modifiedTime: '2026-05-10T11:22:33.000Z',
  },
  markdownBuffer,
  exportedAt: '2026-05-12T01:30:00.000Z',
} as const;

const curatorDirectResult = {
  documentType: '料金表',
  businessDomain: '料金管理',
  sensitivity: 'Internal',
  freshness: 'current',
  isAuthoritativeCandidate: true,
  aiUsePolicy: 'direct',
  rationale: 'direct',
} as const;

const curatorRequiresMaskingResult = {
  documentType: 'メモ',
  businessDomain: '顧客対応',
  sensitivity: 'Confidential',
  freshness: 'current',
  isAuthoritativeCandidate: true,
  aiUsePolicy: 'requires_masking',
  rationale: 'masking',
} as const;

const aiSafePipelineResult = {
  decision: 'ai_safe_ready',
  aiSafeVersion: {
    fileName: '料金表.xlsx',
    provider: 'simple-rule',
    maskedContent: 'MASKED',
    maskedSpans: [],
    generatedAt: new Date().toISOString(),
    sourceContentHash: 'hash',
    residualRisk: { detected: false, reasons: ['ok'] },
    schemaVersion: 1,
  },
  curatorFeedback: null,
  rawRiskOutput: {
    residualRisk: { detected: false, reasons: ['ok'] },
    recommendedSensitivity: 'Confidential',
    rationale: 'safe',
  },
  maskingResult: {
    provider: 'simple-rule',
    maskedContent: 'MASKED',
    maskedSpans: [],
    ruleHits: {},
  },
} as const;

const restrictedPipelineResult = {
  decision: 'restricted_promoted',
  aiSafeVersion: null,
  curatorFeedback: {
    newSensitivity: 'Restricted',
    newAiUsePolicy: 'blocked',
    reason: 'residual risk',
  },
  rawRiskOutput: {
    residualRisk: { detected: true, reasons: ['high reidentification'] },
    recommendedSensitivity: 'Restricted',
    rationale: 'restricted required',
  },
  maskingResult: {
    provider: 'simple-rule',
    maskedContent: 'MASKED',
    maskedSpans: [],
    ruleHits: {},
  },
} as const;

function makeExistingWorkspaceDocData(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'doc-existing',
    schemaVersion: 2,
    fileName: 'Legacy Revenue.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    byteSize: 1024,
    contentSha256: 'legacy-sha256',
    sourceKind: 'google_workspace',
    externalSource: {
      provider: 'google_drive',
      workspaceMimeType: 'application/vnd.google-apps.spreadsheet',
      fileId: 'sheet-file-id',
      name: 'Legacy Revenue',
      importedAt: '2026-05-01T00:00:00.000Z',
      exportedAt: '2026-05-01T00:00:00.000Z',
      modifiedTime: '2026-05-01T00:00:00.000Z',
      exportMimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    storagePath: 'raw/doc-existing/Legacy Revenue.xlsx',
    aiSafeStoragePath: null,
    status: 'curated',
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-01T00:00:00.000Z'),
    documentType: '表',
    businessDomain: '料金管理',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    aiUsePolicy: 'direct',
    sensitivitySource: 'curator',
    originalCuratorSensitivity: null,
    sensitivityReason: null,
    curator: {
      documentType: '表',
      businessDomain: '料金管理',
      sensitivity: 'Internal',
      freshness: 'current',
      isAuthoritativeCandidate: true,
      aiUsePolicy: 'direct',
      rationale: 'legacy',
      completedAt: new Date('2026-05-01T00:00:00.000Z'),
      modelId: 'test-model',
    },
    curatorError: null,
    masker: null,
    maskerError: null,
    ...overrides,
  };
}

function makeExistingWorkspaceQuerySnapshot(
  data: Record<string, unknown>,
  docId = 'doc-existing'
): { empty: false; docs: Array<{ id: string; data: () => Record<string, unknown> }> } {
  return {
    empty: false,
    docs: [
      {
        id: docId,
        data: () => data,
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  randomUUIDMock.mockReturnValue('doc-1');
  parseGoogleSheetsInputMock.mockReturnValue({ fileId: 'sheet-file-id' });
  fetchSheetsSnapshotMock.mockResolvedValue(snapshot);
  xlsxBufferToNormalizedContentMock.mockReturnValue('## Sheet1\n\n| A |');
  parseGoogleDocsInputMock.mockReturnValue({ fileId: 'docs-file-id' });
  fetchDocsSnapshotMock.mockResolvedValue(docsSnapshot);
  markdownBufferToNormalizedContentMock.mockReturnValue('# Ops Guide\n\n- Step 1');
  setMock.mockResolvedValue(undefined);
  updateMock.mockResolvedValue(undefined);
  deleteMock.mockResolvedValue(undefined);
  uploadRawObjectMock.mockResolvedValue(undefined);
  deleteRawObjectMock.mockResolvedValue(undefined);
  uploadMaskedObjectMock.mockResolvedValue(undefined);
  deleteMaskedObjectMock.mockResolvedValue(undefined);
  replaceChunksForDocMock.mockResolvedValue(undefined);
  clearChunksForDocMock.mockResolvedValue(undefined);
  queryGetMock.mockResolvedValue({ empty: true, docs: [] });
});

describe('orchestrateImportedSnapshotProcessing', () => {
  it('returns curated and writes google_workspace metadata', async () => {
    curatorFlowMock.mockResolvedValue(curatorDirectResult);

    const result = await orchestrateImportedSnapshotProcessing({
      urlOrFileId: 'https://docs.google.com/spreadsheets/d/sheet-file-id/edit#gid=1',
    });

    expect(result.kind).toBe('curated');
    expect(result.fileName).toBe('料金表.xlsx');
    expect(result.snapshotByteSize).toBe(xlsxBuffer.length);
    expect(result.ingestKind).toBe('created');
    expect(result.skipped).toBeUndefined();
    expect(parseGoogleSheetsInputMock).toHaveBeenCalledWith(
      'https://docs.google.com/spreadsheets/d/sheet-file-id/edit#gid=1'
    );
    expect(uploadRawObjectMock).toHaveBeenCalledWith(
      'raw/doc-1/料金表.xlsx',
      xlsxBuffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'doc-1',
        fileName: '料金表.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        byteSize: xlsxBuffer.length,
        sourceKind: 'google_workspace',
        externalSource: expect.objectContaining({
          provider: 'google_drive',
          fileId: 'sheet-file-id',
          name: '料金表',
          modifiedTime: '2026-05-10T01:02:03.000Z',
          exportedAt: '2026-05-12T01:00:00.000Z',
          exportMimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      }),
      { merge: false }
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'curating' })
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'curated', aiUsePolicy: 'direct' })
    );
    expect(replaceChunksForDocMock).toHaveBeenCalledWith('doc-1');
  });

  it('uses sheet fallback for Drive name that is only an xlsx suffix', async () => {
    fetchSheetsSnapshotMock.mockResolvedValue({
      ...snapshot,
      metadata: {
        ...snapshot.metadata,
        name: '  .xlsx  ',
      },
    });
    curatorFlowMock.mockResolvedValue(curatorDirectResult);

    await orchestrateImportedSnapshotProcessing({
      urlOrFileId: 'sheet-file-id',
    });

    expect(uploadRawObjectMock).toHaveBeenCalledWith(
      'raw/doc-1/sheet.xlsx',
      xlsxBuffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'sheet.xlsx',
        externalSource: expect.objectContaining({
          name: '  .xlsx  ',
        }),
      }),
      { merge: false }
    );
  });

  it('does not double-append .xlsx when Drive metadata name already has xlsx suffix', async () => {
    fetchSheetsSnapshotMock.mockResolvedValue({
      ...snapshot,
      metadata: {
        ...snapshot.metadata,
        name: 'report.xlsx',
      },
    });
    curatorFlowMock.mockResolvedValue(curatorDirectResult);

    await orchestrateImportedSnapshotProcessing({
      urlOrFileId: 'sheet-file-id',
    });

    expect(uploadRawObjectMock).toHaveBeenCalledWith(
      'raw/doc-1/report.xlsx',
      xlsxBuffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'report.xlsx',
      }),
      { merge: false }
    );
  });

  it('keeps persisted fileName separate from displayName used for AI processing', async () => {
    fetchSheetsSnapshotMock.mockResolvedValue({
      ...snapshot,
      metadata: {
        ...snapshot.metadata,
        name: 'Drive Source',
      },
    });
    curatorFlowMock.mockResolvedValue(curatorDirectResult);

    const result = await orchestrateImportedSnapshotProcessing({
      urlOrFileId: 'sheet-file-id',
      displayName: 'Human Friendly Context Name',
    });

    expect(result.fileName).toBe('Drive Source.xlsx');
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'Drive Source.xlsx',
        externalSource: expect.objectContaining({
          name: 'Drive Source',
        }),
      }),
      { merge: false }
    );
    expect(curatorFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'Human Friendly Context Name',
      })
    );
  });

  it('returns ai_safe and writes a masked object', async () => {
    randomUUIDMock.mockReturnValue('doc-2');
    curatorFlowMock.mockResolvedValue(curatorRequiresMaskingResult);
    maskerPipelineFlowMock.mockResolvedValue(aiSafePipelineResult);

    const result = await orchestrateImportedSnapshotProcessing({
      urlOrFileId: 'sheet-file-id',
    });

    expect(result.kind).toBe('ai_safe');
    expect(uploadMaskedObjectMock).toHaveBeenCalledWith(
      'masked/doc-2/料金表.xlsx',
      'MASKED',
      expect.objectContaining({
        aiSafeSchemaVersion: 1,
        provider: 'simple-rule',
      })
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ai_safe',
        aiSafeStoragePath: 'masked/doc-2/料金表.xlsx',
      })
    );
    expect(replaceChunksForDocMock).toHaveBeenCalledWith('doc-2');
  });

  it('returns restricted without writing a masked object', async () => {
    randomUUIDMock.mockReturnValue('doc-3');
    curatorFlowMock.mockResolvedValue(curatorRequiresMaskingResult);
    maskerPipelineFlowMock.mockResolvedValue(restrictedPipelineResult);

    const result = await orchestrateImportedSnapshotProcessing({
      urlOrFileId: 'sheet-file-id',
    });

    expect(result.kind).toBe('restricted');
    expect(uploadMaskedObjectMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'restricted',
        aiSafeStoragePath: null,
        sensitivitySource: 'masker',
        aiUsePolicy: 'blocked',
      })
    );
    expect(replaceChunksForDocMock).not.toHaveBeenCalled();
  });

  it('overwrites existing document using the same docId and deletes old raw path when safeName changes', async () => {
    queryGetMock.mockResolvedValue(
      makeExistingWorkspaceQuerySnapshot(
        makeExistingWorkspaceDocData({
          id: 'doc-overwrite',
          storagePath: 'raw/doc-overwrite/Legacy Revenue.xlsx',
          contentSha256: 'old-hash',
        }),
        'doc-overwrite'
      )
    );
    fetchSheetsSnapshotMock.mockResolvedValue({
      ...snapshot,
      metadata: { ...snapshot.metadata, name: 'Renamed Revenue' },
    });
    curatorFlowMock.mockResolvedValue(curatorDirectResult);

    const result = await orchestrateImportedSnapshotProcessing({
      urlOrFileId: 'sheet-file-id',
    });

    expect(result.ingestKind).toBe('overwritten');
    expect(result.skipped).toBeUndefined();
    expect(uploadRawObjectMock).toHaveBeenCalledWith(
      'raw/doc-overwrite/Renamed Revenue.xlsx',
      xlsxBuffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'doc-overwrite',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        updatedAt: 'SERVER_TIMESTAMP',
      }),
      { merge: false }
    );
    expect(replaceChunksForDocMock).toHaveBeenCalledWith('doc-overwrite');
    expect(deleteRawObjectMock).toHaveBeenCalledWith(
      'raw/doc-overwrite/Legacy Revenue.xlsx'
    );
  });

  it('queries duplicate workspace fileIds with limit 2 before choosing overwrite target', async () => {
    queryGetMock.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'doc-first',
          data: () =>
            makeExistingWorkspaceDocData({
              id: 'doc-first',
              contentSha256: 'old-hash',
            }),
        },
        {
          id: 'doc-second',
          data: () =>
            makeExistingWorkspaceDocData({
              id: 'doc-second',
              contentSha256: 'older-hash',
            }),
        },
      ],
    });
    curatorFlowMock.mockResolvedValue(curatorDirectResult);

    await orchestrateImportedSnapshotProcessing({ urlOrFileId: 'sheet-file-id' });

    expect(limitMock).toHaveBeenCalledWith(2);
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'doc-first' }),
      { merge: false }
    );
  });

  it('clears old chunks best-effort when overwrite curator phase fails', async () => {
    queryGetMock.mockResolvedValue(
      makeExistingWorkspaceQuerySnapshot(
        makeExistingWorkspaceDocData({
          id: 'doc-curator-fail',
          contentSha256: 'old-hash',
        }),
        'doc-curator-fail'
      )
    );
    curatorFlowMock.mockRejectedValue(new Error('curator failed'));

    await expect(
      orchestrateImportedSnapshotProcessing({ urlOrFileId: 'sheet-file-id' })
    ).rejects.toThrow('curator failed');

    expect(clearChunksForDocMock).toHaveBeenCalledWith('doc-curator-fail');
    expect(replaceChunksForDocMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('short-circuits overwrite when contentSha256 is unchanged', async () => {
    const unchangedHash = hashContentSha256(xlsxBuffer);
    queryGetMock.mockResolvedValue(
      makeExistingWorkspaceQuerySnapshot(
        makeExistingWorkspaceDocData({
          id: 'doc-same-hash',
          contentSha256: unchangedHash,
        }),
        'doc-same-hash'
      )
    );
    curatorFlowMock.mockResolvedValue(curatorDirectResult);

    const result = await orchestrateImportedSnapshotProcessing({
      urlOrFileId: 'sheet-file-id',
    });

    expect(result.ingestKind).toBe('overwritten');
    expect(result.skipped).toBe(true);
    expect(uploadRawObjectMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
    expect(curatorFlowMock).not.toHaveBeenCalled();
    expect(maskerPipelineFlowMock).not.toHaveBeenCalled();
    expect(replaceChunksForDocMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        'externalSource.exportedAt': '2026-05-12T01:00:00.000Z',
        'externalSource.modifiedTime': '2026-05-10T01:02:03.000Z',
      })
    );
  });

  it('on overwrite set failure, deletes newly uploaded raw object', async () => {
    queryGetMock.mockResolvedValue(
      makeExistingWorkspaceQuerySnapshot(
        makeExistingWorkspaceDocData({
          id: 'doc-set-fail',
          storagePath: 'raw/doc-set-fail/Legacy Revenue.xlsx',
          contentSha256: 'old-hash',
        }),
        'doc-set-fail'
      )
    );
    fetchSheetsSnapshotMock.mockResolvedValue({
      ...snapshot,
      metadata: { ...snapshot.metadata, name: 'New Revenue' },
    });
    setMock.mockRejectedValue(new Error('overwrite set failed'));

    await expect(
      orchestrateImportedSnapshotProcessing({ urlOrFileId: 'sheet-file-id' })
    ).rejects.toThrow('overwrite set failed');

    expect(uploadRawObjectMock).toHaveBeenCalledTimes(1);
    expect(deleteRawObjectMock).toHaveBeenCalledWith(
      'raw/doc-set-fail/New Revenue.xlsx'
    );
    expect(curatorFlowMock).not.toHaveBeenCalled();
    expect(replaceChunksForDocMock).not.toHaveBeenCalled();
  });

  it('marks failed when chunk replacement fails after terminal lifecycle', async () => {
    randomUUIDMock.mockReturnValue('doc-9');
    curatorFlowMock.mockResolvedValue(curatorDirectResult);
    replaceChunksForDocMock.mockRejectedValue(new Error('chunk replace failed'));

    await expect(
      orchestrateImportedSnapshotProcessing({ urlOrFileId: 'sheet-file-id' })
    ).rejects.toThrow('chunk replace failed');

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('stops before Firestore when Drive export fails', async () => {
    fetchSheetsSnapshotMock.mockRejectedValue(new Error('export failed'));

    await expect(
      orchestrateImportedSnapshotProcessing({ urlOrFileId: 'sheet-file-id' })
    ).rejects.toThrow('export failed');

    expect(uploadRawObjectMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('stops before GCS/Firestore when exported snapshot exceeds max size', async () => {
    fetchSheetsSnapshotMock.mockResolvedValue({
      ...snapshot,
      xlsxBuffer: Buffer.alloc(5 * 1024 * 1024 + 1),
    });

    await expect(
      orchestrateImportedSnapshotProcessing({ urlOrFileId: 'sheet-file-id' })
    ).rejects.toBeInstanceOf(ImportTooLargeError);

    expect(xlsxBufferToNormalizedContentMock).not.toHaveBeenCalled();
    expect(uploadRawObjectMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(curatorFlowMock).not.toHaveBeenCalled();
    expect(maskerPipelineFlowMock).not.toHaveBeenCalled();
  });

  it('stops before Firestore when raw upload fails', async () => {
    uploadRawObjectMock.mockRejectedValue(new Error('gcs failed'));

    await expect(
      orchestrateImportedSnapshotProcessing({ urlOrFileId: 'sheet-file-id' })
    ).rejects.toThrow('gcs failed');

    expect(setMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteRawObjectMock).not.toHaveBeenCalled();
  });

  describe('rollback paths (§5 failure matrix)', () => {
    /**
     * `safeDeleteRawObject` は `deleteRawObject` を try/catch で包むだけなので、
     * storage の mock で rollback 呼び出しを固定する。
     */
    it('after GCS [B] succeeds: Firestore initial set [C] fails → raw object rollback only', async () => {
      randomUUIDMock.mockReturnValue('doc-4');
      setMock.mockRejectedValue(new Error('set failed'));

      await expect(
        orchestrateImportedSnapshotProcessing({ urlOrFileId: 'sheet-file-id' })
      ).rejects.toThrow('set failed');

      expect(uploadRawObjectMock).toHaveBeenCalledTimes(1);
      expect(deleteRawObjectMock).toHaveBeenCalledTimes(1);
      expect(deleteRawObjectMock).toHaveBeenCalledWith('raw/doc-4/料金表.xlsx');
      expect(deleteMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
      expect(curatorFlowMock).not.toHaveBeenCalled();
      expect(maskerPipelineFlowMock).not.toHaveBeenCalled();
    });

    it('after [B][C] succeed: curating update [D] fails → raw then Firestore rollback (reverse partial order)', async () => {
      randomUUIDMock.mockReturnValue('doc-5');
      updateMock.mockImplementation(async (payload: Record<string, unknown>) => {
        if (payload.status === 'curating') {
          throw new Error('curating failed');
        }
      });

      await expect(
        orchestrateImportedSnapshotProcessing({ urlOrFileId: 'sheet-file-id' })
      ).rejects.toThrow('curating failed');

      expect(uploadRawObjectMock).toHaveBeenCalledTimes(1);
      expect(setMock).toHaveBeenCalledTimes(1);
      expect(deleteRawObjectMock).toHaveBeenCalledTimes(1);
      expect(deleteRawObjectMock).toHaveBeenCalledWith('raw/doc-5/料金表.xlsx');
      expect(deleteMock).toHaveBeenCalledTimes(1);
      const rawOrder = deleteRawObjectMock.mock.invocationCallOrder[0];
      const firestoreOrder = deleteMock.mock.invocationCallOrder[0];
      expect(rawOrder).toBeDefined();
      expect(firestoreOrder).toBeDefined();
      expect(rawOrder).toBeLessThan(firestoreOrder);
      expect(curatorFlowMock).not.toHaveBeenCalled();
      expect(maskerPipelineFlowMock).not.toHaveBeenCalled();
    });
  });
});

describe('orchestrateImportedDocsSnapshotProcessing', () => {
  it('uses the same orchestrator flow for Google Docs with markdown export', async () => {
    randomUUIDMock.mockReturnValue('doc-d1');
    curatorFlowMock.mockResolvedValue(curatorDirectResult);

    const result = await orchestrateImportedDocsSnapshotProcessing({
      urlOrFileId: 'https://docs.google.com/document/d/docs-file-id/edit',
    });

    expect(result.kind).toBe('curated');
    expect(result.fileName).toBe('Ops Guide.md');
    expect(result.snapshotByteSize).toBe(markdownBuffer.length);
    expect(result.ingestKind).toBe('created');
    expect(parseGoogleDocsInputMock).toHaveBeenCalledWith(
      'https://docs.google.com/document/d/docs-file-id/edit'
    );
    expect(uploadRawObjectMock).toHaveBeenCalledWith(
      'raw/doc-d1/Ops Guide.md',
      markdownBuffer,
      'text/markdown'
    );
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'doc-d1',
        fileName: 'Ops Guide.md',
        contentType: 'text/markdown',
        byteSize: markdownBuffer.length,
        sourceKind: 'google_workspace',
        externalSource: expect.objectContaining({
          provider: 'google_drive',
          fileId: 'docs-file-id',
          name: 'Ops Guide',
          modifiedTime: '2026-05-10T11:22:33.000Z',
          exportedAt: '2026-05-12T01:30:00.000Z',
          workspaceMimeType: 'application/vnd.google-apps.document',
          exportMimeType: 'text/markdown',
        }),
      }),
      { merge: false }
    );
    expect(curatorFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'Ops Guide.md',
        content: '# Ops Guide\n\n- Step 1',
      })
    );
    expect(replaceChunksForDocMock).toHaveBeenCalledWith('doc-d1');
  });
});

describe('buildSafeXlsxName', () => {
  it('uses sheet fallback for empty or whitespace-only input', () => {
    expect(buildSafeXlsxName('')).toBe('sheet.xlsx');
    expect(buildSafeXlsxName('   ')).toBe('sheet.xlsx');
    expect(buildSafeXlsxName('\t\n')).toBe('sheet.xlsx');
  });

  it('uses sheet fallback when name is only an xlsx suffix (any case)', () => {
    expect(buildSafeXlsxName('.xlsx')).toBe('sheet.xlsx');
    expect(buildSafeXlsxName('.XLSX')).toBe('sheet.xlsx');
    expect(buildSafeXlsxName('  .xlsx  ')).toBe('sheet.xlsx');
  });

  it('keeps symbol-only bases and does not double-append .xlsx', () => {
    expect(buildSafeXlsxName('@@@')).toBe('@@@.xlsx');
    expect(buildSafeXlsxName('###')).toBe('###.xlsx');
  });

  it('strips a single .xlsx suffix without doubling', () => {
    expect(buildSafeXlsxName('report.xlsx')).toBe('report.xlsx');
    expect(buildSafeXlsxName('report.XLSX')).toBe('report.xlsx');
    expect(buildSafeXlsxName('Q1 Data.xlsx')).toBe('Q1 Data.xlsx');
  });

  it('strips trailing dots from base before adding .xlsx', () => {
    expect(buildSafeXlsxName('report.')).toBe('report.xlsx');
    expect(buildSafeXlsxName('report...')).toBe('report.xlsx');
    expect(buildSafeXlsxName('report..xlsx')).toBe('report.xlsx');
  });

  it('strips trailing dots re-exposed after max-length slice', () => {
    const longName = `${'A'.repeat(194)}.${'B'.repeat(50)}.xlsx`;
    expect(buildSafeXlsxName(longName)).toBe(`${'A'.repeat(194)}.xlsx`);
  });

  it('sanitizes path separators then applies xlsx rules', () => {
    expect(buildSafeXlsxName('a/b\\c.xlsx')).toBe('a_b_c.xlsx');
  });
});

describe('buildSafeMarkdownName', () => {
  it('uses document fallback for empty or extension-only names', () => {
    expect(buildSafeMarkdownName('')).toBe('document.md');
    expect(buildSafeMarkdownName('   ')).toBe('document.md');
    expect(buildSafeMarkdownName('.md')).toBe('document.md');
  });

  it('strips a single .md suffix without doubling', () => {
    expect(buildSafeMarkdownName('guide.md')).toBe('guide.md');
    expect(buildSafeMarkdownName('guide.MD')).toBe('guide.md');
  });
});

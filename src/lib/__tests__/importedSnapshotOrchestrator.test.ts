import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  randomUUIDMock,
  parseGoogleSheetsInputMock,
  fetchSheetsSnapshotMock,
  xlsxBufferToNormalizedContentMock,
  curatorFlowMock,
  maskerPipelineFlowMock,
  uploadRawObjectMock,
  deleteRawObjectMock,
  uploadMaskedObjectMock,
  deleteMaskedObjectMock,
  setMock,
  updateMock,
  deleteMock,
  docFnMock,
  collectionMock,
  getFirestoreClientMock,
  serverTimestampMock,
} = vi.hoisted(() => ({
  randomUUIDMock: vi.fn(),
  parseGoogleSheetsInputMock: vi.fn(),
  fetchSheetsSnapshotMock: vi.fn(),
  xlsxBufferToNormalizedContentMock: vi.fn(),
  curatorFlowMock: vi.fn(),
  maskerPipelineFlowMock: vi.fn(),
  uploadRawObjectMock: vi.fn(),
  deleteRawObjectMock: vi.fn(),
  uploadMaskedObjectMock: vi.fn(),
  deleteMaskedObjectMock: vi.fn(),
  setMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  docFnMock: vi.fn(),
  collectionMock: vi.fn(),
  getFirestoreClientMock: vi.fn(),
  serverTimestampMock: vi.fn(),
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
  parseGoogleSheetsInput: parseGoogleSheetsInputMock,
  fetchSheetsSnapshot: fetchSheetsSnapshotMock,
  xlsxBufferToNormalizedContent: xlsxBufferToNormalizedContentMock,
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

const docMock = {
  set: setMock,
  update: updateMock,
  delete: deleteMock,
};
docFnMock.mockImplementation(() => docMock);
collectionMock.mockImplementation(() => ({ doc: docFnMock }));
getFirestoreClientMock.mockImplementation(() => ({ collection: collectionMock }));
serverTimestampMock.mockImplementation(() => 'SERVER_TIMESTAMP');
vi.mock('../firestore', () => ({
  FieldValue: {
    serverTimestamp: serverTimestampMock,
  },
  getFirestoreClient: getFirestoreClientMock,
}));

import { orchestrateImportedSnapshotProcessing } from '../importedSnapshotOrchestrator';

const xlsxBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01]);

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

beforeEach(() => {
  vi.clearAllMocks();
  randomUUIDMock.mockReturnValue('doc-1');
  parseGoogleSheetsInputMock.mockReturnValue({ fileId: 'sheet-file-id' });
  fetchSheetsSnapshotMock.mockResolvedValue(snapshot);
  xlsxBufferToNormalizedContentMock.mockReturnValue('## Sheet1\n\n| A |');
  setMock.mockResolvedValue(undefined);
  updateMock.mockResolvedValue(undefined);
  deleteMock.mockResolvedValue(undefined);
  uploadRawObjectMock.mockResolvedValue(undefined);
  deleteRawObjectMock.mockResolvedValue(undefined);
  uploadMaskedObjectMock.mockResolvedValue(undefined);
  deleteMaskedObjectMock.mockResolvedValue(undefined);
});

describe('orchestrateImportedSnapshotProcessing', () => {
  it('returns curated and writes google_workspace metadata', async () => {
    curatorFlowMock.mockResolvedValue(curatorDirectResult);

    const result = await orchestrateImportedSnapshotProcessing({
      urlOrFileId: 'https://docs.google.com/spreadsheets/d/sheet-file-id/edit#gid=1',
    });

    expect(result.kind).toBe('curated');
    expect(result.snapshotByteSize).toBe(xlsxBuffer.length);
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
      })
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'curating' })
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'curated', aiUsePolicy: 'direct' })
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

  it('stops before Firestore when raw upload fails', async () => {
    uploadRawObjectMock.mockRejectedValue(new Error('gcs failed'));

    await expect(
      orchestrateImportedSnapshotProcessing({ urlOrFileId: 'sheet-file-id' })
    ).rejects.toThrow('gcs failed');

    expect(setMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteRawObjectMock).not.toHaveBeenCalled();
  });

  it('rolls back raw object when Firestore initial set fails', async () => {
    randomUUIDMock.mockReturnValue('doc-4');
    setMock.mockRejectedValue(new Error('set failed'));

    await expect(
      orchestrateImportedSnapshotProcessing({ urlOrFileId: 'sheet-file-id' })
    ).rejects.toThrow('set failed');

    expect(deleteRawObjectMock).toHaveBeenCalledWith('raw/doc-4/料金表.xlsx');
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('rolls back raw object and Firestore doc when curating update fails', async () => {
    randomUUIDMock.mockReturnValue('doc-5');
    updateMock.mockImplementation(async (payload: Record<string, unknown>) => {
      if (payload.status === 'curating') {
        throw new Error('curating failed');
      }
    });

    await expect(
      orchestrateImportedSnapshotProcessing({ urlOrFileId: 'sheet-file-id' })
    ).rejects.toThrow('curating failed');

    expect(deleteRawObjectMock).toHaveBeenCalledWith('raw/doc-5/料金表.xlsx');
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });
});

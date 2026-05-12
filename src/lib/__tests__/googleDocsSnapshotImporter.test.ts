import { beforeEach, describe, expect, it, vi } from 'vitest';

const getGoogleDriveClientMock = vi.hoisted(() => vi.fn());

vi.mock('../googleWorkspaceClient', () => ({
  getGoogleDriveClient: getGoogleDriveClientMock,
}));

import {
  DriveExportError,
  GoogleSheetShareError,
  UnsupportedMimeTypeError,
} from '../googleSheetsSnapshotImporter';
import {
  GOOGLE_DOCS_MIME_TYPE,
  InvalidGoogleDocsInputError,
  MARKDOWN_EXPORT_MIME_TYPE,
  fetchDocsSnapshot,
  markdownBufferToNormalizedContent,
  parseGoogleDocsInput,
} from '../googleDocsSnapshotImporter';

const SAMPLE_FILE_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

describe('parseGoogleDocsInput', () => {
  it('parses Google Docs /edit URL', () => {
    expect(
      parseGoogleDocsInput(
        `https://docs.google.com/document/d/${SAMPLE_FILE_ID}/edit`
      )
    ).toEqual({ fileId: SAMPLE_FILE_ID });
  });

  it('parses bare fileId', () => {
    expect(parseGoogleDocsInput(SAMPLE_FILE_ID)).toEqual({
      fileId: SAMPLE_FILE_ID,
    });
  });

  it('rejects empty input', () => {
    expect(() => parseGoogleDocsInput('')).toThrow(InvalidGoogleDocsInputError);
    expect(() => parseGoogleDocsInput('   ')).toThrow(
      InvalidGoogleDocsInputError
    );
  });
});

describe('fetchDocsSnapshot', () => {
  const filesGetMock = vi.fn();
  const filesExportMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getGoogleDriveClientMock.mockReturnValue({
      files: {
        get: filesGetMock,
        export: filesExportMock,
      },
    });
  });

  it('returns metadata, markdown buffer, and exportedAt on success', async () => {
    filesGetMock.mockResolvedValue({
      data: {
        id: SAMPLE_FILE_ID,
        name: 'Ops Guide',
        mimeType: GOOGLE_DOCS_MIME_TYPE,
        webViewLink: 'https://docs.google.com/document/d/abc/edit',
        modifiedTime: '2024-02-03T00:00:00.000Z',
      },
    });
    const markdownBytes = Buffer.from('# Ops Guide\n\n- Step 1', 'utf-8');
    filesExportMock.mockResolvedValue({ data: markdownBytes });

    const result = await fetchDocsSnapshot(SAMPLE_FILE_ID);

    expect(filesGetMock).toHaveBeenCalledWith({
      fileId: SAMPLE_FILE_ID,
      fields: 'id,name,mimeType,webViewLink,modifiedTime',
      supportsAllDrives: true,
    });
    expect(filesExportMock).toHaveBeenCalledWith(
      {
        fileId: SAMPLE_FILE_ID,
        mimeType: MARKDOWN_EXPORT_MIME_TYPE,
      },
      { responseType: 'arraybuffer' }
    );
    expect(result.metadata).toEqual({
      fileId: SAMPLE_FILE_ID,
      name: 'Ops Guide',
      mimeType: GOOGLE_DOCS_MIME_TYPE,
      webViewLink: 'https://docs.google.com/document/d/abc/edit',
      modifiedTime: '2024-02-03T00:00:00.000Z',
    });
    expect(result.markdownBuffer.equals(markdownBytes)).toBe(true);
    expect(result.exportedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });

  it('throws GoogleSheetShareError when files.get returns 403', async () => {
    filesGetMock.mockRejectedValue({ code: 403, message: 'Forbidden' });

    await expect(fetchDocsSnapshot(SAMPLE_FILE_ID)).rejects.toBeInstanceOf(
      GoogleSheetShareError
    );
    expect(filesExportMock).not.toHaveBeenCalled();
  });

  it('throws UnsupportedMimeTypeError when mimeType is not a Google Docs file', async () => {
    filesGetMock.mockResolvedValue({
      data: {
        id: SAMPLE_FILE_ID,
        name: 'sheet',
        mimeType: 'application/vnd.google-apps.spreadsheet',
      },
    });

    await expect(fetchDocsSnapshot(SAMPLE_FILE_ID)).rejects.toBeInstanceOf(
      UnsupportedMimeTypeError
    );
    expect(filesExportMock).not.toHaveBeenCalled();
  });

  it('wraps unexpected export failures as DriveExportError', async () => {
    filesGetMock.mockResolvedValue({
      data: {
        id: SAMPLE_FILE_ID,
        name: 'Ops Guide',
        mimeType: GOOGLE_DOCS_MIME_TYPE,
      },
    });
    filesExportMock.mockRejectedValue({ code: 500, message: 'Internal Error' });

    await expect(fetchDocsSnapshot(SAMPLE_FILE_ID)).rejects.toBeInstanceOf(
      DriveExportError
    );
  });
});

describe('markdownBufferToNormalizedContent', () => {
  it('returns UTF-8 markdown text as-is', () => {
    expect(
      markdownBufferToNormalizedContent(Buffer.from('# Header\n\nBody', 'utf-8'))
    ).toBe('# Header\n\nBody');
  });
});

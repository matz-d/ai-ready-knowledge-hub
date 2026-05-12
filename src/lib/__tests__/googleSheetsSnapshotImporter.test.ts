import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

const getGoogleDriveClientMock = vi.hoisted(() => vi.fn());

vi.mock('../googleWorkspaceClient', () => ({
  getGoogleDriveClient: getGoogleDriveClientMock,
}));

import {
  GoogleSheetShareError,
  UnsupportedMimeTypeError,
  fetchSheetsSnapshot,
  parseGoogleSheetsInput,
  xlsxBufferToNormalizedContent,
} from '../googleSheetsSnapshotImporter';

const SAMPLE_FILE_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

describe('parseGoogleSheetsInput', () => {
  it('parses /edit URL', () => {
    expect(
      parseGoogleSheetsInput(
        `https://docs.google.com/spreadsheets/d/${SAMPLE_FILE_ID}/edit`
      )
    ).toEqual({ fileId: SAMPLE_FILE_ID });
  });

  it('parses /edit#gid=… (gid ignored)', () => {
    expect(
      parseGoogleSheetsInput(
        `https://docs.google.com/spreadsheets/d/${SAMPLE_FILE_ID}/edit#gid=123456`
      )
    ).toEqual({ fileId: SAMPLE_FILE_ID });
  });

  it('parses /edit?usp=sharing', () => {
    expect(
      parseGoogleSheetsInput(
        `https://docs.google.com/spreadsheets/d/${SAMPLE_FILE_ID}/edit?usp=sharing`
      )
    ).toEqual({ fileId: SAMPLE_FILE_ID });
  });

  it('parses URL without /edit suffix', () => {
    expect(
      parseGoogleSheetsInput(
        `https://docs.google.com/spreadsheets/d/${SAMPLE_FILE_ID}`
      )
    ).toEqual({ fileId: SAMPLE_FILE_ID });
  });

  it('accepts http scheme', () => {
    expect(
      parseGoogleSheetsInput(
        `http://docs.google.com/spreadsheets/d/${SAMPLE_FILE_ID}/edit`
      )
    ).toEqual({ fileId: SAMPLE_FILE_ID });
  });

  it('parses bare fileId', () => {
    expect(parseGoogleSheetsInput(SAMPLE_FILE_ID)).toEqual({
      fileId: SAMPLE_FILE_ID,
    });
  });

  it('trims whitespace', () => {
    expect(parseGoogleSheetsInput(`  ${SAMPLE_FILE_ID}  `)).toEqual({
      fileId: SAMPLE_FILE_ID,
    });
  });

  it('decodes percent-encoded fileId in path', () => {
    const id = `${'a'.repeat(19)}_`; // 20 chars
    const encoded = encodeURIComponent(id);
    expect(
      parseGoogleSheetsInput(
        `https://docs.google.com/spreadsheets/d/${encoded}/edit`
      )
    ).toEqual({ fileId: id });
  });

  it('rejects empty input', () => {
    expect(() => parseGoogleSheetsInput('')).toThrow(
      'Google Sheets URL or file ID is required.'
    );
    expect(() => parseGoogleSheetsInput('   ')).toThrow(
      'Google Sheets URL or file ID is required.'
    );
  });

  it('rejects non-docs host with spreadsheets path', () => {
    expect(() =>
      parseGoogleSheetsInput(
        `https://evil.example/spreadsheets/d/${SAMPLE_FILE_ID}/edit`
      )
    ).toThrow('Invalid Google Sheets URL or file ID.');
  });

  it('rejects fileId that is too short', () => {
    expect(() => parseGoogleSheetsInput('aaaaaaaaaaaaaaaaaaa')).toThrow(
      'Invalid Google Sheets URL or file ID.'
    );
  });

  it('rejects invalid characters in bare id', () => {
    const bad = `${'a'.repeat(19)}.`; // dot not allowed
    expect(() => parseGoogleSheetsInput(bad)).toThrow(
      'Invalid Google Sheets URL or file ID.'
    );
  });
});

describe('fetchSheetsSnapshot', () => {
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

  it('returns metadata, xlsx buffer, and exportedAt on success', async () => {
    filesGetMock.mockResolvedValue({
      data: {
        id: SAMPLE_FILE_ID,
        name: 'Q1 Plan',
        mimeType: 'application/vnd.google-apps.spreadsheet',
        webViewLink: 'https://docs.google.com/spreadsheets/d/abc/edit',
        modifiedTime: '2024-01-02T00:00:00.000Z',
      },
    });
    const xlsxBytes = Buffer.from([0x50, 0x4b, 3, 4]);
    filesExportMock.mockResolvedValue({ data: xlsxBytes });

    const result = await fetchSheetsSnapshot(SAMPLE_FILE_ID);

    expect(filesGetMock).toHaveBeenCalledWith({
      fileId: SAMPLE_FILE_ID,
      fields: 'id,name,mimeType,webViewLink,modifiedTime',
      supportsAllDrives: true,
    });
    expect(filesExportMock).toHaveBeenCalledWith(
      {
        fileId: SAMPLE_FILE_ID,
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      { responseType: 'arraybuffer' }
    );
    expect(result.metadata).toEqual({
      fileId: SAMPLE_FILE_ID,
      name: 'Q1 Plan',
      mimeType: 'application/vnd.google-apps.spreadsheet',
      webViewLink: 'https://docs.google.com/spreadsheets/d/abc/edit',
      modifiedTime: '2024-01-02T00:00:00.000Z',
    });
    expect(result.xlsxBuffer.equals(xlsxBytes)).toBe(true);
    expect(result.exportedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });

  it('throws GoogleSheetShareError when files.get returns 403', async () => {
    filesGetMock.mockRejectedValue({ code: 403, message: 'Forbidden' });

    await expect(fetchSheetsSnapshot(SAMPLE_FILE_ID)).rejects.toBeInstanceOf(
      GoogleSheetShareError
    );
    expect(filesExportMock).not.toHaveBeenCalled();
  });

  it('rethrows when files.get returns 404', async () => {
    const notFound = { code: 404, message: 'Not Found' };
    filesGetMock.mockRejectedValue(notFound);

    await expect(fetchSheetsSnapshot(SAMPLE_FILE_ID)).rejects.toBe(notFound);
    expect(filesExportMock).not.toHaveBeenCalled();
  });

  it('throws UnsupportedMimeTypeError when mimeType is not a Google Sheet', async () => {
    filesGetMock.mockResolvedValue({
      data: {
        id: SAMPLE_FILE_ID,
        name: 'readme.pdf',
        mimeType: 'application/pdf',
      },
    });

    await expect(fetchSheetsSnapshot(SAMPLE_FILE_ID)).rejects.toBeInstanceOf(
      UnsupportedMimeTypeError
    );
    expect(filesExportMock).not.toHaveBeenCalled();
  });
});

describe('xlsxBufferToNormalizedContent', () => {
  it('delegates to xlsxToNormalizedMarkdown', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['A', 'B'],
        [1, 2],
      ]),
      'Sheet1'
    );
    const buf = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const md = xlsxBufferToNormalizedContent(buf);
    expect(md).toContain('## Sheet1');
    expect(md).toContain('| A | B |');
  });
});

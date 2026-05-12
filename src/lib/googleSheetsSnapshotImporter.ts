import { xlsxToNormalizedMarkdown } from './extractors/xlsxExtractor';
import { getGoogleDriveClient } from './googleWorkspaceClient';

export const GOOGLE_SHEETS_MIME_TYPE =
  'application/vnd.google-apps.spreadsheet';

export const XLSX_EXPORT_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Thrown when Drive metadata says the file is not a Google Sheet (maps to HTTP 415). */
export class UnsupportedMimeTypeError extends Error {
  readonly mimeType: string | undefined;

  constructor(mimeType: string | undefined, message?: string) {
    super(
      message ??
        `Unsupported Google Drive file type: expected Google Sheets (${GOOGLE_SHEETS_MIME_TYPE}), got ${mimeType ?? 'unknown'}.`
    );
    this.name = 'UnsupportedMimeTypeError';
    this.mimeType = mimeType;
  }
}

/** Thrown when `urlOrFileId` is empty or not a Sheets URL / valid Drive file id (maps to HTTP 400). */
export class InvalidGoogleSheetsInputError extends Error {
  constructor(
    message = 'Invalid Google Sheets URL or file ID. Use a https://docs.google.com/spreadsheets/d/{id}/… link or a valid Drive file ID.',
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'InvalidGoogleSheetsInputError';
  }
}

/** Thrown when Drive returns 403 (share with service account; maps to HTTP 403). */
export class GoogleSheetShareError extends Error {
  constructor(
    message = 'Google Drive returned 403. Share the spreadsheet with the service account email.',
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'GoogleSheetShareError';
  }
}

/** Thrown when Drive export fails after metadata fetch (maps to HTTP 502). */
export class DriveExportError extends Error {
  constructor(
    message = 'Failed to export spreadsheet as .xlsx from Google Drive.',
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'DriveExportError';
  }
}

export type GoogleSheetsSnapshotMetadata = {
  fileId: string;
  name: string;
  mimeType: typeof GOOGLE_SHEETS_MIME_TYPE;
  webViewLink?: string;
  modifiedTime?: string;
};

export type GoogleSheetsSnapshot = {
  metadata: GoogleSheetsSnapshotMetadata;
  xlsxBuffer: Buffer;
  exportedAt: string;
};

/** Minimum length for a bare Drive file ID (D-P3-A-5). */
const FILE_ID_PATTERN = /^[a-zA-Z0-9_-]{20,}$/;

const DOCS_SHEETS_URL_PREFIX =
  /^https?:\/\/docs\.google\.com\/spreadsheets\/d\/([^/\s?#]+)/i;

/**
 * Pure parser for Google Sheets URL or bare fileId (D-P3-A-5).
 * `gid` in URLs is ignored (full workbook / all sheets via export).
 */
export function parseGoogleSheetsInput(urlOrFileId: string): { fileId: string } {
  const trimmed = urlOrFileId.trim();
  if (!trimmed) {
    throw new InvalidGoogleSheetsInputError(
      'Google Sheets URL or file ID is required.'
    );
  }

  const urlMatch = trimmed.match(DOCS_SHEETS_URL_PREFIX);
  const candidate = urlMatch?.[1]
    ? decodeURIComponent(urlMatch[1])
    : trimmed;

  if (!FILE_ID_PATTERN.test(candidate)) {
    throw new InvalidGoogleSheetsInputError();
  }

  return { fileId: candidate };
}

function httpStatusFromUnknown(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) {
    return undefined;
  }
  const e = err as {
    code?: number | string;
    response?: { status?: number };
    status?: number;
  };
  if (typeof e.response?.status === 'number') {
    return e.response.status;
  }
  if (typeof e.status === 'number') {
    return e.status;
  }
  if (typeof e.code === 'number' && e.code >= 400 && e.code < 600) {
    return e.code;
  }
  return undefined;
}

/**
 * Normalizes `files.export` response `data` to a Buffer.
 * googleapis may return Buffer, ArrayBuffer, a view, or a latin1/binary string.
 */
export function exportDataToBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data === 'string') {
    if (data.length === 0) {
      throw new DriveExportError(
        'Google Drive files.export returned an empty string body instead of binary data (string response despite responseType: arraybuffer).',
        { cause: new Error('empty_string_export_body') }
      );
    }
    // googleapis may deliver raw bytes as a latin1/binary string even when responseType is arraybuffer.
    return Buffer.from(data, 'binary');
  }
  const kind =
    data === null ? 'null' : data === undefined ? 'undefined' : typeof data;
  throw new DriveExportError(
    `Google Drive files.export returned unexpected body type (${kind}) instead of Buffer, ArrayBuffer, TypedArray, or binary string.`,
    { cause: new TypeError(`unexpected_export_body:${kind}`) }
  );
}

export async function fetchSheetsSnapshot(
  fileId: string
): Promise<GoogleSheetsSnapshot> {
  const drive = getGoogleDriveClient();
  let meta: {
    id?: string | null;
    name?: string | null;
    mimeType?: string | null;
    webViewLink?: string | null;
    modifiedTime?: string | null;
  };

  try {
    const metadataResponse = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,webViewLink,modifiedTime',
      supportsAllDrives: true,
    });
    meta = metadataResponse.data;
  } catch (err) {
    if (httpStatusFromUnknown(err) === 403) {
      throw new GoogleSheetShareError(undefined, { cause: err });
    }
    throw err;
  }

  if (meta.mimeType !== GOOGLE_SHEETS_MIME_TYPE) {
    throw new UnsupportedMimeTypeError(meta.mimeType ?? undefined);
  }
  if (!meta.id || !meta.name) {
    throw new Error('Drive metadata response did not include id/name.');
  }

  let exportBody: unknown;
  try {
    const exportResponse = await drive.files.export(
      {
        fileId,
        mimeType: XLSX_EXPORT_MIME_TYPE,
      },
      { responseType: 'arraybuffer' }
    );
    exportBody = exportResponse.data;
  } catch (err) {
    const status = httpStatusFromUnknown(err);
    if (status === 403) {
      throw new GoogleSheetShareError(undefined, { cause: err });
    }
    if (status === 404) {
      throw err;
    }
    throw new DriveExportError(undefined, { cause: err });
  }

  let xlsxBuffer: Buffer;
  try {
    xlsxBuffer = exportDataToBuffer(exportBody);
  } catch (err) {
    if (err instanceof DriveExportError) {
      throw err;
    }
    throw new DriveExportError(undefined, { cause: err });
  }

  return {
    metadata: {
      fileId: meta.id,
      name: meta.name,
      mimeType: GOOGLE_SHEETS_MIME_TYPE,
      webViewLink: meta.webViewLink ?? undefined,
      modifiedTime: meta.modifiedTime ?? undefined,
    },
    xlsxBuffer,
    exportedAt: new Date().toISOString(),
  };
}

export function xlsxBufferToNormalizedContent(xlsxBuffer: Buffer): string {
  return xlsxToNormalizedMarkdown(xlsxBuffer);
}

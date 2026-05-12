import { getGoogleDriveClient } from './googleWorkspaceClient';
import {
  DriveExportError,
  GoogleSheetShareError,
  UnsupportedMimeTypeError,
  exportDataToBuffer,
} from './googleSheetsSnapshotImporter';
import type { WorkspaceImportAdapter } from './workspaceImport/types';

export const GOOGLE_DOCS_MIME_TYPE = 'application/vnd.google-apps.document';
export const MARKDOWN_EXPORT_MIME_TYPE = 'text/markdown';

export const googleDocsWorkspaceImportAdapter: WorkspaceImportAdapter = {
  workspaceMimeType: GOOGLE_DOCS_MIME_TYPE,
  exportMimeType: MARKDOWN_EXPORT_MIME_TYPE,
  fileExtension: '.md',
  contentType: MARKDOWN_EXPORT_MIME_TYPE,
  toNormalizedContent: (bytes) => markdownBufferToNormalizedContent(bytes),
};

export class InvalidGoogleDocsInputError extends Error {
  constructor(
    message = 'Invalid Google Docs URL or file ID. Use a https://docs.google.com/document/d/{id}/… link or a valid Drive file ID.',
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'InvalidGoogleDocsInputError';
  }
}

export type GoogleDocsSnapshotMetadata = {
  fileId: string;
  name: string;
  mimeType: typeof GOOGLE_DOCS_MIME_TYPE;
  webViewLink?: string;
  modifiedTime?: string;
};

export type GoogleDocsSnapshot = {
  metadata: GoogleDocsSnapshotMetadata;
  markdownBuffer: Buffer;
  exportedAt: string;
};

/** Minimum length for a bare Drive file ID. */
const FILE_ID_PATTERN = /^[a-zA-Z0-9_-]{20,}$/;

const DOCS_DOCUMENT_URL_PREFIX =
  /^https?:\/\/docs\.google\.com\/document\/d\/([^/\s?#]+)/i;

export function parseGoogleDocsInput(urlOrFileId: string): { fileId: string } {
  const trimmed = urlOrFileId.trim();
  if (!trimmed) {
    throw new InvalidGoogleDocsInputError('Google Docs URL or file ID is required.');
  }

  const urlMatch = trimmed.match(DOCS_DOCUMENT_URL_PREFIX);
  const candidate = urlMatch?.[1]
    ? decodeURIComponent(urlMatch[1])
    : trimmed;

  if (!FILE_ID_PATTERN.test(candidate)) {
    throw new InvalidGoogleDocsInputError();
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

export async function fetchDocsSnapshot(fileId: string): Promise<GoogleDocsSnapshot> {
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

  if (meta.mimeType !== GOOGLE_DOCS_MIME_TYPE) {
    throw new UnsupportedMimeTypeError(
      meta.mimeType ?? undefined,
      `Unsupported Google Drive file type: expected Google Docs (${GOOGLE_DOCS_MIME_TYPE}), got ${meta.mimeType ?? 'unknown'}.`
    );
  }
  if (!meta.id || !meta.name) {
    throw new Error('Drive metadata response did not include id/name.');
  }

  let exportBody: unknown;
  try {
    const exportResponse = await drive.files.export(
      {
        fileId,
        mimeType: MARKDOWN_EXPORT_MIME_TYPE,
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
    throw new DriveExportError(
      'Failed to export Google Docs as markdown from Google Drive.',
      { cause: err }
    );
  }

  let markdownBuffer: Buffer;
  try {
    markdownBuffer = exportDataToBuffer(exportBody);
  } catch (err) {
    if (err instanceof DriveExportError) {
      throw err;
    }
    throw new DriveExportError(
      'Failed to normalize Google Docs markdown export body.',
      { cause: err }
    );
  }

  return {
    metadata: {
      fileId: meta.id,
      name: meta.name,
      mimeType: GOOGLE_DOCS_MIME_TYPE,
      webViewLink: meta.webViewLink ?? undefined,
      modifiedTime: meta.modifiedTime ?? undefined,
    },
    markdownBuffer,
    exportedAt: new Date().toISOString(),
  };
}

export function markdownBufferToNormalizedContent(markdownBuffer: Buffer): string {
  return markdownBuffer.toString('utf-8');
}

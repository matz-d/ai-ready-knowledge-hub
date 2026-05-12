/**
 * `POST /api/import/google-sheets` — Google Sheets URL / fileId から Drive export 経由で取り込む。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { modelId } from '../../../../agents/_shared/genkitClient';
import { documentUploadSuccessBodyFromOrchestrate } from '../../../../lib/documentUploadResponseMapper';
import {
  DriveExportError,
  GoogleSheetShareError,
  InvalidGoogleSheetsInputError,
  UnsupportedMimeTypeError,
} from '../../../../lib/googleSheetsSnapshotImporter';
import { getServiceAccountEmail } from '../../../../lib/googleWorkspaceClient';
import {
  GcsUploadError,
  ImportTooLargeError,
  orchestrateImportedSnapshotProcessing,
} from '../../../../lib/importedSnapshotOrchestrator';
import {
  CuratorPhaseError,
  MaskerPhaseError,
} from '../../../../lib/uploadOrchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  urlOrFileId: z.string().min(1, 'urlOrFileId is required'),
  displayName: z.string().max(500).optional(),
});

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

function extractRequestUrlFromUnknown(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) {
    return undefined;
  }
  const e = err as {
    config?: { url?: unknown };
    response?: { config?: { url?: unknown } };
  };
  const urlFromConfig = e.config?.url;
  if (typeof urlFromConfig === 'string') {
    return urlFromConfig;
  }
  const urlFromResponseConfig = e.response?.config?.url;
  if (typeof urlFromResponseConfig === 'string') {
    return urlFromResponseConfig;
  }
  return undefined;
}

function isLikelyDriveError(err: unknown): boolean {
  if (err instanceof GoogleSheetShareError || err instanceof DriveExportError) {
    return true;
  }
  const requestUrl = extractRequestUrlFromUnknown(err);
  if (!requestUrl) {
    return false;
  }
  return /(^https?:\/\/)?([a-z0-9-]+\.)?googleapis\.com\/drive\//i.test(
    requestUrl
  );
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_json', message: 'Request body must be valid JSON' },
      { status: 400 }
    );
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid_input',
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  const { urlOrFileId, displayName } = parsed.data;

  try {
    const result = await orchestrateImportedSnapshotProcessing({
      urlOrFileId,
      displayName,
    });

    const body = documentUploadSuccessBodyFromOrchestrate({
      displayName: result.fileName,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      byteSize: result.snapshotByteSize,
      modelId,
      result,
    });

    return NextResponse.json(body);
  } catch (e) {
    console.error('[import/google-sheets] processing failed', e);

    if (e instanceof InvalidGoogleSheetsInputError) {
      return NextResponse.json({ error: 'invalid_url' }, { status: 400 });
    }

    if (e instanceof GoogleSheetShareError) {
      const serviceAccountEmail = await getServiceAccountEmail().catch(
        () => undefined
      );
      return NextResponse.json(
        {
          error: 'sheet_not_shared',
          ...(serviceAccountEmail ? { serviceAccountEmail } : {}),
        },
        { status: 403 }
      );
    }

    const status = httpStatusFromUnknown(e);
    if (status === 404 && isLikelyDriveError(e)) {
      return NextResponse.json({ error: 'sheet_not_found' }, { status: 404 });
    }

    if (e instanceof ImportTooLargeError) {
      return NextResponse.json({ error: 'import_too_large' }, { status: 413 });
    }

    if (e instanceof UnsupportedMimeTypeError) {
      return NextResponse.json({ error: 'not_a_spreadsheet' }, { status: 415 });
    }

    if (e instanceof CuratorPhaseError) {
      return NextResponse.json(
        {
          error: 'curator_failed',
          docId: e.docId,
        },
        { status: 500 }
      );
    }

    if (e instanceof MaskerPhaseError) {
      return NextResponse.json(
        {
          error: 'masker_failed',
          docId: e.docId,
        },
        { status: 500 }
      );
    }

    if (e instanceof DriveExportError) {
      return NextResponse.json({ error: 'drive_export_failed' }, { status: 502 });
    }

    if (e instanceof GcsUploadError) {
      return NextResponse.json({ error: 'gcs_failed' }, { status: 502 });
    }

    return NextResponse.json({ error: 'drive_export_failed' }, { status: 502 });
  }
}

import { parseFirestoreDocumentData } from './parseFirestoreDocumentData';
import { getFirestoreClient } from './firestore';
import { getGoogleDriveClient } from './googleWorkspaceClient';

export type WorkspaceFreshnessDriveCode =
  | 'drive_not_found'
  | 'drive_forbidden';

export type WorkspaceFreshnessResult = {
  isStale: boolean;
  savedModifiedTime: string;
  latestModifiedTime: string;
};

export class WorkspaceDocumentNotFoundError extends Error {
  constructor(readonly docId: string) {
    super(`Workspace document not found: ${docId}`);
    this.name = 'WorkspaceDocumentNotFoundError';
  }
}

export class NonWorkspaceDocumentError extends Error {
  constructor(readonly docId: string) {
    super(`Document is not backed by a Google Workspace source: ${docId}`);
    this.name = 'NonWorkspaceDocumentError';
  }
}

export class MissingSavedModifiedTimeError extends Error {
  constructor(readonly docId: string) {
    super(`Document is missing externalSource.modifiedTime: ${docId}`);
    this.name = 'MissingSavedModifiedTimeError';
  }
}

export class DriveFreshnessAccessError extends Error {
  constructor(
    readonly code: WorkspaceFreshnessDriveCode,
    readonly savedModifiedTime: string,
    options?: ErrorOptions
  ) {
    super(`Drive freshness check failed: ${code}`, options);
    this.name = 'DriveFreshnessAccessError';
  }
}

export class MissingLatestModifiedTimeError extends Error {
  constructor(readonly fileId: string) {
    super(`Drive metadata response did not include modifiedTime: ${fileId}`);
    this.name = 'MissingLatestModifiedTimeError';
  }
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

function isLaterModifiedTime(latest: string, saved: string): boolean {
  const latestMs = Date.parse(latest);
  const savedMs = Date.parse(saved);
  if (Number.isFinite(latestMs) && Number.isFinite(savedMs)) {
    return latestMs > savedMs;
  }
  return latest !== saved;
}

export async function getWorkspaceFreshness(
  docId: string
): Promise<WorkspaceFreshnessResult> {
  const db = getFirestoreClient();
  const snapshot = await db.collection('documents').doc(docId).get();

  if (!snapshot.exists) {
    throw new WorkspaceDocumentNotFoundError(docId);
  }

  const rawData = snapshot.data();
  const document = parseFirestoreDocumentData({
    id: snapshot.id ?? docId,
    ...rawData,
  });

  if (
    document.sourceKind !== 'google_workspace' ||
    document.externalSource === null
  ) {
    throw new NonWorkspaceDocumentError(docId);
  }

  const savedModifiedTime = document.externalSource.modifiedTime;
  if (!savedModifiedTime) {
    throw new MissingSavedModifiedTimeError(docId);
  }

  const drive = getGoogleDriveClient();
  let latestModifiedTime: string | null | undefined;
  try {
    const response = await drive.files.get({
      fileId: document.externalSource.fileId,
      fields: 'modifiedTime',
      supportsAllDrives: true,
    });
    latestModifiedTime = response.data.modifiedTime;
  } catch (err) {
    const status = httpStatusFromUnknown(err);
    if (status === 403 || status === 404) {
      throw new DriveFreshnessAccessError(
        status === 403 ? 'drive_forbidden' : 'drive_not_found',
        savedModifiedTime,
        { cause: err }
      );
    }
    throw err;
  }

  if (!latestModifiedTime) {
    throw new MissingLatestModifiedTimeError(document.externalSource.fileId);
  }

  return {
    isStale: isLaterModifiedTime(latestModifiedTime, savedModifiedTime),
    savedModifiedTime,
    latestModifiedTime,
  };
}

import { Storage } from '@google-cloud/storage';
import { getKnowledgeHubBucketName } from '../storage';
import type { ContextPackageJobResultRef } from './schema';

const RESULT_OBJECT_PREFIX = 'context-package/job-results';

function encodedPathSegment(value: string): string {
  if (!value.trim()) {
    throw new Error('context package job result path segment must be non-empty');
  }
  return encodeURIComponent(value);
}

/**
 * GCS object path for offloaded Context Package job result.
 * We include tenantId in the path to make retention policy and audits easier to reason about.
 */
export function contextPackageJobResultObjectPath(
  tenantId: string,
  jobId: string,
): string {
  return `${RESULT_OBJECT_PREFIX}/${encodedPathSegment(tenantId)}/${encodedPathSegment(jobId)}.json`;
}

export async function writeContextPackageJobResult(options: {
  tenantId: string;
  jobId: string;
  payload: Record<string, unknown>;
  storage?: Storage;
}): Promise<ContextPackageJobResultRef> {
  const storage = options.storage ?? new Storage();
  const bucket = getKnowledgeHubBucketName();
  const objectPath = contextPackageJobResultObjectPath(
    options.tenantId,
    options.jobId,
  );
  const body = JSON.stringify(options.payload);
  const byteSize = Buffer.byteLength(body, 'utf8');

  await storage.bucket(bucket).file(objectPath).save(body, {
    contentType: 'application/json',
    resumable: false,
    metadata: {
      cacheControl: 'private, max-age=0',
      metadata: {
        tenantId: options.tenantId,
        jobId: options.jobId,
      },
    },
  });

  return {
    storage: 'gcs',
    bucket,
    objectPath,
    contentType: 'application/json',
    byteSize,
  };
}

export async function readContextPackageJobResult(
  resultRef: ContextPackageJobResultRef,
  expectedOrStorage?: { tenantId: string; jobId: string } | Storage,
  maybeStorage?: Storage,
): Promise<Record<string, unknown>> {
  const expected =
    expectedOrStorage && 'tenantId' in expectedOrStorage
      ? expectedOrStorage
      : undefined;
  const storage =
    maybeStorage ??
    (expectedOrStorage && !('tenantId' in expectedOrStorage)
      ? expectedOrStorage
      : new Storage());

  if (expected) {
    const expectedPath = contextPackageJobResultObjectPath(
      expected.tenantId,
      expected.jobId,
    );
    if (resultRef.objectPath !== expectedPath) {
      throw new Error('offloaded context package result path does not match job');
    }
  }
  const file = storage.bucket(resultRef.bucket).file(resultRef.objectPath);
  if (expected && 'getMetadata' in file && typeof file.getMetadata === 'function') {
    const [metadata] = await file.getMetadata();
    const custom = metadata.metadata ?? {};
    if (custom.tenantId !== expected.tenantId || custom.jobId !== expected.jobId) {
      throw new Error('offloaded context package result metadata does not match job');
    }
  }
  const [body] = await file.download();
  const parsed: unknown = JSON.parse(body.toString('utf-8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('offloaded context package result must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export async function deleteContextPackageJobResult(
  resultRef: ContextPackageJobResultRef,
  storage: Storage = new Storage(),
): Promise<void> {
  await storage.bucket(resultRef.bucket).file(resultRef.objectPath).delete({
    ignoreNotFound: true,
  });
}

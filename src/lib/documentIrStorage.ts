/**
 * GCS adapter for DocumentIR snapshots — Phase 3-H-2 M1.
 * Authoritative path: `raw/{docId}/document-ir/{revisionId}.json`
 * Design rationale: docs/decisions.md D-P3-H-4 (Q2).
 * Retention policy: docs/decisions.md D-PROD-3.
 *
 * Rationale for GCS over Firestore:
 *   - DocumentIR JSON can exceed Firestore's 1 MiB document limit for large PDFs.
 *   - GCS objects are cheaper for large blobs and support streaming reads for future M3 heuristics.
 *   - Firestore `conversion_eval` stores only the lightweight ConversionEvalResult (M2).
 *
 * The `storage` parameter is injectable for testing without vi.mock module-level patching.
 */
import { Storage } from '@google-cloud/storage';
import {
  DocumentIrSchema,
  type DocumentIr,
} from '../eval/conversion/documentIr';

// ── Path builder ───────────────────────────────────────────────────────────

export const DOCUMENT_IR_GCS_VERSION = 'v1' as const;

/**
 * GCS object path for a DocumentIR snapshot.
 * Returns `raw/{docId}/document-ir/{revisionId}.json`.
 * Throws if `docId` is empty or whitespace-only.
 */
export function documentIrStoragePath(
  docId: string,
  revisionId: string = DOCUMENT_IR_GCS_VERSION
): string {
  if (!docId.trim()) {
    throw new Error('documentIrStoragePath: docId must be non-empty');
  }
  if (!revisionId.trim()) {
    throw new Error('documentIrStoragePath: revisionId must be non-empty');
  }
  return `raw/${docId}/document-ir/${revisionId}.json`;
}

// ── Write ──────────────────────────────────────────────────────────────────

export type WriteDocumentIrSnapshotOptions = {
  bucketName: string;
  docId: string;
  revisionId?: string;
  documentIr: DocumentIr;
  /** Injected for testing; defaults to `new Storage()` in production. */
  storage?: Storage;
};

/**
 * Persists a validated DocumentIR snapshot to GCS as pretty-printed JSON.
 *
 * Validates `documentIr` with Zod **before** the network call so schema drift
 * in the caller is caught at the source rather than silently written to GCS.
 *
 * Returns the GCS object path (`raw/{docId}/document-ir/{revisionId}.json`).
 * The object may contain unmasked extracted text for reprocessing, so the
 * production bucket lifecycle must delete `raw/` objects after the D-PROD-3
 * retention window.
 */
export async function writeDocumentIrSnapshot(
  options: WriteDocumentIrSnapshotOptions
): Promise<string> {
  const {
    bucketName,
    docId,
    revisionId = DOCUMENT_IR_GCS_VERSION,
    storage = new Storage(),
  } = options;

  // Validate first — any Zod error surfaces before we touch the network.
  const validated = DocumentIrSchema.parse(options.documentIr);

  const objectPath = documentIrStoragePath(docId, revisionId);
  const body = `${JSON.stringify(validated, null, 2)}\n`;

  await storage.bucket(bucketName).file(objectPath).save(body, {
    contentType: 'application/json',
    resumable: false,
    metadata: { cacheControl: 'private, max-age=0' },
  });

  return objectPath;
}

// ── Read ───────────────────────────────────────────────────────────────────

export type ReadDocumentIrSnapshotOptions = {
  bucketName: string;
  docId: string;
  revisionId?: string;
  /** Injected for testing; defaults to `new Storage()` in production. */
  storage?: Storage;
};

/**
 * Reads and validates a DocumentIR snapshot from GCS.
 *
 * Returns `null` if the object does not exist (not-yet-converted document).
 * Throws `ZodError` if the stored document fails schema validation.
 * Throws `SyntaxError` if the stored content is not valid JSON.
 */
export async function readDocumentIrSnapshot(
  options: ReadDocumentIrSnapshotOptions
): Promise<DocumentIr | null> {
  const {
    bucketName,
    docId,
    revisionId = DOCUMENT_IR_GCS_VERSION,
    storage = new Storage(),
  } = options;

  const objectPath = documentIrStoragePath(docId, revisionId);
  const file = storage.bucket(bucketName).file(objectPath);

  const [exists] = await file.exists();
  if (!exists) return null;

  const [body] = await file.download();
  const json: unknown = JSON.parse(body.toString('utf-8'));

  return DocumentIrSchema.parse(json);
}

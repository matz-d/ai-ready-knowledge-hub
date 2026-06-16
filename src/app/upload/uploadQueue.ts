import {
  MAX_UPLOAD_BYTES,
  type DocumentUploadSuccessResponse,
} from '../../lib/documents';

/**
 * Client-side upload queue primitives for the multi-file upload UI.
 *
 * The product ingest path stays per-file: the queue calls the existing
 * `POST /api/documents` once per file (PR-C, A-lite + B direction). Heavy
 * Gemini work (curator runs synchronously per file; table-assist is a separate
 * opt-in reprocess endpoint) is therefore never batched server-side. Keeping
 * these helpers pure and `fetch`-injectable lets the concurrency / retry logic
 * be unit-tested without React.
 */

/** Cap the batch so a single selection cannot enqueue an unbounded number of synchronous Gemini ingests. */
export const MAX_UPLOAD_FILES = 20;

/**
 * How many files upload in parallel. Each `POST /api/documents` runs the curator
 * (live Gemini) synchronously, and Gemini runs in the `global` region with
 * fail-closed quota, so keep this small. Start at 1; 2 is the safe ceiling.
 */
export const UPLOAD_CONCURRENCY = 1;

export type UploadOutcome =
  | { ok: true; data: DocumentUploadSuccessResponse }
  | { ok: false; message: string; docId?: string };

export { MAX_UPLOAD_BYTES };

export function isFileTooLarge(file: File): boolean {
  return file.size > MAX_UPLOAD_BYTES;
}

export function maxFileSizeMessage(): string {
  const mb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
  return `ファイルサイズは ${mb} MB 以下にしてください。`;
}

export function tooManyFilesMessage(): string {
  return `一度にアップロードできるのは最大 ${MAX_UPLOAD_FILES} 件です。件数を減らして再度お試しください。`;
}

/**
 * Upload one file via the existing single-document endpoint. Never throws: a
 * network error or a non-2xx body is normalized into `{ ok: false, message }`
 * so the queue runner can record per-file status and keep going.
 */
export async function uploadSingleDocument(
  file: File,
  fetchImpl: typeof fetch = fetch
): Promise<UploadOutcome> {
  const formData = new FormData();
  formData.append('file', file);

  let res: Response;
  try {
    res = await fetchImpl('/api/documents', {
      method: 'POST',
      body: formData,
    });
  } catch {
    return { ok: false, message: 'ネットワークエラーが発生しました。' };
  }

  if (res.ok) {
    try {
      const data = (await res.json()) as DocumentUploadSuccessResponse;
      return { ok: true, data };
    } catch {
      return { ok: false, message: 'アップロード結果の解析に失敗しました。' };
    }
  }

  let message = 'アップロードに失敗しました。';
  let docId: string | undefined;
  try {
    const body = (await res.json()) as { error?: string; docId?: string };
    if (body.error) message = body.error;
    if (body.docId) docId = body.docId;
  } catch {
    /* non-JSON error body: keep the generic message */
  }
  return { ok: false, message, docId };
}

/**
 * Run `worker` over `items` with at most `limit` in flight. Continue-on-failure:
 * a worker that rejects does not abort the rest of the batch (the worker owns its
 * own error handling; this guard is defensive).
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const lanes = Math.max(1, Math.min(limit, queue.length || 1));
  const runLane = async (): Promise<void> => {
    for (;;) {
      const next = queue.shift();
      if (next === undefined) return;
      try {
        await worker(next);
      } catch {
        /* worker records its own failure; never abort the batch */
      }
    }
  };
  await Promise.all(Array.from({ length: lanes }, runLane));
}

import type { CuratorOutputResult } from '../agents/curator/schema';

export const DOCUMENTS_COLLECTION = 'documents';

export const MAX_UPLOAD_BYTES = 1 * 1024 * 1024;

const ALLOWED_EXTENSIONS = ['.txt', '.md', '.csv'] as const;

export type DocumentLifecycleStatus =
  | 'uploaded'
  | 'curating'
  | 'curated'
  | 'failed';

/** HTTP / UI 向け。Firestore の Timestamp は含めない。 */
export type SerializableCuratorBlock = {
  documentType: string;
  businessDomain: string;
  sensitivity: string;
  freshness: string;
  isAuthoritativeCandidate: boolean;
  aiUsePolicy: string;
  rationale: string;
  completedAt: string;
  modelId: string;
};

export type DocumentUploadSuccessResponse = {
  docId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  storagePath: string;
  status: 'curated';
  curator: SerializableCuratorBlock;
};

export type DocumentUploadCuratorErrorResponse = {
  error: string;
  docId: string;
};

export function sanitizeOriginalFileName(original: string): string {
  const noSeparators = original.replace(/[/\\]/g, '_').replace(/\0/g, '');
  const trimmed = noSeparators.trim();
  if (!trimmed) return 'file.txt';
  return trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
}

export function buildRawObjectPath(docId: string, safeFileName: string): string {
  return `raw/${docId}/${safeFileName}`;
}

export function getAllowedExtension(
  fileName: string
): (typeof ALLOWED_EXTENSIONS)[number] | null {
  const lower = fileName.toLowerCase();
  for (const ext of ALLOWED_EXTENSIONS) {
    if (lower.endsWith(ext)) return ext;
  }
  return null;
}

export function isAllowedMimeType(mime: string): boolean {
  const m = mime.toLowerCase().trim();
  if (!m) return true;
  return (
    m === 'text/plain' ||
    m === 'text/markdown' ||
    m === 'text/csv' ||
    m === 'application/vnd.ms-excel' ||
    m === 'application/octet-stream'
  );
}

export function decodeUtf8Strict(buffer: ArrayBuffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

export function toSerializableCurator(
  result: CuratorOutputResult,
  modelId: string,
  completedAt: Date
): SerializableCuratorBlock {
  return {
    documentType: result.documentType,
    businessDomain: result.businessDomain,
    sensitivity: result.sensitivity,
    freshness: result.freshness,
    isAuthoritativeCandidate: result.isAuthoritativeCandidate,
    aiUsePolicy: result.aiUsePolicy,
    rationale: result.rationale,
    completedAt: completedAt.toISOString(),
    modelId,
  };
}

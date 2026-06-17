/**
 * HMAC signing for table-assist Cloud Tasks payloads.
 *
 * The worker shared token authenticates the caller; this signature proves the
 * docId / tenantId / actor tuple was produced by the enqueue path.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { OrchestrateAuditContext } from './uploadOrchestrator';

export type PdfTableAssistTaskActor = OrchestrateAuditContext['actor'];

export type PdfTableAssistTaskPayload = {
  docId: string;
  tenantId: string;
  actor: PdfTableAssistTaskActor;
  issuedAt: string;
  signature: string;
};

export type PdfTableAssistTaskPayloadInput = {
  docId: string;
  tenantId: string;
  actor: PdfTableAssistTaskActor;
};

export class PdfTableAssistTaskSigningNotConfiguredError extends Error {
  constructor() {
    super(
      'PDF table-assist task signing is not configured: missing PDF_TABLE_ASSIST_TASK_SIGNING_SECRET'
    );
    this.name = 'PdfTableAssistTaskSigningNotConfiguredError';
  }
}

/** Default replay window when verifying signed tasks in production. */
export const PDF_TABLE_ASSIST_TASK_SIGNATURE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function resolveSigningSecret(): string | undefined {
  const secret = process.env.PDF_TABLE_ASSIST_TASK_SIGNING_SECRET;
  if (secret !== undefined && secret.trim().length > 0) {
    return secret;
  }
  return undefined;
}

export function isPdfTableAssistTaskSigningConfigured(): boolean {
  return resolveSigningSecret() !== undefined;
}

export function requirePdfTableAssistTaskSigningSecret(): string {
  const secret = resolveSigningSecret();
  if (!secret) {
    throw new PdfTableAssistTaskSigningNotConfiguredError();
  }
  return secret;
}

function canonicalPayloadForSigning(payload: {
  docId: string;
  tenantId: string;
  actor: PdfTableAssistTaskActor;
  issuedAt: string;
}): string {
  return JSON.stringify({
    actor: {
      ipAddress: payload.actor.ipAddress,
      userAgent: payload.actor.userAgent,
      userId: payload.actor.userId,
    },
    docId: payload.docId,
    issuedAt: payload.issuedAt,
    tenantId: payload.tenantId,
  });
}

function signCanonicalPayload(canonical: string, secret: string): string {
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

function signaturesMatch(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  if (expectedBytes.length !== actualBytes.length) {
    return false;
  }
  return timingSafeEqual(expectedBytes, actualBytes);
}

export function signPdfTableAssistTaskPayload(
  input: PdfTableAssistTaskPayloadInput,
  options?: { issuedAt?: string; secret?: string }
): PdfTableAssistTaskPayload {
  const secret = options?.secret ?? requirePdfTableAssistTaskSigningSecret();
  const issuedAt = options?.issuedAt ?? new Date().toISOString();
  const canonical = canonicalPayloadForSigning({ ...input, issuedAt });
  const signature = signCanonicalPayload(canonical, secret);

  return {
    docId: input.docId,
    tenantId: input.tenantId,
    actor: input.actor,
    issuedAt,
    signature,
  };
}

export type VerifyPdfTableAssistTaskPayloadResult =
  | { ok: true; payload: PdfTableAssistTaskPayload }
  | {
      ok: false;
      code:
        | 'task_signature_required'
        | 'task_signature_invalid'
        | 'task_signature_expired';
    };

export function verifyPdfTableAssistTaskPayload(
  body: unknown,
  options?: {
    secret?: string;
    now?: Date;
    maxAgeMs?: number;
    requireSignature?: boolean;
  }
): VerifyPdfTableAssistTaskPayloadResult {
  const secret = options?.secret ?? resolveSigningSecret();
  const requireSignature =
    options?.requireSignature ??
    (process.env.NODE_ENV === 'production' || secret !== undefined);

  if (!body || typeof body !== 'object') {
    return { ok: false, code: 'task_signature_required' };
  }

  const candidate = body as Record<string, unknown>;
  const docId = candidate.docId;
  const tenantId = candidate.tenantId;
  const actor = candidate.actor;
  const issuedAt = candidate.issuedAt;
  const signature = candidate.signature;

  if (
    typeof docId !== 'string' ||
    typeof tenantId !== 'string' ||
    actor === null ||
    typeof actor !== 'object'
  ) {
    return { ok: false, code: 'task_signature_required' };
  }

  const actorRecord = actor as Record<string, unknown>;
  const userId = actorRecord.userId;
  const ipAddress = actorRecord.ipAddress;
  const userAgent = actorRecord.userAgent;
  if (
    typeof userId !== 'string' ||
    typeof ipAddress !== 'string' ||
    typeof userAgent !== 'string'
  ) {
    return { ok: false, code: 'task_signature_required' };
  }

  const payloadBase = {
    docId,
    tenantId,
    actor: { userId, ipAddress, userAgent },
  };

  if (!secret) {
    if (requireSignature) {
      return { ok: false, code: 'task_signature_required' };
    }
    return {
      ok: true,
      payload: {
        ...payloadBase,
        issuedAt: typeof issuedAt === 'string' ? issuedAt : '',
        signature: typeof signature === 'string' ? signature : '',
      },
    };
  }

  if (typeof issuedAt !== 'string' || typeof signature !== 'string') {
    return { ok: false, code: 'task_signature_required' };
  }

  const canonical = canonicalPayloadForSigning({
    docId,
    tenantId,
    actor: { userId, ipAddress, userAgent },
    issuedAt,
  });
  const expectedSignature = signCanonicalPayload(canonical, secret);
  if (!signaturesMatch(expectedSignature, signature)) {
    return { ok: false, code: 'task_signature_invalid' };
  }

  const issuedAtMs = Date.parse(issuedAt);
  if (Number.isNaN(issuedAtMs)) {
    return { ok: false, code: 'task_signature_invalid' };
  }

  const maxAgeMs = options?.maxAgeMs ?? PDF_TABLE_ASSIST_TASK_SIGNATURE_MAX_AGE_MS;
  const nowMs = (options?.now ?? new Date()).getTime();
  if (nowMs - issuedAtMs > maxAgeMs) {
    return { ok: false, code: 'task_signature_expired' };
  }

  return {
    ok: true,
    payload: {
      docId,
      tenantId,
      actor: { userId, ipAddress, userAgent },
      issuedAt,
      signature,
    },
  };
}

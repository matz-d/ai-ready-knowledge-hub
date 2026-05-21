import { createHash, randomBytes } from 'node:crypto';
import type { FieldValue as FieldValueType } from '@google-cloud/firestore';
import type { Sensitivity } from '../../agents/curator/schema';
import { FieldValue, getFirestoreClient } from '../firestore';
import { resolveTenantIdFromAuth } from '../auth/resolveTenantIdFromAuth';
import type { FirestoreSourceKind } from '../firestoreSchema';
import type { ProcessingProfile } from '../processingProfile';

export const AUDIT_EVENTS_COLLECTION = 'auditEvents';

export type AuditEventAction =
  | 'document.import'
  | 'document.reimport'
  | 'document.convert'
  | 'document.view'
  | 'document.export'
  | 'document.delete'
  | 'chunk.access'
  | 'mask.override';

export type AuditDocumentSourceSubtype =
  | 'official-doc-pdf'
  | 'slide-pdf'
  | 'scan-pdf';

export type AuditConversionEvalStatus =
  | 'pass'
  | 'warn'
  | 'fail'
  | 'error';

/**
 * Known `document.convert` converter identifiers.
 *
 * - `pdf-parse`         : subtype 1 (official-doc-pdf), no Vertex.
 * - `gemini-direct-read`: subtype 2 (slide-pdf), Vertex Gemini success.
 * - `gemini-vertex-ocr` : subtype 3 (scan-pdf), Vertex Gemini OCR success (reserved).
 * - `pdf-parse-fallback`: PoC-only fallback path (no Vertex).
 *
 * Source of truth for inferenceDestination gating: docs/phase-3-h-3-direction.md §4.2.
 */
export type AuditConverterId =
  | 'pdf-parse'
  | 'gemini-direct-read'
  | 'gemini-vertex-ocr'
  | 'pdf-parse-fallback';

export function isVertexConverterId(converterId: AuditConverterId): boolean {
  return (
    converterId === 'gemini-direct-read' || converterId === 'gemini-vertex-ocr'
  );
}

export type AuditEventConversion = {
  converterId: AuditConverterId;
  sourceSubtype: AuditDocumentSourceSubtype;
  evalStatus: AuditConversionEvalStatus;
  /**
   * Gemini OCR `piiFindings` with `maskability === 'unmaskable'` (scan-pdf
   * `gemini-vertex-ocr` success only). Not heuristic DLP or Masker output.
   * Validated at write time by {@link assertConversionUnmaskablePiiFindingsInvariant}.
   */
  unmaskablePiiFindings?: {
    count: number;
  };
};

export type AuditEventResult = 'success' | 'failure' | 'partial';

export type AuditProcessingProfile = ProcessingProfile;

/**
 * Minimal audit shape for Vertex inference destinations (matches Phase 3-E §6.1).
 *
 * Required on `document.convert` iff conversion.sourceSubtype is slide-pdf /
 * scan-pdf AND conversion.converterId is a Vertex-calling converter. See
 * {@link assertConversionInferenceDestinationInvariant}.
 */
export type AuditInferenceDestination = {
  vendor: 'vertex';
  region: string;
  model: string;
};

/** Thrown by {@link assertConversionInferenceDestinationInvariant} on wiring violations. */
export class ConversionInferenceDestinationInvariantError extends Error {
  override readonly name = 'ConversionInferenceDestinationInvariantError';

  constructor(message: string) {
    super(message);
  }
}

/**
 * Enforce the spec from docs/phase-3-h-3-direction.md §4.2 at the audit
 * boundary. `inferenceDestination` MUST be present iff
 * (sourceSubtype is slide-pdf or scan-pdf) AND converterId calls Vertex.
 *
 * Throws when:
 *   - inferenceDestination is set but converterId is not a Vertex converter
 *     (e.g. pdf-parse / pdf-parse-fallback)
 *   - inferenceDestination is set but sourceSubtype is official-doc-pdf
 *   - inferenceDestination is missing on slide-pdf/scan-pdf + Vertex converter
 */
export function assertConversionInferenceDestinationInvariant(input: {
  conversion: AuditEventConversion;
  inferenceDestination: AuditInferenceDestination | undefined;
}): void {
  const subtypeRequiresVertex =
    input.conversion.sourceSubtype === 'slide-pdf' ||
    input.conversion.sourceSubtype === 'scan-pdf';
  const vertex = isVertexConverterId(input.conversion.converterId);
  const requireInferenceDestination = subtypeRequiresVertex && vertex;

  if (requireInferenceDestination && !input.inferenceDestination) {
    throw new ConversionInferenceDestinationInvariantError(
      `document.convert: inferenceDestination is required for converterId=${input.conversion.converterId} on sourceSubtype=${input.conversion.sourceSubtype}`
    );
  }
  if (!requireInferenceDestination && input.inferenceDestination) {
    throw new ConversionInferenceDestinationInvariantError(
      `document.convert: inferenceDestination must not be set for converterId=${input.conversion.converterId} on sourceSubtype=${input.conversion.sourceSubtype}`
    );
  }
}

/** Thrown by {@link assertConversionUnmaskablePiiFindingsInvariant} on wiring violations. */
export class ConversionUnmaskablePiiFindingsInvariantError extends Error {
  override readonly name = 'ConversionUnmaskablePiiFindingsInvariantError';

  constructor(message: string) {
    super(message);
  }
}

/**
 * Enforce scan-pdf Vertex OCR audit metadata at the `document.convert` boundary.
 *
 * `conversion.unmaskablePiiFindings.count` MUST be present iff
 * sourceSubtype is scan-pdf, converterId is gemini-vertex-ocr, and result is
 * success or partial (eval-driven partial counts as success-like).
 *
 * MUST NOT be set on official-doc-pdf, slide-pdf, pdf-parse, or
 * pdf-parse-fallback paths.
 */
export function assertConversionUnmaskablePiiFindingsInvariant(input: {
  conversion: AuditEventConversion;
  result: AuditEventResult;
}): void {
  const vertexOcrSuccessPath =
    input.conversion.sourceSubtype === 'scan-pdf' &&
    input.conversion.converterId === 'gemini-vertex-ocr';
  const successLike =
    input.result === 'success' || input.result === 'partial';
  const requireCount = vertexOcrSuccessPath && successLike;
  const count = input.conversion.unmaskablePiiFindings?.count;

  if (requireCount && count === undefined) {
    throw new ConversionUnmaskablePiiFindingsInvariantError(
      `document.convert: conversion.unmaskablePiiFindings.count is required for converterId=${input.conversion.converterId} on sourceSubtype=${input.conversion.sourceSubtype} with result=${input.result}`
    );
  }
  if (!vertexOcrSuccessPath && input.conversion.unmaskablePiiFindings !== undefined) {
    throw new ConversionUnmaskablePiiFindingsInvariantError(
      `document.convert: conversion.unmaskablePiiFindings must not be set for converterId=${input.conversion.converterId} on sourceSubtype=${input.conversion.sourceSubtype}`
    );
  }
}

export type AuditDataResidency = {
  storage: string;
  processing: string;
};

export type AuditMaskingMetrics = {
  detected: number;
  replaced: number;
  falsePositiveReviewed: number;
};

export type AuditEventWrite = {
  eventId: string;
  occurredAt: FieldValueType;
  tenantId: string;
  actor: {
    userId: string;
    ipAddress: string;
    userAgent: string;
  };
  action: AuditEventAction;
  target: {
    docId: string;
    fileName: string;
    sourceKind: FirestoreSourceKind;
    externalSourceFileId?: string;
    sensitivity: Sensitivity | 'Unknown';
  };
  result: AuditEventResult;
  errorCode?: string;
  processingProfile?: AuditProcessingProfile;
  purposeBinding?: string;
  ruleSetVersion?: string;
  maskingMetrics?: AuditMaskingMetrics;
  /**
   * Required on `document.convert` iff conversion.sourceSubtype is slide-pdf /
   * scan-pdf AND conversion.converterId calls Vertex Gemini (Phase 3-H-3 §4.2).
   * Validated at write time by {@link assertConversionInferenceDestinationInvariant}.
   */
  inferenceDestination?: AuditInferenceDestination;
  conversion?: AuditEventConversion;
  dataResidency?: AuditDataResidency;
};

export type RecordAuditEventInput = Omit<
  AuditEventWrite,
  'eventId' | 'occurredAt'
>;

function createTimeSortableEventId(now = new Date()): string {
  const timestamp = now.getTime().toString(36).padStart(9, '0');
  const entropy = randomBytes(8).toString('hex');
  return `${timestamp}-${entropy}`;
}

export function normalizePurposeForBinding(purpose: string): string {
  return purpose.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function createPurposeBinding(input: {
  purpose: string;
  tenantId: string;
  timestamp: string;
}): string {
  const normalizedPurpose = normalizePurposeForBinding(input.purpose);
  const material = JSON.stringify({
    version: 1,
    purpose: normalizedPurpose,
    tenantId: input.tenantId,
    timestamp: input.timestamp,
  });
  const digest = createHash('sha256').update(material, 'utf8').digest('hex');
  return `pb_sha256_${digest}`;
}

export function ipAddressFromHeaders(headers: Headers): string {
  const forwardedFor = headers.get('x-forwarded-for')?.trim();
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown';
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

export function userAgentFromHeaders(headers: Headers): string {
  return headers.get('user-agent')?.trim() || 'unknown';
}

export function auditActorFromRequest(request: Request): {
  tenantId: string;
  actor: AuditEventWrite['actor'];
} {
  const auth = resolveTenantIdFromAuth(request, {
    allowLocalFallback: process.env.AUTH_MODE !== 'iap',
    tenantIdOverride: process.env.KNOWLEDGE_HUB_TENANT_ID,
  });
  return {
    tenantId: auth.tenantId,
    actor: {
      userId: auth.actor.userId,
      ipAddress: ipAddressFromHeaders(request.headers),
      userAgent: userAgentFromHeaders(request.headers),
    },
  };
}

export async function recordAuditEvent(
  input: RecordAuditEventInput
): Promise<string> {
  if (input.action === 'document.convert' && input.conversion) {
    assertConversionInferenceDestinationInvariant({
      conversion: input.conversion,
      inferenceDestination: input.inferenceDestination,
    });
    assertConversionUnmaskablePiiFindingsInvariant({
      conversion: input.conversion,
      result: input.result,
    });
  }

  const db = getFirestoreClient();
  const eventId = createTimeSortableEventId();
  const body: AuditEventWrite = {
    ...input,
    eventId,
    occurredAt: FieldValue.serverTimestamp(),
  };

  await db.collection(AUDIT_EVENTS_COLLECTION).doc(eventId).create(body);
  return eventId;
}

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
  | 'document.view'
  | 'document.export'
  | 'document.delete'
  | 'chunk.access'
  | 'mask.override';

export type AuditEventResult = 'success' | 'failure' | 'partial';

export type AuditProcessingProfile = ProcessingProfile;

export type AuditInferenceDestination = {
  vendor: 'vertex';
  region: string;
  model: string;
};

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
  inferenceDestination?: AuditInferenceDestination;
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

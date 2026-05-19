import { Timestamp } from '@google-cloud/firestore';
import type { DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import {
  AiUsePolicyEnum,
  BusinessDomainEnum,
  DocumentTypeEnum,
  FreshnessEnum,
  SensitivityEnum,
} from '../agents/curator/schema';
import {
  FIRESTORE_DOCUMENT_SCHEMA_VERSION,
  type FirestoreDocument,
} from './firestoreSchema';

const timestampLikeSchema = z.union([
  z.instanceof(Timestamp),
  z.date(),
  z.string(),
]);

const sourceKindLikeSchema = z.enum(['upload', 'google_workspace']);
const workspaceMimeTypeLikeSchema = z.enum([
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.document',
]);
const exportMimeTypeLikeSchema = z.enum([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/markdown',
]);

const externalSourceLikeSchema = z.object({
  provider: z.literal('google_drive'),
  workspaceMimeType: workspaceMimeTypeLikeSchema,
  fileId: z.string(),
  name: z.string(),
  webViewLink: z.string().optional(),
  modifiedTime: z.string().optional(),
  importedAt: z.string(),
  exportedAt: z.string(),
  exportMimeType: exportMimeTypeLikeSchema,
});

const firestoreErrorBlockSchema = z.object({
  message: z.string(),
  occurredAt: timestampLikeSchema,
});

const firestoreCuratorBlockSchema = z.object({
  documentType: DocumentTypeEnum,
  businessDomain: BusinessDomainEnum,
  sensitivity: SensitivityEnum,
  freshness: FreshnessEnum,
  isAuthoritativeCandidate: z.boolean(),
  aiUsePolicy: AiUsePolicyEnum,
  rationale: z.string(),
  completedAt: timestampLikeSchema,
  modelId: z.string(),
});

const firestoreMaskerBlockSchema = z.object({
  decision: z.enum(['ai_safe_ready', 'restricted_promoted']),
  provider: z.enum(['simple-rule', 'cloud-dlp']),
  maskedSpansCount: z.number(),
  ruleHits: z.record(z.string(), z.number()),
  residualRisk: z.object({
    detected: z.boolean(),
    reasons: z.array(z.string()),
  }),
  rationale: z.string(),
  recommendedSensitivity: z.enum(['Confidential', 'Restricted']),
  sourceContentHash: z.string(),
  aiSafeSchemaVersion: z.literal(1),
  completedAt: timestampLikeSchema,
  modelId: z.string(),
});

const firestoreDocumentStatusSchema = z.enum([
  'uploaded',
  'curating',
  'masking',
  'curated',
  'blocked',
  'ai_safe',
  'restricted',
  'failed',
]);

/**
 * Firestore `documents/{id}` の生データを {@link FirestoreDocument} 相当として検証する。
 * 盲 `as` より前に呼び、破損・型ずれを Zod で早期に落とす。
 */
const firestoreDocumentDataSchema = z
  .object({
    id: z.string().optional(),
    schemaVersion: z.literal(FIRESTORE_DOCUMENT_SCHEMA_VERSION),
    fileName: z.string(),
    contentType: z.string(),
    byteSize: z.number(),
    contentSha256: z.string(),
    sourceKind: sourceKindLikeSchema,
    externalSource: z.union([z.null(), externalSourceLikeSchema]),
    storagePath: z.string(),
    aiSafeStoragePath: z.string().nullable(),
    status: firestoreDocumentStatusSchema,
    createdAt: timestampLikeSchema,
    updatedAt: timestampLikeSchema,
    documentType: DocumentTypeEnum.nullable(),
    businessDomain: BusinessDomainEnum.nullable(),
    sensitivity: SensitivityEnum.nullable(),
    freshness: FreshnessEnum.nullable(),
    isAuthoritativeCandidate: z.boolean().nullable(),
    aiUsePolicy: AiUsePolicyEnum.nullable(),
    sensitivitySource: z.enum(['curator', 'masker']).nullable(),
    originalCuratorSensitivity: SensitivityEnum.nullable(),
    sensitivityReason: z.string().nullable(),
    curator: z.union([z.null(), firestoreCuratorBlockSchema]),
    curatorError: z.union([z.null(), firestoreErrorBlockSchema]),
    masker: z.union([z.null(), firestoreMaskerBlockSchema]),
    maskerError: z.union([z.null(), firestoreErrorBlockSchema]),
    maskingPending: z.boolean().nullable().optional(),
    conversionError: z.union([z.null(), firestoreErrorBlockSchema]).optional(),
  })
  .passthrough();

export function parseFirestoreDocumentData(data: unknown): FirestoreDocument {
  return firestoreDocumentDataSchema.parse(data) as FirestoreDocument;
}

export function parseFirestoreDocumentSnapshot(
  snapshot: DocumentSnapshot
): FirestoreDocument {
  const data = snapshot.data();
  if (data == null) {
    throw new Error(`Firestore document ${snapshot.id} has no payload.`);
  }
  return parseFirestoreDocumentData({
    ...data,
    id: snapshot.id,
  });
}

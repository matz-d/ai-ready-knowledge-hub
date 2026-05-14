import type { Timestamp } from '@google-cloud/firestore';
import type { ResidualRiskOutputResult } from '../agents/masker/schema';
import { DOCUMENTS_COLLECTION } from './documents';
import { getFirestoreClient } from './firestore';
import type {
  FirestoreCuratorBlock,
  FirestoreDocument,
  FirestoreDocumentStatus,
  FirestoreMaskerBlock,
} from './firestoreSchema';
import type { InventoryDocument } from './inventory';
import { parseFirestoreDocumentSnapshot } from './parseFirestoreDocumentData';

const INVENTORY_TERMINAL_STATUSES = new Set<FirestoreDocumentStatus>([
  'curated',
  'blocked',
  'ai_safe',
  'restricted',
]);

type TimestampLike = Timestamp | Date | string | null | undefined;

function timestampToIso(value: TimestampLike): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return value.toDate().toISOString();
}

function serializeCuratorBlock(curator: FirestoreCuratorBlock) {
  return {
    documentType: curator.documentType,
    businessDomain: curator.businessDomain,
    sensitivity: curator.sensitivity,
    freshness: curator.freshness,
    isAuthoritativeCandidate: curator.isAuthoritativeCandidate,
    aiUsePolicy: curator.aiUsePolicy,
    rationale: curator.rationale,
    completedAt: timestampToIso(curator.completedAt) ?? '',
    modelId: curator.modelId,
  };
}

function serializeMaskerBlock(masker: FirestoreMaskerBlock) {
  return {
    decision: masker.decision,
    provider: masker.provider,
    maskedSpansCount: masker.maskedSpansCount,
    ruleHits: masker.ruleHits,
    residualRisk: masker.residualRisk,
    rationale: masker.rationale,
    recommendedSensitivity: masker.recommendedSensitivity,
    completedAt: timestampToIso(masker.completedAt) ?? '',
    modelId: masker.modelId,
  };
}

function maskerEvaluationFromBlock(
  masker: FirestoreMaskerBlock | null
): ResidualRiskOutputResult | undefined {
  if (!masker) return undefined;
  return {
    residualRisk: masker.residualRisk,
    recommendedSensitivity: masker.recommendedSensitivity,
    rationale: masker.rationale,
  };
}

/**
 * Converts one Firestore `documents/{docId}` metadata document into the shared
 * Inventory row shape. Non-terminal or incomplete documents are intentionally
 * skipped because the UI/export layer requires finalized effective fields.
 */
export function adaptFirestoreDocumentToInventory(
  snapshotId: string,
  doc: FirestoreDocument
): InventoryDocument | null {
  if (!INVENTORY_TERMINAL_STATUSES.has(doc.status)) {
    return null;
  }

  if (
    doc.documentType == null ||
    doc.businessDomain == null ||
    doc.sensitivity == null ||
    doc.freshness == null ||
    doc.isAuthoritativeCandidate == null ||
    doc.aiUsePolicy == null ||
    doc.sensitivitySource == null ||
    doc.curator == null
  ) {
    return null;
  }

  if ((doc.status === 'ai_safe' || doc.status === 'restricted') && doc.masker == null) {
    return null;
  }

  return {
    id: doc.id || snapshotId,
    fileName: doc.fileName,
    sourcePath: doc.storagePath,
    storagePath: doc.storagePath,
    aiSafeStoragePath: doc.aiSafeStoragePath ?? undefined,
    status: doc.status,
    createdAt: timestampToIso(doc.createdAt),
    updatedAt: timestampToIso(doc.updatedAt),
    documentType: doc.documentType,
    businessDomain: doc.businessDomain,
    sensitivity: doc.sensitivity,
    freshness: doc.freshness,
    isAuthoritativeCandidate: doc.isAuthoritativeCandidate,
    aiUsePolicy: doc.aiUsePolicy,
    rationale: doc.curator.rationale,
    sensitivitySource: doc.sensitivitySource,
    originalCuratorSensitivity: doc.originalCuratorSensitivity ?? undefined,
    sensitivityReason: doc.sensitivityReason ?? undefined,
    curator: serializeCuratorBlock(doc.curator),
    masker: doc.masker ? serializeMaskerBlock(doc.masker) : undefined,
    maskerEvaluation: maskerEvaluationFromBlock(doc.masker),
    sourceKind: doc.sourceKind,
    externalSourceFileId: doc.externalSource?.fileId,
    externalSourceWebViewLink: doc.externalSource?.webViewLink,
  };
}

export async function listInventoryDocumentsFromFirestore(
  limit = 100
): Promise<InventoryDocument[]> {
  const snapshot = await getFirestoreClient()
    .collection(DOCUMENTS_COLLECTION)
    .orderBy('updatedAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.flatMap((docSnapshot) => {
    try {
      const parsed = parseFirestoreDocumentSnapshot(docSnapshot);
      const row = adaptFirestoreDocumentToInventory(docSnapshot.id, parsed);
      return row ? [row] : [];
    } catch (error: unknown) {
      const isZodError =
        error instanceof Error &&
        error.name === 'ZodError' &&
        'issues' in error &&
        Array.isArray((error as { issues: unknown[] }).issues);
      if (isZodError) {
        const zodError = error as { name: string; issues: Array<{ path: unknown[]; message: string }> };
        const firstIssue = zodError.issues[0];
        console.warn('[inventoryFirestore] skipping malformed document', {
          docId: docSnapshot.id,
          errorName: zodError.name,
          issueCount: zodError.issues.length,
          firstIssuePath: firstIssue?.path,
          firstIssueMessage: firstIssue?.message,
        });
      } else {
        console.warn('[inventoryFirestore] skipping malformed document', {
          docId: docSnapshot.id,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return [];
    }
  });
}

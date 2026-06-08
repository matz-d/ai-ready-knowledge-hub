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
    const isSafetyGateRestricted =
      doc.status === 'restricted' && doc.restrictionSource === 'safety_gate';
    if (!isSafetyGateRestricted) {
      return null;
    }
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
    ...(doc.restrictionSource === 'safety_gate'
      ? { restrictionSource: 'safety_gate' as const }
      : {}),
    curator: serializeCuratorBlock(doc.curator),
    masker: doc.masker ? serializeMaskerBlock(doc.masker) : undefined,
    maskerEvaluation: maskerEvaluationFromBlock(doc.masker),
    sourceKind: doc.sourceKind,
    externalSourceFileId: doc.externalSource?.fileId,
    externalSourceWebViewLink: doc.externalSource?.webViewLink,
    ...(doc.maskingPending === true ? { maskingPending: true } : {}),
  };
}

/**
 * 明示的に指定された docId 群を terminal 解決した結果。
 *
 * `listInventoryDocumentsFromFirestore` は非 terminal / 破損ドキュメントを黙って
 * skip するため、「存在しない」と「存在するが terminal でない」を区別できない。
 * `/api/context-package` の strict docIds resolution はこの区別を必要とするので、
 * terminal filter の **前** の生 status を保持したまま 1 件ずつ分類する。
 */
export type ResolvedInventoryDocument =
  | { docId: string; outcome: 'terminal'; document: InventoryDocument }
  | { docId: string; outcome: 'non_terminal'; status: string }
  | { docId: string; outcome: 'unknown' };

/**
 * docId 群を Firestore から直接取得し、1 件ずつ terminal 解決する。
 *
 * `limit` で絞った最近のドキュメント一覧に依存しないため、指定された docId が
 * 最近のものでなくても確実に解決できる。順序は入力 docIds に合わせて返す。
 */
export async function resolveInventoryDocumentsByIds(
  docIds: string[]
): Promise<ResolvedInventoryDocument[]> {
  if (docIds.length === 0) {
    return [];
  }

  const db = getFirestoreClient();
  const refs = docIds.map((docId) =>
    db.collection(DOCUMENTS_COLLECTION).doc(docId)
  );
  const snapshots = await db.getAll(...refs);
  const snapshotById = new Map(snapshots.map((snap) => [snap.id, snap]));

  return docIds.map((docId): ResolvedInventoryDocument => {
    const snapshot = snapshotById.get(docId);
    if (!snapshot || !snapshot.exists) {
      return { docId, outcome: 'unknown' };
    }

    let parsed: FirestoreDocument;
    try {
      parsed = parseFirestoreDocumentSnapshot(snapshot);
    } catch {
      // 破損ドキュメントは利用不可なので非 terminal 扱いで透過的に通知する。
      return { docId, outcome: 'non_terminal', status: 'unparseable' };
    }

    if (!INVENTORY_TERMINAL_STATUSES.has(parsed.status)) {
      return { docId, outcome: 'non_terminal', status: parsed.status };
    }

    const document = adaptFirestoreDocumentToInventory(snapshot.id, parsed);
    if (!document) {
      // status は terminal だが必須フィールド欠落で使えない（status を添えて通知）。
      return { docId, outcome: 'non_terminal', status: parsed.status };
    }

    return { docId, outcome: 'terminal', document };
  });
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

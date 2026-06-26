import {
  toSerializableCurator,
  toSerializableMasker,
  type DocumentUploadSuccessResponse,
  type SerializableCuratorBlock,
  type SerializableMaskerBlock,
} from './documents';
import type {
  FirestoreCuratorBlock,
  FirestoreDocument,
  FirestoreDocumentStatus,
  FirestoreMaskerBlock,
} from './firestoreSchema';
import { timestampToIso } from './firestoreTimestamps';
import type { OrchestrateResult } from './uploadOrchestrator';

const UPLOAD_RESPONSE_TERMINAL_STATUSES = new Set<FirestoreDocumentStatus>([
  'curated',
  'blocked',
  'ai_safe',
  'restricted',
]);

function serializeFirestoreCurator(
  curator: FirestoreCuratorBlock
): SerializableCuratorBlock | null {
  const completedAt = timestampToIso(curator.completedAt);
  if (!completedAt) return null;

  return {
    documentType: curator.documentType,
    businessDomain: curator.businessDomain,
    sensitivity: curator.sensitivity,
    freshness: curator.freshness,
    isAuthoritativeCandidate: curator.isAuthoritativeCandidate,
    aiUsePolicy: curator.aiUsePolicy,
    rationale: curator.rationale,
    completedAt,
    modelId: curator.modelId,
  };
}

function serializeFirestoreMasker(
  masker: FirestoreMaskerBlock
): SerializableMaskerBlock | null {
  const completedAt = timestampToIso(masker.completedAt);
  if (!completedAt) return null;

  return {
    decision: masker.decision,
    provider: masker.provider,
    maskedSpansCount: masker.maskedSpansCount,
    ruleHits: masker.ruleHits,
    residualRisk: masker.residualRisk,
    rationale: masker.rationale,
    recommendedSensitivity: masker.recommendedSensitivity,
    completedAt,
    modelId: masker.modelId,
  };
}

export function documentUploadSuccessBodyFromFirestoreDocument(args: {
  doc: FirestoreDocument;
  ingestMeta: {
    kind: 'created' | 'overwritten';
    skipped?: boolean;
  };
}): DocumentUploadSuccessResponse | null {
  const { doc, ingestMeta } = args;
  if (!UPLOAD_RESPONSE_TERMINAL_STATUSES.has(doc.status)) {
    return null;
  }
  if (doc.curator == null) {
    return null;
  }
  if (doc.status === 'ai_safe' && (doc.masker == null || doc.aiSafeStoragePath == null)) {
    return null;
  }

  const curator = serializeFirestoreCurator(doc.curator);
  if (!curator) return null;

  const base = {
    docId: doc.id,
    fileName: doc.fileName,
    contentType: doc.contentType,
    byteSize: doc.byteSize,
    storagePath: doc.storagePath,
    status: doc.status as DocumentUploadSuccessResponse['status'],
    kind: ingestMeta.kind,
    ...(ingestMeta.skipped === true ? { skipped: true as const } : {}),
    curator,
  };

  if (doc.status === 'ai_safe') {
    const masker = serializeFirestoreMasker(doc.masker!);
    if (!masker) return null;
    return {
      ...base,
      aiSafeStoragePath: doc.aiSafeStoragePath!,
      masker,
    };
  }

  if (doc.status === 'restricted') {
    const masker = doc.masker ? serializeFirestoreMasker(doc.masker) : null;
    return {
      ...base,
      ...(masker ? { masker } : {}),
      ...(doc.sensitivityReason ? { sensitivityReason: doc.sensitivityReason } : {}),
      ...(doc.originalCuratorSensitivity
        ? { originalCuratorSensitivity: doc.originalCuratorSensitivity }
        : {}),
    };
  }

  if (doc.status === 'curated' && doc.maskingPending === true) {
    return { ...base, maskingPending: true };
  }

  return base;
}

/**
 * `POST /api/documents` 成功時ボディ。HTTP 境界と orchestrator の橋渡しのみ（副作用なし）。
 */
export function documentUploadSuccessBodyFromOrchestrate(args: {
  displayName: string;
  contentType: string;
  byteSize: number;
  modelId: string;
  result: OrchestrateResult;
  ingestMeta: {
    kind: 'created' | 'overwritten';
    skipped?: boolean;
  };
}): DocumentUploadSuccessResponse {
  const { displayName, contentType, byteSize, modelId, result, ingestMeta } =
    args;
  const base = {
    docId: result.docId,
    fileName: displayName,
    contentType,
    byteSize,
    storagePath: result.storagePath,
    status: result.kind,
    kind: ingestMeta.kind,
    ...(ingestMeta.skipped === true ? { skipped: true as const } : {}),
    curator: toSerializableCurator(
      result.curator,
      modelId,
      result.curatorCompletedAt
    ),
  };

  if (result.kind === 'ai_safe') {
    return {
      ...base,
      aiSafeStoragePath: result.aiSafeStoragePath,
      masker: toSerializableMasker(result.masker),
    };
  }

  if (result.kind === 'restricted') {
    return {
      ...base,
      // Masker-promoted restrictions carry a masker block + original sensitivity.
      // Safety-gate restrictions (D-PROD-1, e.g. OCR unmaskable PII) carry neither.
      ...(result.masker ? { masker: toSerializableMasker(result.masker) } : {}),
      sensitivityReason: result.sensitivityReason,
      ...(result.originalCuratorSensitivity !== undefined
        ? { originalCuratorSensitivity: result.originalCuratorSensitivity }
        : {}),
    };
  }

  if (result.kind === 'curated' && result.maskingPending === true) {
    return { ...base, maskingPending: true };
  }

  return base;
}

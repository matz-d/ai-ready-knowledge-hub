import type {
  AiUsePolicy,
  BusinessDomain,
  DocumentType,
  Freshness,
  Sensitivity,
} from '../agents/curator/schema';
import { applyMaskerUpgrade } from '../agents/masker/upgrade';
import type { ResidualRiskOutputResult } from '../agents/masker/schema';
import type {
  DocumentLifecycleStatus,
  SerializableCuratorBlock,
  SerializableMaskerBlock,
} from './documents';

/** Stable UI / Context Package input shape (aligned with future Firestore metadata). */
export type InventoryDocument = {
  id: string;
  fileName: string;
  sourcePath?: string;
  storagePath?: string;
  aiSafeStoragePath?: string;
  status: DocumentLifecycleStatus;
  createdAt?: string;
  updatedAt?: string;
  documentType: DocumentType;
  businessDomain: BusinessDomain;
  sensitivity: Sensitivity;
  freshness: Freshness;
  isAuthoritativeCandidate: boolean;
  aiUsePolicy: AiUsePolicy;
  rationale: string;
  sensitivitySource: 'curator' | 'masker';
  originalCuratorSensitivity?: Sensitivity;
  sensitivityReason?: string;
  curator?: SerializableCuratorBlock;
  masker?: SerializableMaskerBlock;
  maskerEvaluation?: ResidualRiskOutputResult;
  aiSafeContent?: string;
  /** GCS read failed during Context Package assembly; row must not join included bodies. */
  contextPackageBodyLoadError?: string;
};

/** One row from `docs/w1-artifacts/inventory.snapshot.json` (historical artifact; do not mutate file). */
export type W1InventorySnapshotEntry = {
  documentType: DocumentType;
  businessDomain: BusinessDomain;
  sensitivity: Sensitivity;
  freshness: Freshness;
  isAuthoritativeCandidate: boolean;
  aiUsePolicy: AiUsePolicy;
  rationale: string;
  fileName: string;
  sourcePath?: string;
  maskerEvaluation?: ResidualRiskOutputResult;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSnapshotEntry(
  value: unknown,
  index: number
): W1InventorySnapshotEntry {
  if (!isRecord(value)) {
    throw new Error(`W1 snapshot entry ${index} must be an object`);
  }
  const fileName = value.fileName;
  if (typeof fileName !== 'string' || fileName.length === 0) {
    throw new Error(`W1 snapshot entry ${index} has invalid fileName`);
  }
  return value as W1InventorySnapshotEntry;
}

function documentId(index: number, fileName: string): string {
  return `w1-${index}-${fileName.replace(/[^\w.-]+/g, '_')}`;
}

function w1StatusFor(row: W1InventorySnapshotEntry): DocumentLifecycleStatus {
  if (row.maskerEvaluation?.recommendedSensitivity === 'Restricted') {
    return 'restricted';
  }
  if (row.maskerEvaluation?.recommendedSensitivity === 'Confidential') {
    return 'ai_safe';
  }
  if (row.aiUsePolicy === 'blocked') {
    return 'blocked';
  }
  if (row.aiUsePolicy === 'requires_masking') {
    return 'masking';
  }
  return 'curated';
}

/**
 * Converts raw W1 snapshot JSON into inventory rows and applies Masker Restricted
 * promotion when `maskerEvaluation.recommendedSensitivity === 'Restricted'`.
 */
export function adaptW1SnapshotEntries(raw: unknown): InventoryDocument[] {
  if (!Array.isArray(raw)) {
    throw new Error('W1 snapshot must be a JSON array');
  }

  return raw.map((entry, index) => {
    const row = parseSnapshotEntry(entry, index);
    const base: InventoryDocument = {
      id: documentId(index, row.fileName),
      fileName: row.fileName,
      sourcePath: row.sourcePath,
      storagePath: row.sourcePath,
      status: w1StatusFor(row),
      documentType: row.documentType,
      businessDomain: row.businessDomain,
      sensitivity: row.sensitivity,
      freshness: row.freshness,
      isAuthoritativeCandidate: row.isAuthoritativeCandidate,
      aiUsePolicy: row.aiUsePolicy,
      rationale: row.rationale,
      sensitivitySource: 'curator',
      maskerEvaluation: row.maskerEvaluation,
    };

    if (row.maskerEvaluation?.recommendedSensitivity === 'Restricted') {
      return applyMaskerUpgrade(base, row.maskerEvaluation);
    }

    return base;
  });
}

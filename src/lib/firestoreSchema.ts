import { createHash } from 'node:crypto';
import type { Timestamp } from '@google-cloud/firestore';
import type {
  AiUsePolicy,
  BusinessDomain,
  DocumentType,
  Freshness,
  Sensitivity,
} from '../agents/curator/schema';

export const FIRESTORE_DOCUMENT_SCHEMA_VERSION = 2 as const;

export type FirestoreDocumentStatus =
  | 'uploaded'
  | 'curating'
  | 'masking'
  | 'curated'
  | 'blocked'
  | 'ai_safe'
  | 'restricted'
  | 'failed';

export type SensitivitySource = 'curator' | 'masker';

export type FirestoreCuratorBlock = {
  documentType: DocumentType;
  businessDomain: BusinessDomain;
  sensitivity: Sensitivity;
  freshness: Freshness;
  isAuthoritativeCandidate: boolean;
  aiUsePolicy: AiUsePolicy;
  rationale: string;
  completedAt: Timestamp;
  modelId: string;
};

export type FirestoreMaskerBlock = {
  decision: 'ai_safe_ready' | 'restricted_promoted';
  provider: 'simple-rule' | 'cloud-dlp';
  maskedSpansCount: number;
  ruleHits: Record<string, number>;
  residualRisk: { detected: boolean; reasons: string[] };
  rationale: string;
  recommendedSensitivity: 'Confidential' | 'Restricted';
  sourceContentHash: string;
  aiSafeSchemaVersion: 1;
  completedAt: Timestamp;
  modelId: string;
};

export type FirestoreErrorBlock = {
  message: string;
  occurredAt: Timestamp;
};

export type FirestoreSourceKind = 'upload' | 'google_workspace';

/**
 * PDF subtype for uploaded documents.
 * Defined as a local string literal union to avoid circular imports:
 *   documentIr.ts → knowledgeChunkSchema.ts → firestoreSchema.ts
 */
export type FirestoreDocumentSourceSubtype =
  | 'official-doc-pdf'
  | 'slide-pdf'
  | 'scan-pdf'
  | 'office-native';

export type FirestoreWorkspaceMimeType =
  | 'application/vnd.google-apps.spreadsheet'
  | 'application/vnd.google-apps.document';

export type FirestoreExportMimeType =
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'text/markdown';

export type FirestoreExternalSource = {
  provider: 'google_drive';
  workspaceMimeType: FirestoreWorkspaceMimeType;
  fileId: string;
  name: string;
  webViewLink?: string;
  modifiedTime?: string;
  importedAt: string;
  exportedAt: string;
  exportMimeType: FirestoreExportMimeType;
};

export type FirestoreDocument = {
  id: string;
  schemaVersion: typeof FIRESTORE_DOCUMENT_SCHEMA_VERSION;
  fileName: string;
  contentType: string;
  byteSize: number;
  /** upload raw bytes または imported snapshot bytes の SHA256 */
  contentSha256: string;
  sourceKind: FirestoreSourceKind;
  /** PDF subtype (Phase 3-H-2 M1). Null for non-PDF uploads. */
  sourceSubtype?: FirestoreDocumentSourceSubtype | null;
  externalSource: FirestoreExternalSource | null;
  storagePath: string;
  aiSafeStoragePath: string | null;

  status: FirestoreDocumentStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;

  documentType: DocumentType | null;
  businessDomain: BusinessDomain | null;
  sensitivity: Sensitivity | null;
  freshness: Freshness | null;
  isAuthoritativeCandidate: boolean | null;
  aiUsePolicy: AiUsePolicy | null;
  sensitivitySource: SensitivitySource | null;
  originalCuratorSensitivity: Sensitivity | null;
  sensitivityReason: string | null;

  /**
   * PDF M1 flag: set to `true` when aiUsePolicy='requires_masking' and the
   * Masker has not yet processed this document (parked at status='curated').
   * Cleared (set to null or false) once Masker runs in a future phase.
   */
  maskingPending?: boolean | null;

  curator: FirestoreCuratorBlock | null;
  curatorError: FirestoreErrorBlock | null;
  masker: FirestoreMaskerBlock | null;
  maskerError: FirestoreErrorBlock | null;
  /** PDF conversion / DocumentIR write failures (Phase 3-H-2 M1). */
  conversionError?: FirestoreErrorBlock | null;
};

/**
 * Firestore `documents/{id}` から読み取った直後の raw 表現。
 * schemaVersion 2 では sourceKind / externalSource は必須。
 *
 * 用途は「DocumentSnapshot.data() を一旦受ける箱」だけ。
 * 業務ロジックは必ず FirestoreDocument（parsed shape）を使うこと。
 */
export type FirestoreRawDocumentShape = FirestoreDocument;

/**
 * Curator 入力として不変条件検証で実際に読まれるフィールドだけを満たせばよい。
 * - 終端更新前の検証では `Date` の completedAt を許容（Firestore 書き込みは serverTimestamp）
 * - Masker 終端の検証では文書に既存の curator ブロックがあるため `aiUsePolicy` のみのスタブ可
 */
export type FirestoreCuratorInvariantInput =
  | null
  | Pick<FirestoreCuratorBlock, 'aiUsePolicy'>
  | (Omit<FirestoreCuratorBlock, 'completedAt'> & {
      completedAt: Timestamp | Date;
    });

/** Masker は検証で decision / sourceContentHash が必須。completedAt などは参照しない。 */
export type FirestoreMaskerInvariantInput =
  | null
  | (Pick<FirestoreMaskerBlock, 'decision' | 'sourceContentHash'> &
      Partial<Omit<FirestoreMaskerBlock, 'decision' | 'sourceContentHash'>>);

export type FirestoreDocumentInvariantInput = Pick<
  FirestoreDocument,
  | 'sourceKind'
  | 'externalSource'
  | 'status'
  | 'contentSha256'
  | 'aiSafeStoragePath'
  | 'sensitivity'
  | 'aiUsePolicy'
  | 'sensitivitySource'
  | 'originalCuratorSensitivity'
  | 'sensitivityReason'
> & {
  curator: FirestoreCuratorInvariantInput;
  masker: FirestoreMaskerInvariantInput;
  /** Required for PDF M1 invariant: curated + requires_masking must have maskingPending:true. */
  maskingPending?: boolean | null;
};

/** Masker 終端状態の invariant 検証用（実ドキュメントにはフル curator が既に存在する）。 */
export function maskerTerminalCuratorInvariantStub(): Pick<
  FirestoreCuratorBlock,
  'aiUsePolicy'
> {
  return { aiUsePolicy: 'requires_masking' };
}

export type FirestoreDocumentTerminalStatus =
  | 'curated'
  | 'blocked'
  | 'ai_safe'
  | 'restricted'
  | 'failed';

export type FirestoreSchemaViolation = {
  path: string;
  message: string;
};

export function hashContentSha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function terminalStatusForCuratorPolicy(
  aiUsePolicy: AiUsePolicy
): 'curated' | 'blocked' | 'masking' {
  switch (aiUsePolicy) {
    case 'direct':
      return 'curated';
    case 'blocked':
      return 'blocked';
    case 'requires_masking':
      return 'masking';
  }
}

/**
 * Masker pipeline の decision を Firestore document の終端 status に変換する。
 * `terminalStatusForCuratorPolicy` の対称関数として使う。
 */
export function terminalStatusForMaskerDecision(
  decision: 'ai_safe_ready' | 'restricted_promoted'
): 'ai_safe' | 'restricted' {
  return decision === 'ai_safe_ready' ? 'ai_safe' : 'restricted';
}

export function validateFirestoreDocumentInvariants(
  doc: FirestoreDocumentInvariantInput
): FirestoreSchemaViolation[] {
  const violations: FirestoreSchemaViolation[] = [];

  const hasAiSafePath = doc.aiSafeStoragePath !== null;
  const isAiSafe = doc.status === 'ai_safe';
  const maskerDecision = doc.masker?.decision;
  if (hasAiSafePath !== (isAiSafe && maskerDecision === 'ai_safe_ready')) {
    violations.push({
      path: 'aiSafeStoragePath',
      message:
        'aiSafeStoragePath must exist only when status is ai_safe and masker.decision is ai_safe_ready.',
    });
  }

  if (doc.sensitivitySource === 'masker') {
    if (
      doc.originalCuratorSensitivity === null ||
      doc.sensitivity !== 'Restricted' ||
      doc.aiUsePolicy !== 'blocked' ||
      doc.status !== 'restricted'
    ) {
      violations.push({
        path: 'sensitivitySource',
        message:
          'masker-sourced sensitivity must be restricted, blocked, and retain originalCuratorSensitivity.',
      });
    }
  }

  if (
    doc.originalCuratorSensitivity !== null &&
    doc.sensitivitySource !== 'masker'
  ) {
    violations.push({
      path: 'originalCuratorSensitivity',
      message:
        'originalCuratorSensitivity is only set when sensitivitySource is masker.',
    });
  }

  if (
    (doc.status === 'curated' ||
      doc.status === 'blocked' ||
      doc.status === 'ai_safe' ||
      doc.status === 'restricted') &&
    doc.curator === null
  ) {
    violations.push({
      path: 'curator',
      message:
        'curator block is required for terminal status curated/blocked/ai_safe/restricted.',
    });
  }

  if (
    (doc.status === 'ai_safe' || doc.status === 'restricted') &&
    doc.masker === null
  ) {
    violations.push({
      path: 'masker',
      message: 'masker block is required when status is ai_safe or restricted.',
    });
  }

  if (
    doc.masker !== null &&
    (doc.curator === null || doc.curator.aiUsePolicy !== 'requires_masking')
  ) {
    violations.push({
      path: 'masker',
      message:
        'masker block requires a curator block whose aiUsePolicy is requires_masking.',
    });
  }

  if (doc.masker !== null && doc.masker.sourceContentHash !== doc.contentSha256) {
    violations.push({
      path: 'masker.sourceContentHash',
      message: 'masker.sourceContentHash must match contentSha256.',
    });
  }

  if (doc.status === 'curated') {
    const directOk = doc.curator?.aiUsePolicy === 'direct';
    // PDF M1: requires_masking PDFs are parked at curated with maskingPending:true
    const maskingPendingOk =
      doc.curator?.aiUsePolicy === 'requires_masking' && doc.maskingPending === true;
    if (!directOk && !maskingPendingOk) {
      violations.push({
        path: 'status',
        message:
          'status curated requires aiUsePolicy=direct, or requires_masking with maskingPending:true (PDF M1).',
      });
    }
  }

  if (doc.status === 'blocked' && doc.curator?.aiUsePolicy !== 'blocked') {
    violations.push({
      path: 'status',
      message: 'status blocked is only for curator.aiUsePolicy blocked.',
    });
  }

  if (
    doc.status === 'restricted' &&
    (doc.masker?.decision !== 'restricted_promoted' ||
      doc.sensitivitySource !== 'masker')
  ) {
    violations.push({
      path: 'status',
      message:
        'status restricted requires masker.decision restricted_promoted and sensitivitySource masker.',
    });
  }

  if (
    doc.status === 'restricted' &&
    (doc.sensitivityReason === null || doc.sensitivityReason.trim() === '')
  ) {
    violations.push({
      path: 'sensitivityReason',
      message: 'status restricted requires non-empty sensitivityReason.',
    });
  }

  if (
    doc.sourceKind !== 'upload' &&
    doc.sourceKind !== 'google_workspace'
  ) {
    violations.push({
      path: 'sourceKind',
      message: 'sourceKind must be one of upload or google_workspace.',
    });
  }

  const hasGoogleDriveExternalSource =
    doc.externalSource !== null &&
    doc.externalSource.provider === 'google_drive';
  if ((doc.sourceKind === 'google_workspace') !== hasGoogleDriveExternalSource) {
    violations.push({
      path: 'sourceKind',
      message:
        'sourceKind google_workspace requires externalSource provider google_drive, and upload requires externalSource null.',
    });
  }

  return violations;
}

/**
 * `validateFirestoreDocumentInvariants` の throwing wrapper。
 * Firestore に write する直前に呼び、不変条件違反を runtime error に倒す。
 * orchestrator や test から差し込むことを想定。
 */
export function assertFirestoreInvariants(
  doc: FirestoreDocumentInvariantInput
): void {
  const violations = validateFirestoreDocumentInvariants(doc);
  if (violations.length > 0) {
    const detail = violations
      .map((v) => `${v.path}: ${v.message}`)
      .join('; ');
    throw new Error(
      `Firestore document invariant violations: ${detail}`
    );
  }
}

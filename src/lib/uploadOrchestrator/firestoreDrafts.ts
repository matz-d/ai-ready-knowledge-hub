import type { DocumentReference, FieldValue as FieldValueType } from '@google-cloud/firestore';
import type { AiUsePolicy, CuratorOutputResult, Sensitivity } from '../../agents/curator/schema';
import { modelId as curatorModelId } from '../../agents/_shared/genkitClient';
import { applyMaskerUpgrade } from '../../agents/masker/upgrade';
import type { PipelineOutput } from '../../agents/masker/pipelineSchema';
import { FieldValue } from '../firestore';
import {
  FIRESTORE_DOCUMENT_SCHEMA_VERSION,
  assertFirestoreInvariants,
  type FirestoreExternalSource,
  type FirestoreDocument,
  type FirestoreDocumentSourceSubtype,
  type FirestoreMaskerBlock,
  type FirestoreMaskerInvariantInput,
  type SensitivitySource,
  type RestrictionSource,
} from '../firestoreSchema';
import type { MaskerSummary } from './types';

type FirestoreServerTimestamp = ReturnType<typeof FieldValue.serverTimestamp>;

/** Firestore `update` に渡す masker ブロック（completedAt は serverTimestamp）。 */
export type FirestoreMaskerWriteBlockDraft = {
  decision: FirestoreMaskerBlock['decision'];
  provider: FirestoreMaskerBlock['provider'];
  maskedSpansCount: number;
  ruleHits: FirestoreMaskerBlock['ruleHits'];
  residualRisk: FirestoreMaskerBlock['residualRisk'];
  rationale: FirestoreMaskerBlock['rationale'];
  recommendedSensitivity: FirestoreMaskerBlock['recommendedSensitivity'];
  sourceContentHash: string;
  aiSafeSchemaVersion: FirestoreMaskerBlock['aiSafeSchemaVersion'];
  completedAt: FirestoreServerTimestamp;
  modelId: string;
};

export type AiSafeTerminalFirestoreUpdateDraft = {
  status: 'ai_safe';
  updatedAt: FirestoreServerTimestamp;
  aiSafeStoragePath: string;
  masker: FirestoreMaskerWriteBlockDraft;
  maskerError: null;
};

export type RestrictedTerminalFirestoreUpdateDraft = {
  status: 'restricted';
  updatedAt: FirestoreServerTimestamp;
  aiSafeStoragePath: null;
  sensitivity: Sensitivity;
  aiUsePolicy: AiUsePolicy;
  sensitivitySource: SensitivitySource | null;
  originalCuratorSensitivity: Sensitivity | null;
  sensitivityReason: string | null;
  masker: FirestoreMaskerWriteBlockDraft;
  maskerError: null;
};

/**
 * Reason recorded on a document restricted by the OCR unmaskable-PII safety gate
 * (D-PROD-1). Records the OCR origin explicitly so Safety Review can distinguish
 * it from a Masker-promoted restriction.
 */
export const UNMASKABLE_PII_RESTRICTION_REASON =
  'unmaskable PII detected by OCR; document restricted before AI-readable terminal flow';

/**
 * Firestore `update` body for a safety-gate restriction (D-PROD-1). Unlike the
 * Masker-promoted restriction, no Masker runs: `masker` stays null, the effective
 * sensitivity provenance remains the Curator's (`sensitivitySource: 'curator'`),
 * `originalCuratorSensitivity` is null (no Masker upgrade happened), and the OCR
 * origin is recorded via `restrictionSource: 'safety_gate'` plus the reason.
 *
 * A dedicated draft (rather than loosening `RestrictedTerminalFirestoreUpdateDraft`
 * to a nullable masker) keeps the Masker-promoted path's type strict.
 */
export type SafetyGateRestrictedFirestoreUpdateDraft = {
  status: 'restricted';
  updatedAt: FirestoreServerTimestamp;
  aiSafeStoragePath: null;
  sensitivity: Sensitivity;
  aiUsePolicy: AiUsePolicy;
  sensitivitySource: 'curator';
  originalCuratorSensitivity: null;
  sensitivityReason: string;
  masker: null;
  maskerError: null;
  restrictionSource: RestrictionSource;
};

/** Firestore 初回 `set` 用の合成ドキュメント（create 時は serverTimestamp を createdAt/updatedAt に共有）。 */
export type FirestoreInitialDocumentDraft = {
  id: string;
  schemaVersion: typeof FIRESTORE_DOCUMENT_SCHEMA_VERSION;
  fileName: string;
  contentType: string;
  byteSize: number;
  contentSha256: string;
  sourceKind: 'upload' | 'google_workspace';
  /** PDF subtype — null for non-PDF uploads (Phase 3-H-2 M1). */
  sourceSubtype: FirestoreDocumentSourceSubtype | null;
  externalSource: FirestoreExternalSource | null;
  storagePath: string;
  aiSafeStoragePath: null;
  status: 'uploaded';
  createdAt: FieldValueType | FirestoreDocument['createdAt'];
  updatedAt: FieldValueType;
  documentType: null;
  businessDomain: null;
  sensitivity: null;
  freshness: null;
  isAuthoritativeCandidate: null;
  aiUsePolicy: null;
  sensitivitySource: null;
  originalCuratorSensitivity: null;
  sensitivityReason: null;
  curator: null;
  curatorError: null;
  masker: null;
  maskerError: null;
  conversionError: null;
};
type CuratorContextForMasker = {
  sensitivity: CuratorOutputResult['sensitivity'];
  aiUsePolicy: CuratorOutputResult['aiUsePolicy'];
  businessDomain: CuratorOutputResult['businessDomain'];
};

type EffectiveSnapshotForUpgrade = Parameters<typeof applyMaskerUpgrade>[0];

export type RunMaskerArgs = {
  docRef: DocumentReference;
  docId: string;
  fileName: string;
  content: string;
  contentSha256: string;
  sourceKind: FirestoreInitialDocumentDraft['sourceKind'];
  externalSource: FirestoreInitialDocumentDraft['externalSource'];
  aiSafeStoragePath: string;
  curatorContext: CuratorContextForMasker;
  /** Curator が書いた直後の effective fields。applyMaskerUpgrade に渡す土台。 */
  curatorEffectiveSnapshot: EffectiveSnapshotForUpgrade;
};

export function buildMaskerInvariantInputFromPipeline(
  pipeline: PipelineOutput,
  contentSha256: string
): Exclude<FirestoreMaskerInvariantInput, null> {
  return {
    decision: pipeline.decision,
    sourceContentHash: contentSha256,
    provider: pipeline.maskingResult.provider,
    maskedSpansCount: pipeline.maskingResult.maskedSpans.length,
    ruleHits: pipeline.maskingResult.ruleHits,
    residualRisk: pipeline.rawRiskOutput.residualRisk,
    rationale: pipeline.rawRiskOutput.rationale,
    recommendedSensitivity: pipeline.rawRiskOutput.recommendedSensitivity,
    aiSafeSchemaVersion: 1,
    modelId: curatorModelId,
  };
}

function buildMaskerWriteBlockDraft(
  pipeline: PipelineOutput,
  contentSha256: string
): FirestoreMaskerWriteBlockDraft {
  return {
    decision: pipeline.decision,
    provider: pipeline.maskingResult.provider,
    maskedSpansCount: pipeline.maskingResult.maskedSpans.length,
    ruleHits: pipeline.maskingResult.ruleHits,
    residualRisk: pipeline.rawRiskOutput.residualRisk,
    rationale: pipeline.rawRiskOutput.rationale,
    recommendedSensitivity: pipeline.rawRiskOutput.recommendedSensitivity,
    sourceContentHash: contentSha256,
    aiSafeSchemaVersion: 1,
    completedAt: FieldValue.serverTimestamp(),
    modelId: curatorModelId,
  };
}

export function maskerSummaryFromPipeline(pipeline: PipelineOutput): MaskerSummary {
  return {
    decision: pipeline.decision,
    provider: pipeline.maskingResult.provider,
    maskedSpansCount: pipeline.maskingResult.maskedSpans.length,
    ruleHits: pipeline.maskingResult.ruleHits,
    residualRisk: pipeline.rawRiskOutput.residualRisk,
    rationale: pipeline.rawRiskOutput.rationale,
    recommendedSensitivity: pipeline.rawRiskOutput.recommendedSensitivity,
    completedAt: new Date(),
    modelId: curatorModelId,
  };
}

/**
 * status='ai_safe' に倒す Firestore update body を組み立てる。
 * 効力ある top-level fields は Curator 由来のまま（昇格なし）、aiSafeStoragePath / masker block を書く。
 */
export function buildAiSafeFirestoreUpdate(
  args: Pick<RunMaskerArgs, 'aiSafeStoragePath' | 'contentSha256'>,
  pipeline: PipelineOutput
): AiSafeTerminalFirestoreUpdateDraft {
  if (pipeline.decision !== 'ai_safe_ready') {
    throw new Error('buildAiSafeFirestoreUpdate requires decision=ai_safe_ready');
  }
  return {
    status: 'ai_safe',
    updatedAt: FieldValue.serverTimestamp(),
    aiSafeStoragePath: args.aiSafeStoragePath,
    masker: buildMaskerWriteBlockDraft(pipeline, args.contentSha256),
    maskerError: null,
  };
}

/**
 * status='restricted' に倒す Firestore update body を組み立てる。
 * applyMaskerUpgrade で得た effective top-level fields を spread し、masker block と
 * aiSafeStoragePath: null を書く（restricted は masked オブジェクトを作らない）。
 */
export function buildRestrictedFirestoreUpdate(
  args: Pick<RunMaskerArgs, 'contentSha256'>,
  pipeline: PipelineOutput,
  upgraded: EffectiveSnapshotForUpgrade
): RestrictedTerminalFirestoreUpdateDraft {
  if (pipeline.decision !== 'restricted_promoted') {
    throw new Error(
      'buildRestrictedFirestoreUpdate requires decision=restricted_promoted'
    );
  }
  return {
    status: 'restricted',
    updatedAt: FieldValue.serverTimestamp(),
    aiSafeStoragePath: null,
    sensitivity: upgraded.sensitivity,
    aiUsePolicy: upgraded.aiUsePolicy,
    sensitivitySource: upgraded.sensitivitySource ?? null,
    originalCuratorSensitivity: upgraded.originalCuratorSensitivity ?? null,
    sensitivityReason: upgraded.sensitivityReason ?? null,
    masker: buildMaskerWriteBlockDraft(pipeline, args.contentSha256),
    maskerError: null,
  };
}

/**
 * status='restricted' に倒す Firestore update body を組み立てる（D-PROD-1 安全ゲート版）。
 * Masker を経ないため masker は null、実効 sensitivity は Curator 由来のまま
 * （sensitivitySource='curator' / originalCuratorSensitivity=null）、OCR 由来を
 * restrictionSource='safety_gate' + sensitivityReason で明示する。
 */
export function buildSafetyGateRestrictedFirestoreUpdate(args: {
  sensitivity: Sensitivity;
  aiUsePolicy: AiUsePolicy;
  reason: string;
}): SafetyGateRestrictedFirestoreUpdateDraft {
  return {
    status: 'restricted',
    updatedAt: FieldValue.serverTimestamp(),
    aiSafeStoragePath: null,
    sensitivity: args.sensitivity,
    aiUsePolicy: args.aiUsePolicy,
    sensitivitySource: 'curator',
    originalCuratorSensitivity: null,
    sensitivityReason: args.reason,
    masker: null,
    maskerError: null,
    restrictionSource: 'safety_gate',
  };
}
function buildBaseInitialDocumentBody(args: {
  docId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  contentSha256: string;
  storagePath: string;
  sourceKind: FirestoreInitialDocumentDraft['sourceKind'];
  sourceSubtype?: FirestoreInitialDocumentDraft['sourceSubtype'];
  externalSource: FirestoreInitialDocumentDraft['externalSource'];
  createdAt?: FirestoreInitialDocumentDraft['createdAt'];
}): FirestoreInitialDocumentDraft {
  const now: FieldValueType = FieldValue.serverTimestamp();
  assertFirestoreInvariants({
    sourceKind: args.sourceKind,
    externalSource: args.externalSource,
    status: 'uploaded',
    contentSha256: args.contentSha256,
    aiSafeStoragePath: null,
    sensitivity: null,
    aiUsePolicy: null,
    sensitivitySource: null,
    originalCuratorSensitivity: null,
    sensitivityReason: null,
    curator: null,
    masker: null,
  });
  return {
    id: args.docId,
    schemaVersion: FIRESTORE_DOCUMENT_SCHEMA_VERSION,
    fileName: args.fileName,
    contentType: args.contentType,
    byteSize: args.byteSize,
    contentSha256: args.contentSha256,
    sourceKind: args.sourceKind,
    sourceSubtype: args.sourceSubtype ?? null,
    externalSource: args.externalSource,
    storagePath: args.storagePath,
    aiSafeStoragePath: null,
    status: 'uploaded',
    createdAt: args.createdAt ?? now,
    updatedAt: now,
    documentType: null,
    businessDomain: null,
    sensitivity: null,
    freshness: null,
    isAuthoritativeCandidate: null,
    aiUsePolicy: null,
    sensitivitySource: null,
    originalCuratorSensitivity: null,
    sensitivityReason: null,
    curator: null,
    curatorError: null,
    masker: null,
    maskerError: null,
    conversionError: null,
  };
}

export function buildUploadInitialDocumentBody(args: {
  docId: string;
  displayName: string;
  contentType: string;
  byteSize: number;
  contentSha256: string;
  storagePath: string;
  sourceSubtype?: FirestoreDocumentSourceSubtype | null;
}): FirestoreInitialDocumentDraft {
  return buildBaseInitialDocumentBody({
    docId: args.docId,
    fileName: args.displayName,
    contentType: args.contentType,
    byteSize: args.byteSize,
    contentSha256: args.contentSha256,
    storagePath: args.storagePath,
    sourceKind: 'upload',
    sourceSubtype: args.sourceSubtype ?? null,
    externalSource: null,
  });
}

export function buildImportedSnapshotInitialDocumentBody(args: {
  docId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  contentSha256: string;
  storagePath: string;
  externalSource: FirestoreExternalSource;
  createdAt?: FirestoreInitialDocumentDraft['createdAt'];
}): FirestoreInitialDocumentDraft {
  return buildBaseInitialDocumentBody({
    docId: args.docId,
    fileName: args.fileName,
    contentType: args.contentType,
    byteSize: args.byteSize,
    contentSha256: args.contentSha256,
    storagePath: args.storagePath,
    sourceKind: 'google_workspace',
    externalSource: args.externalSource,
    createdAt: args.createdAt,
  });
}

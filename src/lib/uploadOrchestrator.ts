import { randomUUID } from 'node:crypto';
import type { DocumentReference, FieldValue as FieldValueType } from '@google-cloud/firestore';
import type { CuratorOutputResult, AiUsePolicy, Sensitivity } from '../agents/curator/schema';
import { curatorFlow } from '../agents/curator/flow';
import { modelId as curatorModelId } from '../agents/_shared/genkitClient';
import { maskerPipelineFlow } from '../agents/masker/pipelineFlow';
import type { PipelineOutput } from '../agents/masker/pipelineSchema';
import { applyMaskerUpgrade } from '../agents/masker/upgrade';
import type { DocumentIr, DocumentSourceSubtype } from '../eval/conversion/documentIr';
import { documentIrToKnowledgeChunks } from '../eval/conversion/documentIrToKnowledgeChunk';
import { runConversionEvalHealthCheck } from '../eval/conversion/runConversionEvalHealthCheck';
import {
  DOCUMENTS_COLLECTION,
  buildRawObjectPath,
  sanitizeOriginalFileName,
} from './documents';
import { createConversionEvalStorage } from './conversionEvalStorage';
import { FieldValue, getFirestoreClient } from './firestore';
import {
  FIRESTORE_DOCUMENT_SCHEMA_VERSION,
  assertFirestoreInvariants,
  type FirestoreExternalSource,
  type FirestoreDocument,
  type FirestoreDocumentSourceSubtype,
  hashContentSha256,
  maskerTerminalCuratorInvariantStub,
  terminalStatusForCuratorPolicy,
  terminalStatusForMaskerDecision,
  type FirestoreMaskerBlock,
  type FirestoreMaskerInvariantInput,
  type SensitivitySource,
} from './firestoreSchema';
import {
  deleteMaskedObject,
  deleteRawObject,
  uploadMaskedObject,
  uploadRawObject,
  getKnowledgeHubBucketName,
} from './storage';
import {
  DOCUMENT_IR_GCS_VERSION,
  writeDocumentIrSnapshot,
} from './documentIrStorage';
import { createChunkFirestoreAdapter } from './chunkFirestoreAdapter';
import {
  ConversionInferenceDestinationInvariantError,
  recordAuditEvent,
  type AuditConversionEvalStatus,
  type AuditConverterId,
  type AuditDocumentSourceSubtype,
  type AuditEventWrite,
  type AuditInferenceDestination,
} from './audit/auditEvent';

/**
 * Audit metadata describing how a PDF was converted. Built at the route
 * boundary (next to the extractor) and threaded through the orchestrator so
 * the `document.convert` AuditEvent can carry the right `converterId` and
 * `inferenceDestination` per Phase 3-H-3 §4.2.
 *
 * For official-doc-pdf this defaults to `{ converterId: 'pdf-parse' }` (no
 * inferenceDestination). For slide-pdf / scan-pdf Vertex-success paths the
 * caller fills in `inferenceDestination`.
 */
export type PdfConversionAudit = {
  converterId: AuditConverterId;
  inferenceDestination?: AuditInferenceDestination;
};

const DEFAULT_PDF_CONVERSION_AUDIT: PdfConversionAudit = {
  converterId: 'pdf-parse',
};

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

// ─────────────────────────────────────────────────────────────────────
// 公開 API
// ─────────────────────────────────────────────────────────────────────

export type OrchestrateAuditContext = {
  tenantId: string;
  actor: AuditEventWrite['actor'];
};

export type OrchestrateInput = {
  displayName: string;
  contentType: string;
  buffer: Buffer;
  content: string;
  /**
   * Present when the file is a PDF (Phase 3-H-2 M1).
   * When set, orchestrator uses the PDF path instead of the text path.
   */
  documentIr?: DocumentIr;
  /** Required when documentIr is present. */
  sourceSubtype?: DocumentSourceSubtype;
  /** When set, PDF conversion records `document.convert` AuditEvent (Phase 3-H-2 M2). */
  auditContext?: OrchestrateAuditContext;
  /**
   * PDF conversion audit metadata (Phase 3-H-3 §4.2). Required by spec when
   * `documentIr` is set; defaults to `{ converterId: 'pdf-parse' }` for
   * backwards compatibility with subtype 1 callers that don't pass it yet.
   */
  conversion?: PdfConversionAudit;
};

export type MaskerSummary = {
  decision: 'ai_safe_ready' | 'restricted_promoted';
  provider: 'simple-rule' | 'cloud-dlp';
  maskedSpansCount: number;
  ruleHits: Record<string, number>;
  residualRisk: { detected: boolean; reasons: string[] };
  rationale: string;
  recommendedSensitivity: 'Confidential' | 'Restricted';
  completedAt: Date;
  modelId: string;
};

export type OrchestrateResult =
  | {
      kind: 'curated';
      docId: string;
      storagePath: string;
      curator: CuratorOutputResult;
      curatorCompletedAt: Date;
      /** True when the PDF was classified requires_masking and is parked (PDF M1). */
      maskingPending?: boolean;
    }
  | {
      kind: 'blocked';
      docId: string;
      storagePath: string;
      curator: CuratorOutputResult;
      curatorCompletedAt: Date;
    }
  | {
      kind: 'ai_safe';
      docId: string;
      storagePath: string;
      aiSafeStoragePath: string;
      curator: CuratorOutputResult;
      curatorCompletedAt: Date;
      masker: MaskerSummary;
    }
  | {
      kind: 'restricted';
      docId: string;
      storagePath: string;
      curator: CuratorOutputResult;
      curatorCompletedAt: Date;
      masker: MaskerSummary;
      sensitivityReason: string;
      originalCuratorSensitivity: NonNullable<CuratorOutputResult['sensitivity']>;
    };

export class CuratorPhaseError extends Error {
  constructor(public docId: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'CuratorPhaseError';
  }
}

export class MaskerPhaseError extends Error {
  constructor(public docId: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'MaskerPhaseError';
  }
}

export type RunCuratorAndMaskerLifecycleArgs = {
  docRef: DocumentReference;
  docId: string;
  displayName: string;
  content: string;
  contentSha256: string;
  sourceKind: FirestoreInitialDocumentDraft['sourceKind'];
  externalSource: FirestoreInitialDocumentDraft['externalSource'];
  storagePath: string;
  aiSafeStoragePath: string;
};

/**
 * [D] initial `set` の直後、`status='curating'` へ進める前の不変条件検査と Firestore update。
 * `externalSource` を省略すると upload 経路（`sourceKind: 'upload'`, `externalSource: null`）と同じ検査になる。
 */
export async function transitionDocumentToCurating(
  docRef: DocumentReference,
  contentSha256: string,
  externalSource?: FirestoreExternalSource | null
): Promise<void> {
  const resolvedExternalSource = externalSource ?? null;
  const sourceKind: FirestoreInitialDocumentDraft['sourceKind'] =
    resolvedExternalSource === null ? 'upload' : 'google_workspace';
  assertFirestoreInvariants({
    sourceKind,
    externalSource: resolvedExternalSource,
    status: 'curating',
    contentSha256,
    aiSafeStoragePath: null,
    sensitivity: null,
    aiUsePolicy: null,
    sensitivitySource: null,
    originalCuratorSensitivity: null,
    sensitivityReason: null,
    curator: null,
    masker: null,
  });
  await docRef.update({
    status: 'curating',
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Walking Skeleton の副作用順序を一手に握る orchestrator。
 *
 * Google Sheets 取り込みでは importedSnapshotOrchestrator が先に
 * [A] parseGoogleSheetsInput、[A'] fetchSheetsSnapshot、[B-pre] 正規化テキスト化を行い、
 * 以降は本関数と同じ [B]〜[H] の鎖に合流する。
 *
 * 段（アップロード直パスは [B] から）:
 *   [B] uploadRawObject — 生バイトを GCS raw へ
 *   [C] Firestore initial set — 失敗時 GCS rollback
 *   [D] Firestore update(curating) — 失敗時 GCS + Firestore set rollback
 *   [E][F] runCuratorPhase — curatorFlow + Firestore 終端（curated / blocked / masking）
 *   [G][H] runMaskerPhase — requires_masking のときのみ、ai_safe / restricted / failed 終端更新
 *
 * route.ts は本関数の戻り値を HTTP レスポンスへ整形するだけにする。
 */
export async function orchestrateUploadProcessing(
  input: OrchestrateInput
): Promise<OrchestrateResult> {
  const docId = randomUUID();
  const safeOriginalFileName = sanitizeOriginalFileName(input.displayName);
  const storagePath = buildRawObjectPath(docId, safeOriginalFileName);
  const aiSafeStoragePath = `masked/${docId}/${safeOriginalFileName}`;
  const contentSha256 = hashContentSha256(input.buffer);

  // [B] uploadRawObject — 生バイトを GCS raw へ
  await uploadRawObject(storagePath, input.buffer, input.contentType);

  const db = getFirestoreClient();
  const docRef = db.collection(DOCUMENTS_COLLECTION).doc(docId);

  // [C] Firestore initial set — uploaded 相当の初回フィールド
  try {
    await docRef.set(
      buildUploadInitialDocumentBody({
        docId,
        displayName: input.displayName,
        contentType: input.contentType,
        byteSize: input.buffer.length,
        contentSha256,
        storagePath,
        sourceSubtype: input.sourceSubtype ?? null,
      })
    );
  } catch (e) {
    await safeDeleteRawObject(storagePath);
    throw e;
  }

  // [D] Firestore update(curating) — エージェント段の直前に status を curating へ
  try {
    await transitionDocumentToCurating(docRef, contentSha256);
  } catch (e) {
    await safeDeleteRawObject(storagePath);
    await safeDeleteFirestoreDoc(docRef);
    throw e;
  }

  // PDF path (Phase 3-H-2 M1): curator + DocumentIR GCS write + optional chunking
  if (input.documentIr) {
    return orchestratePdfPath({
      docRef,
      docId,
      displayName: input.displayName,
      content: input.content,
      contentSha256,
      storagePath,
      documentIr: input.documentIr,
      auditContext: input.auditContext,
      conversion: input.conversion ?? DEFAULT_PDF_CONVERSION_AUDIT,
    });
  }

  return runCuratorAndMaskerLifecycle({
    docRef,
    docId,
    displayName: input.displayName,
    content: input.content,
    contentSha256,
    sourceKind: 'upload',
    externalSource: null,
    storagePath,
    aiSafeStoragePath,
  });
}

export async function runCuratorAndMaskerLifecycle(
  args: RunCuratorAndMaskerLifecycleArgs
): Promise<OrchestrateResult> {
  // [E][F] runCuratorPhase — curatorFlow + Firestore 終端更新（masking なら次段へ）
  let curatorOutput: { result: CuratorOutputResult; completedAt: Date };
  try {
    curatorOutput = await runCuratorPhase({
      docRef: args.docRef,
      displayName: args.displayName,
      content: args.content,
      contentSha256: args.contentSha256,
      sourceKind: args.sourceKind,
      externalSource: args.externalSource,
    });
  } catch (e) {
    throw new CuratorPhaseError(args.docId, e);
  }

  const curatorTerminal = terminalStatusForCuratorPolicy(
    curatorOutput.result.aiUsePolicy
  );

  if (curatorTerminal === 'curated' || curatorTerminal === 'blocked') {
    return {
      kind: curatorTerminal,
      docId: args.docId,
      storagePath: args.storagePath,
      curator: curatorOutput.result,
      curatorCompletedAt: curatorOutput.completedAt,
    };
  }

  // curatorTerminal === 'masking' — [G][H] runMaskerPhase へ
  let maskerOutcome: MaskerPhaseSuccess;
  try {
    maskerOutcome = await runMaskerPhase({
      docRef: args.docRef,
      docId: args.docId,
      fileName: args.displayName,
      content: args.content,
      contentSha256: args.contentSha256,
      sourceKind: args.sourceKind,
      externalSource: args.externalSource,
      aiSafeStoragePath: args.aiSafeStoragePath,
      curatorContext: {
        sensitivity: curatorOutput.result.sensitivity,
        aiUsePolicy: curatorOutput.result.aiUsePolicy,
        businessDomain: curatorOutput.result.businessDomain,
      },
      // applyMaskerUpgrade の入力は optional (undefined)。Firestore 側の null との
      // 境界変換は buildRestrictedFirestoreUpdate で `?? null` を当てて吸収する。
      curatorEffectiveSnapshot: {
        sensitivity: curatorOutput.result.sensitivity,
        aiUsePolicy: curatorOutput.result.aiUsePolicy,
        sensitivitySource: 'curator',
      },
    });
  } catch (e) {
    throw new MaskerPhaseError(args.docId, e);
  }

  if (maskerOutcome.kind === 'ai_safe') {
    return {
      kind: 'ai_safe',
      docId: args.docId,
      storagePath: args.storagePath,
      aiSafeStoragePath: args.aiSafeStoragePath,
      curator: curatorOutput.result,
      curatorCompletedAt: curatorOutput.completedAt,
      masker: maskerOutcome.summary,
    };
  }

  return {
    kind: 'restricted',
    docId: args.docId,
    storagePath: args.storagePath,
    curator: curatorOutput.result,
    curatorCompletedAt: curatorOutput.completedAt,
    masker: maskerOutcome.summary,
    sensitivityReason: maskerOutcome.sensitivityReason,
    originalCuratorSensitivity: curatorOutput.result.sensitivity,
  };
}

// ─────────────────────────────────────────────────────────────────────
// [E][F] Curator phase — runCuratorPhase
// ─────────────────────────────────────────────────────────────────────

async function runCuratorPhase(args: {
  docRef: DocumentReference;
  displayName: string;
  content: string;
  contentSha256: string;
  sourceKind: FirestoreInitialDocumentDraft['sourceKind'];
  externalSource: FirestoreInitialDocumentDraft['externalSource'];
}): Promise<{ result: CuratorOutputResult; completedAt: Date }> {
  try {
    const result = await curatorFlow({
      fileName: args.displayName,
      content: args.content,
    });
    const completedAt = new Date();
    const nextStatus = terminalStatusForCuratorPolicy(result.aiUsePolicy);
    assertFirestoreInvariants({
      sourceKind: args.sourceKind,
      externalSource: args.externalSource,
      status: nextStatus,
      contentSha256: args.contentSha256,
      aiSafeStoragePath: null,
      sensitivity: result.sensitivity,
      aiUsePolicy: result.aiUsePolicy,
      sensitivitySource: 'curator',
      originalCuratorSensitivity: null,
      sensitivityReason: null,
      curator: {
        documentType: result.documentType,
        businessDomain: result.businessDomain,
        sensitivity: result.sensitivity,
        freshness: result.freshness,
        isAuthoritativeCandidate: result.isAuthoritativeCandidate,
        aiUsePolicy: result.aiUsePolicy,
        rationale: result.rationale,
        completedAt: completedAt,
        modelId: curatorModelId,
      },
      masker: null,
    });
    await args.docRef.update({
      status: nextStatus,
      updatedAt: FieldValue.serverTimestamp(),
      documentType: result.documentType,
      businessDomain: result.businessDomain,
      sensitivity: result.sensitivity,
      freshness: result.freshness,
      isAuthoritativeCandidate: result.isAuthoritativeCandidate,
      aiUsePolicy: result.aiUsePolicy,
      sensitivitySource: 'curator',
      originalCuratorSensitivity: null,
      sensitivityReason: null,
      curator: {
        documentType: result.documentType,
        businessDomain: result.businessDomain,
        sensitivity: result.sensitivity,
        freshness: result.freshness,
        isAuthoritativeCandidate: result.isAuthoritativeCandidate,
        aiUsePolicy: result.aiUsePolicy,
        rationale: result.rationale,
        completedAt: FieldValue.serverTimestamp(),
        modelId: curatorModelId,
      },
      curatorError: null,
    });
    return { result, completedAt };
  } catch (e) {
    await recordPhaseFailure(args.docRef, 'curator', e);
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────
// [G][H] Masker phase — runMaskerPhase（requires_masking 時のパイプラインと終端更新）
// ─────────────────────────────────────────────────────────────────────

type CuratorContextForMasker = {
  sensitivity: CuratorOutputResult['sensitivity'];
  aiUsePolicy: CuratorOutputResult['aiUsePolicy'];
  businessDomain: CuratorOutputResult['businessDomain'];
};

type EffectiveSnapshotForUpgrade = Parameters<typeof applyMaskerUpgrade>[0];

type RunMaskerArgs = {
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

type MaskerPhaseSuccess =
  | { kind: 'ai_safe'; summary: MaskerSummary }
  | { kind: 'restricted'; summary: MaskerSummary; sensitivityReason: string };

/**
 * [G][H] Masker 段の処理の流れ（擬似コード; 本文の try 内がこれに相当）:
 *
 *   const pipeline = await maskerPipelineFlow({
 *     fileName: args.fileName,
 *     content: args.content,
 *     curatorContext: args.curatorContext,
 *   });
 *
 *   if (pipeline.decision === 'ai_safe_ready') {
 *     // (a) GCS に masked オブジェクトをまず置く
 *     await uploadMaskedObject(args.aiSafeStoragePath, pipeline.aiSafeVersion!.maskedContent, {
 *       sourceContentHash: args.contentSha256,
 *       aiSafeSchemaVersion: 1,
 *       provider: pipeline.maskingResult.provider,
 *     });
 *     // (b) Firestore を ai_safe 終端に更新（aiSafeStoragePath / masker block / completedAt 等）
 *     //     失敗時は (a) を deleteMaskedObject で巻き戻して throw する。
 *     try {
 *       await args.docRef.update(buildAiSafeFirestoreUpdate(args, pipeline));
 *     } catch (e) {
 *       await safeDeleteMaskedObject(args.aiSafeStoragePath);
 *       throw e;
 *     }
 *     return { kind: 'ai_safe', summary: maskerSummaryFromPipeline(pipeline) };
 *   }
 *
 *   // restricted_promoted
 *   const upgraded = applyMaskerUpgrade(args.curatorEffectiveSnapshot, pipeline.rawRiskOutput);
 *   await args.docRef.update(buildRestrictedFirestoreUpdate(args, pipeline, upgraded));
 *   return {
 *     kind: 'restricted',
 *     summary: maskerSummaryFromPipeline(pipeline),
 *     sensitivityReason: upgraded.sensitivityReason ?? '',
 *   };
 *
 * 例外時: 本関数の catch で recordPhaseFailure(docRef, 'masker', e) の後に再 throw。
 *   runCuratorAndMaskerLifecycle が MaskerPhaseError にラップする。
 *
 * 不変条件チェック（任意）:
 *   buildAiSafeFirestoreUpdate / buildRestrictedFirestoreUpdate の戻り値に対して
 *   assertFirestoreInvariants を呼ぶと runtime で 11 項目を検証できる（Firestore の
 *   FieldValue.serverTimestamp は invariant 検査で扱えないので、Timestamp 化された
 *   shape を別途組み立てて検査するか、検査をスキップする判断が必要）。
 */
export async function runMaskerPhase(
  args: RunMaskerArgs
): Promise<MaskerPhaseSuccess> {
  try {
    const pipeline = await maskerPipelineFlow({
      fileName: args.fileName,
      content: args.content,
      curatorContext: args.curatorContext,
    });
    const summary = maskerSummaryFromPipeline(pipeline);

    if (pipeline.decision === 'ai_safe_ready') {
      const maskedContent = pipeline.aiSafeVersion?.maskedContent;
      if (maskedContent === undefined) {
        throw new Error('ai_safe_ready requires aiSafeVersion.maskedContent');
      }

      await uploadMaskedObject(args.aiSafeStoragePath, maskedContent, {
        sourceContentHash: args.contentSha256,
        aiSafeSchemaVersion: 1,
        provider: pipeline.maskingResult.provider,
      });

      try {
        const update = buildAiSafeFirestoreUpdate(args, pipeline);
        assertFirestoreInvariants({
          sourceKind: args.sourceKind,
          externalSource: args.externalSource,
          status: terminalStatusForMaskerDecision(pipeline.decision),
          contentSha256: args.contentSha256,
          aiSafeStoragePath: args.aiSafeStoragePath,
          sensitivity: args.curatorEffectiveSnapshot.sensitivity,
          aiUsePolicy: args.curatorEffectiveSnapshot.aiUsePolicy,
          sensitivitySource:
            args.curatorEffectiveSnapshot.sensitivitySource ?? null,
          originalCuratorSensitivity:
            args.curatorEffectiveSnapshot.originalCuratorSensitivity ?? null,
          sensitivityReason: null,
          curator: maskerTerminalCuratorInvariantStub(),
          masker: buildMaskerInvariantInputFromPipeline(
            pipeline,
            args.contentSha256
          ),
        });
        await args.docRef.update(update);
      } catch (e) {
        await safeDeleteMaskedObject(args.aiSafeStoragePath);
        throw e;
      }

      return { kind: 'ai_safe', summary };
    }

    const upgraded = applyMaskerUpgrade(
      args.curatorEffectiveSnapshot,
      pipeline.rawRiskOutput
    );
    const update = buildRestrictedFirestoreUpdate(args, pipeline, upgraded);
    assertFirestoreInvariants({
      sourceKind: args.sourceKind,
      externalSource: args.externalSource,
      status: terminalStatusForMaskerDecision(pipeline.decision),
      contentSha256: args.contentSha256,
      aiSafeStoragePath: null,
      sensitivity: upgraded.sensitivity,
      aiUsePolicy: upgraded.aiUsePolicy,
      sensitivitySource: upgraded.sensitivitySource ?? null,
      originalCuratorSensitivity: upgraded.originalCuratorSensitivity ?? null,
      sensitivityReason: upgraded.sensitivityReason ?? null,
      curator: maskerTerminalCuratorInvariantStub(),
      masker: buildMaskerInvariantInputFromPipeline(
        pipeline,
        args.contentSha256
      ),
    });
    await args.docRef.update(update);

    return {
      kind: 'restricted',
      summary,
      sensitivityReason: upgraded.sensitivityReason ?? '',
    };
  } catch (e) {
    await recordPhaseFailure(args.docRef, 'masker', e);
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Firestore update body builders（runMaskerPhase の中から呼ぶヘルパー）
// ─────────────────────────────────────────────────────────────────────

function buildMaskerInvariantInputFromPipeline(
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

// ─────────────────────────────────────────────────────────────────────
// 失敗記録 / rollback ヘルパー
// ─────────────────────────────────────────────────────────────────────

/**
 * Curator / Masker いずれかの段で失敗したとき、Firestore に status='failed' と
 * `${phase}Error` ブロックを書く。書き込み自体が失敗した場合はログのみで吸収。
 */
/**
 * DocumentIR write / chunk replacement failures after curator has already
 * committed a terminal curated status (PDF M1).
 */
export async function recordConversionFailure(
  docRef: DocumentReference,
  cause: unknown
): Promise<void> {
  const message = cause instanceof Error ? cause.message : String(cause);
  const detail = `変換処理に失敗しました。${message}`;
  const truncated =
    detail.length > 8000 ? `${detail.slice(0, 8000)}…` : detail;
  try {
    await docRef.update({
      status: 'failed',
      updatedAt: FieldValue.serverTimestamp(),
      conversionError: {
        message: truncated,
        occurredAt: FieldValue.serverTimestamp(),
      },
    });
  } catch (updateErr) {
    console.error('[orchestrator] conversion failed status update', updateErr);
  }
}

export async function recordPhaseFailure(
  docRef: DocumentReference,
  phase: 'curator' | 'masker',
  cause: unknown
): Promise<void> {
  const message = cause instanceof Error ? cause.message : String(cause);
  const detail =
    phase === 'curator'
      ? `分類処理に失敗しました。${message}`
      : `マスク処理に失敗しました。${message}`;
  const truncated =
    detail.length > 8000 ? `${detail.slice(0, 8000)}…` : detail;
  const errorField = phase === 'curator' ? 'curatorError' : 'maskerError';
  try {
    await docRef.update({
      status: 'failed',
      updatedAt: FieldValue.serverTimestamp(),
      [errorField]: {
        message: truncated,
        occurredAt: FieldValue.serverTimestamp(),
      },
    });
  } catch (updateErr) {
    console.error(`[orchestrator] ${phase} failed status update`, updateErr);
  }
}

/**
 * Masker 失敗時に呼ぶ rollback。GCS 削除に失敗してもログのみで吸収して
 * 上位の throw を妨げない。
 */
export async function safeDeleteMaskedObject(
  aiSafeStoragePath: string
): Promise<void> {
  try {
    await deleteMaskedObject(aiSafeStoragePath);
  } catch (e) {
    console.error('[orchestrator] masked rollback failed', e);
  }
}

// ─────────────────────────────────────────────────────────────────────
// PDF path (Phase 3-H-2 M1)
// ─────────────────────────────────────────────────────────────────────

/**
 * PDF curator phase — mirrors `runCuratorPhase` for text documents but maps
 * `requires_masking` → `status='curated' + maskingPending:true` instead of
 * `status='masking'`.  The Masker is intentionally not wired to PDFs in M1.
 */
async function runPdfCuratorPhase(args: {
  docRef: DocumentReference;
  displayName: string;
  content: string;
  contentSha256: string;
}): Promise<{ result: CuratorOutputResult; completedAt: Date }> {
  try {
    const result = await curatorFlow({
      fileName: args.displayName,
      content: args.content,
    });
    const completedAt = new Date();

    // PDF M1: requires_masking parks at curated + maskingPending after DocumentIR
    // conversion succeeds (see parkPdfRequiresMaskingDocument in orchestratePdfPath).
    const deferRequiresMaskingPark = result.aiUsePolicy === 'requires_masking';
    const nextStatus = deferRequiresMaskingPark
      ? 'curating'
      : terminalStatusForCuratorPolicy(result.aiUsePolicy);
    const maskingPending = null;

    assertFirestoreInvariants({
      sourceKind: 'upload',
      externalSource: null,
      status: nextStatus,
      contentSha256: args.contentSha256,
      aiSafeStoragePath: null,
      sensitivity: result.sensitivity,
      aiUsePolicy: result.aiUsePolicy,
      sensitivitySource: 'curator',
      originalCuratorSensitivity: null,
      sensitivityReason: null,
      maskingPending,
      curator: {
        documentType: result.documentType,
        businessDomain: result.businessDomain,
        sensitivity: result.sensitivity,
        freshness: result.freshness,
        isAuthoritativeCandidate: result.isAuthoritativeCandidate,
        aiUsePolicy: result.aiUsePolicy,
        rationale: result.rationale,
        completedAt,
        modelId: curatorModelId,
      },
      masker: null,
    });

    await args.docRef.update({
      status: nextStatus,
      maskingPending: maskingPending ?? null,
      updatedAt: FieldValue.serverTimestamp(),
      documentType: result.documentType,
      businessDomain: result.businessDomain,
      sensitivity: result.sensitivity,
      freshness: result.freshness,
      isAuthoritativeCandidate: result.isAuthoritativeCandidate,
      aiUsePolicy: result.aiUsePolicy,
      sensitivitySource: 'curator',
      originalCuratorSensitivity: null,
      sensitivityReason: null,
      curator: {
        documentType: result.documentType,
        businessDomain: result.businessDomain,
        sensitivity: result.sensitivity,
        freshness: result.freshness,
        isAuthoritativeCandidate: result.isAuthoritativeCandidate,
        aiUsePolicy: result.aiUsePolicy,
        rationale: result.rationale,
        completedAt: FieldValue.serverTimestamp(),
        modelId: curatorModelId,
      },
      curatorError: null,
    });

    return { result, completedAt };
  } catch (e) {
    await recordPhaseFailure(args.docRef, 'curator', e);
    throw e;
  }
}

/**
 * PDF upload path (Phase 3-H-2 M1):
 *   1. Run PDF curator phase (AI classification).
 *   2. blocked → return immediately.
 *   3. Write DocumentIR to GCS (for both direct and requires_masking).
 *   4. Run health-stage conversion eval and persist to `conversion_eval`.
 *   5. direct → chunk via documentIrToKnowledgeChunks.
 *   6. requires_masking → park at curated + maskingPending:true (no Masker in M1).
 */
async function orchestratePdfPath(args: {
  docRef: DocumentReference;
  docId: string;
  displayName: string;
  content: string;
  contentSha256: string;
  storagePath: string;
  documentIr: DocumentIr;
  auditContext?: OrchestrateAuditContext;
  conversion: PdfConversionAudit;
}): Promise<OrchestrateResult> {
  let curatorOutput: { result: CuratorOutputResult; completedAt: Date };
  try {
    curatorOutput = await runPdfCuratorPhase({
      docRef: args.docRef,
      displayName: args.displayName,
      content: args.content,
      contentSha256: args.contentSha256,
    });
  } catch (e) {
    throw new CuratorPhaseError(args.docId, e);
  }

  const { aiUsePolicy } = curatorOutput.result;

  if (aiUsePolicy === 'blocked') {
    return {
      kind: 'blocked',
      docId: args.docId,
      storagePath: args.storagePath,
      curator: curatorOutput.result,
      curatorCompletedAt: curatorOutput.completedAt,
    };
  }

  try {
    const bucketName = getKnowledgeHubBucketName();
    await writeDocumentIrSnapshot({
      bucketName,
      docId: args.docId,
      documentIr: args.documentIr,
    });

    if (aiUsePolicy === 'direct') {
      const db = getFirestoreClient();
      const chunks = documentIrToKnowledgeChunks({
        documentIr: args.documentIr,
        docId: args.docId,
        extractorInput: args.content,
        documentSensitivity: curatorOutput.result.sensitivity,
        documentAiUsePolicy: 'direct',
        title: args.displayName,
        sensitivitySource: 'inherited',
      });
      const { evalStatus } = await persistPdfHealthStageEval({
        docRef: args.docRef,
        docId: args.docId,
        displayName: args.displayName,
        content: args.content,
        documentIr: args.documentIr,
        documentSensitivity: curatorOutput.result.sensitivity,
        chunksForEval: chunks,
      });
      const adapter = createChunkFirestoreAdapter(db);
      await adapter.replaceChunksForDocument(args.docId, chunks, {
        extractorInput: args.content,
      });

      await recordDocumentConvertAudit({
        auditContext: args.auditContext,
        docId: args.docId,
        displayName: args.displayName,
        documentIr: args.documentIr,
        sensitivity: curatorOutput.result.sensitivity,
        evalStatus,
        conversion: args.conversion,
      });

      return {
        kind: 'curated',
        docId: args.docId,
        storagePath: args.storagePath,
        curator: curatorOutput.result,
        curatorCompletedAt: curatorOutput.completedAt,
      };
    }

    const { evalStatus } = await persistPdfHealthStageEval({
      docRef: args.docRef,
      docId: args.docId,
      displayName: args.displayName,
      content: args.content,
      documentIr: args.documentIr,
      documentSensitivity: curatorOutput.result.sensitivity,
    });

    await recordDocumentConvertAudit({
      auditContext: args.auditContext,
      docId: args.docId,
      displayName: args.displayName,
      documentIr: args.documentIr,
      sensitivity: curatorOutput.result.sensitivity,
      evalStatus,
      conversion: args.conversion,
    });

    await parkPdfRequiresMaskingDocument(args.docRef);

    return {
      kind: 'curated',
      docId: args.docId,
      storagePath: args.storagePath,
      curator: curatorOutput.result,
      curatorCompletedAt: curatorOutput.completedAt,
      maskingPending: true,
    };
  } catch (e) {
    await recordConversionFailure(args.docRef, e);
    throw e;
  }
}

/** PDF M1 terminal park: conversion succeeded; Masker not wired yet. */
async function parkPdfRequiresMaskingDocument(
  docRef: DocumentReference
): Promise<void> {
  await docRef.update({
    status: 'curated',
    maskingPending: true,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function persistPdfHealthStageEval(args: {
  docRef: DocumentReference;
  docId: string;
  displayName: string;
  content: string;
  documentIr: DocumentIr;
  documentSensitivity: CuratorOutputResult['sensitivity'];
  chunksForEval?: ReturnType<typeof documentIrToKnowledgeChunks>;
}): Promise<{ evalStatus: AuditConversionEvalStatus }> {
  try {
    const chunks =
      args.chunksForEval ??
      documentIrToKnowledgeChunks({
        documentIr: args.documentIr,
        docId: args.docId,
        extractorInput: args.content,
        documentSensitivity: args.documentSensitivity,
        documentAiUsePolicy: 'direct',
        title: args.displayName,
        sensitivitySource: 'inherited',
      });

    const evalResult = runConversionEvalHealthCheck({
      sourceSubtype: args.documentIr.source.sourceSubtype,
      chunkDrafts: chunks.map((chunk) => ({ text: chunk.text })),
      schemaValidity: { passed: true },
    });
    const conversionEvalStorage = createConversionEvalStorage(
      getFirestoreClient()
    );
    const written = await conversionEvalStorage.appendConversionEval({
      docId: args.docId,
      revisionId: DOCUMENT_IR_GCS_VERSION,
      stage: 'health',
      result: evalResult,
    });

    await args.docRef.update({
      latestConversionEvalId: written.evalId,
    });
    return { evalStatus: evalResult.overall.status };
  } catch (error) {
    console.warn('[orchestrator] conversion eval health write skipped', error);
    return { evalStatus: 'error' };
  }
}

function toAuditDocumentSourceSubtype(
  sourceSubtype: DocumentSourceSubtype
): AuditDocumentSourceSubtype {
  if (
    sourceSubtype === 'official-doc-pdf' ||
    sourceSubtype === 'slide-pdf' ||
    sourceSubtype === 'scan-pdf'
  ) {
    return sourceSubtype;
  }
  throw new Error(
    `document.convert audit requires a PDF sourceSubtype, got ${sourceSubtype}`
  );
}

async function recordDocumentConvertAudit(args: {
  auditContext?: OrchestrateAuditContext;
  docId: string;
  displayName: string;
  documentIr: DocumentIr;
  sensitivity: Sensitivity;
  evalStatus: AuditConversionEvalStatus;
  conversion: PdfConversionAudit;
}): Promise<void> {
  if (!args.auditContext) {
    return;
  }

  const sourceSubtype = toAuditDocumentSourceSubtype(
    args.documentIr.source.sourceSubtype
  );

  try {
    await recordAuditEvent({
      tenantId: args.auditContext.tenantId,
      actor: args.auditContext.actor,
      action: 'document.convert',
      target: {
        docId: args.docId,
        fileName: args.displayName,
        sourceKind: 'upload',
        sensitivity: args.sensitivity,
      },
      result:
        args.evalStatus === 'fail' || args.evalStatus === 'error'
          ? 'partial'
          : 'success',
      conversion: {
        converterId: args.conversion.converterId,
        sourceSubtype,
        evalStatus: args.evalStatus,
      },
      ...(args.conversion.inferenceDestination
        ? { inferenceDestination: args.conversion.inferenceDestination }
        : {}),
    });
  } catch (error) {
    if (error instanceof ConversionInferenceDestinationInvariantError) {
      throw error;
    }
    console.warn('[orchestrator] recordAuditEvent document.convert failed', error);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 内部
// ─────────────────────────────────────────────────────────────────────

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

export async function safeDeleteRawObject(storagePath: string): Promise<void> {
  try {
    await deleteRawObject(storagePath);
  } catch (e) {
    console.error('[orchestrator] raw rollback failed', e);
  }
}

export async function safeDeleteFirestoreDoc(
  docRef: DocumentReference
): Promise<void> {
  try {
    await docRef.delete();
  } catch (e) {
    console.error('[orchestrator] firestore rollback failed', e);
  }
}

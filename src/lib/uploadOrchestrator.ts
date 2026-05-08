import { randomUUID } from 'node:crypto';
import type { DocumentReference, FieldValue as FieldValueType } from '@google-cloud/firestore';
import { curatorFlow } from '../agents/curator/flow';
import { modelId as curatorModelId } from '../agents/_shared/genkitClient';
import type { CuratorOutputResult } from '../agents/curator/schema';
import { maskerPipelineFlow } from '../agents/masker/pipelineFlow';
import type { PipelineOutput } from '../agents/masker/pipelineSchema';
import { applyMaskerUpgrade } from '../agents/masker/upgrade';
import {
  DOCUMENTS_COLLECTION,
  buildRawObjectPath,
  sanitizeOriginalFileName,
} from './documents';
import { FieldValue, getFirestoreClient } from './firestore';
import {
  FIRESTORE_DOCUMENT_SCHEMA_VERSION,
  assertFirestoreInvariants,
  hashContentSha256,
  terminalStatusForCuratorPolicy,
  terminalStatusForMaskerDecision,
} from './firestoreSchema';
import {
  deleteMaskedObject,
  deleteRawObject,
  uploadMaskedObject,
  uploadRawObject,
} from './storage';

// ─────────────────────────────────────────────────────────────────────
// 公開 API
// ─────────────────────────────────────────────────────────────────────

export type OrchestrateInput = {
  displayName: string;
  contentType: string;
  buffer: Buffer;
  content: string;
};

export type MaskerSummary = {
  decision: 'ai_safe_ready' | 'restricted_promoted';
  provider: 'simple-rule';
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
      kind: 'curated' | 'blocked';
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

/**
 * Walking Skeleton の副作用順序を一手に握る orchestrator。
 *
 * 段:
 *   [B] GCS uploadRawObject
 *   [C] Firestore initial set       — 失敗時 GCS rollback
 *   [D] Firestore update(curating)  — 失敗時 GCS + Firestore set rollback
 *   [E][F] runCuratorPhase          — curated / blocked / masking 終端 update
 *   [G][H] runMaskerPhase (masking のとき) — ai_safe / restricted / failed 終端 update
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

  // [B] GCS uploadRawObject
  await uploadRawObject(storagePath, input.buffer, input.contentType);

  const db = getFirestoreClient();
  const docRef = db.collection(DOCUMENTS_COLLECTION).doc(docId);

  // [C] Firestore initial set
  try {
    await docRef.set(
      buildInitialDocumentBody({
        docId,
        displayName: input.displayName,
        contentType: input.contentType,
        byteSize: input.buffer.length,
        contentSha256,
        storagePath,
      })
    );
  } catch (e) {
    await safeDeleteRawObject(storagePath);
    throw e;
  }

  // [D] Firestore update(curating) — レビュー 1.b 解消
  try {
    assertFirestoreInvariants({
      status: 'curating',
      contentSha256,
      aiSafeStoragePath: null,
      sensitivity: null,
      aiUsePolicy: null,
      sensitivitySource: null,
      originalCuratorSensitivity: null,
      curator: null,
      masker: null,
    });
    await docRef.update({
      status: 'curating',
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    await safeDeleteRawObject(storagePath);
    await safeDeleteFirestoreDoc(docRef);
    throw e;
  }

  // [E][F] Curator phase
  let curatorOutput: { result: CuratorOutputResult; completedAt: Date };
  try {
    curatorOutput = await runCuratorPhase({
      docRef,
      displayName: input.displayName,
      content: input.content,
      contentSha256,
    });
  } catch (e) {
    throw new CuratorPhaseError(docId, e);
  }

  const curatorTerminal = terminalStatusForCuratorPolicy(
    curatorOutput.result.aiUsePolicy
  );

  if (curatorTerminal === 'curated' || curatorTerminal === 'blocked') {
    return {
      kind: curatorTerminal,
      docId,
      storagePath,
      curator: curatorOutput.result,
      curatorCompletedAt: curatorOutput.completedAt,
    };
  }

  // curatorTerminal === 'masking' — Masker pipeline へ
  let maskerOutcome: MaskerPhaseSuccess;
  try {
    maskerOutcome = await runMaskerPhase({
      docRef,
      docId,
      fileName: input.displayName,
      content: input.content,
      contentSha256,
      aiSafeStoragePath,
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
    throw new MaskerPhaseError(docId, e);
  }

  if (maskerOutcome.kind === 'ai_safe') {
    return {
      kind: 'ai_safe',
      docId,
      storagePath,
      aiSafeStoragePath,
      curator: curatorOutput.result,
      curatorCompletedAt: curatorOutput.completedAt,
      masker: maskerOutcome.summary,
    };
  }

  return {
    kind: 'restricted',
    docId,
    storagePath,
    curator: curatorOutput.result,
    curatorCompletedAt: curatorOutput.completedAt,
    masker: maskerOutcome.summary,
    sensitivityReason: maskerOutcome.sensitivityReason,
    originalCuratorSensitivity: curatorOutput.result.sensitivity,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Curator phase
// ─────────────────────────────────────────────────────────────────────

async function runCuratorPhase(args: {
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
    const nextStatus = terminalStatusForCuratorPolicy(result.aiUsePolicy);
    assertFirestoreInvariants({
      status: nextStatus,
      contentSha256: args.contentSha256,
      aiSafeStoragePath: null,
      sensitivity: result.sensitivity,
      aiUsePolicy: result.aiUsePolicy,
      sensitivitySource: 'curator',
      originalCuratorSensitivity: null,
      curator: {
        documentType: result.documentType,
        businessDomain: result.businessDomain,
        sensitivity: result.sensitivity,
        freshness: result.freshness,
        isAuthoritativeCandidate: result.isAuthoritativeCandidate,
        aiUsePolicy: result.aiUsePolicy,
        rationale: result.rationale,
        completedAt: completedAt as never,
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
// Masker phase（中身は Step 2 でユーザーが実装）
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
  aiSafeStoragePath: string;
  curatorContext: CuratorContextForMasker;
  /** Curator が書いた直後の effective fields。applyMaskerUpgrade に渡す土台。 */
  curatorEffectiveSnapshot: EffectiveSnapshotForUpgrade;
};

type MaskerPhaseSuccess =
  | { kind: 'ai_safe'; summary: MaskerSummary }
  | { kind: 'restricted'; summary: MaskerSummary; sensitivityReason: string };

/**
 * 仕様（あなたが Step 2 で書く中核 5-15 行）:
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
 * 例外時（catch の外側）: orchestrator の上位 try/catch が
 *   recordPhaseFailure(args.docRef, 'masker', e) を呼んでから throw する責務をもつ。
 *   → Step 2 ではここでも recordPhaseFailure を呼ぶ try/catch を関数全体にラップする。
 *
 * 不変条件チェック（任意）:
 *   buildAiSafeFirestoreUpdate / buildRestrictedFirestoreUpdate の戻り値に対して
 *   assertFirestoreInvariants を呼ぶと runtime で 8 項目を検証できる（Firestore の
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
          status: terminalStatusForMaskerDecision(pipeline.decision),
          contentSha256: args.contentSha256,
          aiSafeStoragePath: args.aiSafeStoragePath,
          sensitivity: args.curatorEffectiveSnapshot.sensitivity,
          aiUsePolicy: args.curatorEffectiveSnapshot.aiUsePolicy,
          sensitivitySource:
            args.curatorEffectiveSnapshot.sensitivitySource ?? null,
          originalCuratorSensitivity:
            args.curatorEffectiveSnapshot.originalCuratorSensitivity ?? null,
          curator: { aiUsePolicy: 'requires_masking' } as never,
          masker: update.masker as never,
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
      status: terminalStatusForMaskerDecision(pipeline.decision),
      contentSha256: args.contentSha256,
      aiSafeStoragePath: null,
      sensitivity: upgraded.sensitivity,
      aiUsePolicy: upgraded.aiUsePolicy,
      sensitivitySource: upgraded.sensitivitySource ?? null,
      originalCuratorSensitivity: upgraded.originalCuratorSensitivity ?? null,
      curator: { aiUsePolicy: 'requires_masking' } as never,
      masker: update.masker as never,
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
): Record<string, unknown> {
  if (pipeline.decision !== 'ai_safe_ready') {
    throw new Error('buildAiSafeFirestoreUpdate requires decision=ai_safe_ready');
  }
  return {
    status: 'ai_safe',
    updatedAt: FieldValue.serverTimestamp(),
    aiSafeStoragePath: args.aiSafeStoragePath,
    masker: {
      decision: pipeline.decision,
      provider: pipeline.maskingResult.provider,
      maskedSpansCount: pipeline.maskingResult.maskedSpans.length,
      ruleHits: pipeline.maskingResult.ruleHits,
      residualRisk: pipeline.rawRiskOutput.residualRisk,
      rationale: pipeline.rawRiskOutput.rationale,
      recommendedSensitivity: pipeline.rawRiskOutput.recommendedSensitivity,
      sourceContentHash: args.contentSha256,
      aiSafeSchemaVersion: 1,
      completedAt: FieldValue.serverTimestamp(),
      modelId: curatorModelId,
    },
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
): Record<string, unknown> {
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
    sensitivitySource: upgraded.sensitivitySource,
    originalCuratorSensitivity: upgraded.originalCuratorSensitivity ?? null,
    sensitivityReason: upgraded.sensitivityReason ?? null,
    masker: {
      decision: pipeline.decision,
      provider: pipeline.maskingResult.provider,
      maskedSpansCount: pipeline.maskingResult.maskedSpans.length,
      ruleHits: pipeline.maskingResult.ruleHits,
      residualRisk: pipeline.rawRiskOutput.residualRisk,
      rationale: pipeline.rawRiskOutput.rationale,
      recommendedSensitivity: pipeline.rawRiskOutput.recommendedSensitivity,
      sourceContentHash: args.contentSha256,
      aiSafeSchemaVersion: 1,
      completedAt: FieldValue.serverTimestamp(),
      modelId: curatorModelId,
    },
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
// 内部
// ─────────────────────────────────────────────────────────────────────

function buildInitialDocumentBody(args: {
  docId: string;
  displayName: string;
  contentType: string;
  byteSize: number;
  contentSha256: string;
  storagePath: string;
}): Record<string, unknown> {
  const now: FieldValueType = FieldValue.serverTimestamp();
  assertFirestoreInvariants({
    status: 'uploaded',
    contentSha256: args.contentSha256,
    aiSafeStoragePath: null,
    sensitivity: null,
    aiUsePolicy: null,
    sensitivitySource: null,
    originalCuratorSensitivity: null,
    curator: null,
    masker: null,
  });
  return {
    id: args.docId,
    schemaVersion: FIRESTORE_DOCUMENT_SCHEMA_VERSION,
    fileName: args.displayName,
    contentType: args.contentType,
    byteSize: args.byteSize,
    contentSha256: args.contentSha256,
    storagePath: args.storagePath,
    aiSafeStoragePath: null,
    status: 'uploaded',
    createdAt: now,
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
  };
}

async function safeDeleteRawObject(storagePath: string): Promise<void> {
  try {
    await deleteRawObject(storagePath);
  } catch (e) {
    console.error('[orchestrator] raw rollback failed', e);
  }
}

async function safeDeleteFirestoreDoc(
  docRef: DocumentReference
): Promise<void> {
  try {
    await docRef.delete();
  } catch (e) {
    console.error('[orchestrator] firestore rollback failed', e);
  }
}

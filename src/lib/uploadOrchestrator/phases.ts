import type { DocumentReference } from '@google-cloud/firestore';
import type { CuratorOutputResult } from '../../agents/curator/schema';
import { curatorFlow } from '../../agents/curator/flow';
import { modelId as curatorModelId } from '../../agents/_shared/genkitClient';
import { maskerPipelineFlow } from '../../agents/masker/pipelineFlow';
import { applyMaskerUpgrade } from '../../agents/masker/upgrade';
import { FieldValue } from '../firestore';
import {
  assertFirestoreInvariants,
  maskerTerminalCuratorInvariantStub,
  terminalStatusForCuratorPolicy,
  terminalStatusForMaskerDecision,
} from '../firestoreSchema';
import { uploadMaskedObject } from '../storage';
import {
  buildAiSafeFirestoreUpdate,
  buildMaskerInvariantInputFromPipeline,
  buildRestrictedFirestoreUpdate,
  maskerSummaryFromPipeline,
  type FirestoreInitialDocumentDraft,
  type RunMaskerArgs,
} from './firestoreDrafts';
import { recordPhaseFailure } from './audit';
import { safeDeleteMaskedObject } from './cleanup';
import type {
  MaskerSummary,
  OrchestrateResult,
  RunCuratorAndMaskerLifecycleArgs,
} from './types';

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
    restrictionSource: 'masker',
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

export type MaskerPhaseSuccess =
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

import type { DocumentReference } from '@google-cloud/firestore';
import type { CuratorOutputResult, Sensitivity } from '../../agents/curator/schema';
import { maskKnowledgeChunk } from '../../agents/masker/maskKnowledgeChunk';
import type { DocumentIr } from '../../eval/conversion/documentIr';
import { documentIrToKnowledgeChunks } from '../conversion/documentIrToKnowledgeChunk';
import { runConversionEvalHealthCheck } from '../../eval/conversion/runConversionEvalHealthCheck';
import { createConversionEvalStorage } from '../conversionEvalStorage';
import { FieldValue, getFirestoreClient } from '../firestore';
import { assertFirestoreInvariants, terminalStatusForCuratorPolicy } from '../firestoreSchema';
import {
  assertConversionInferenceDestinationInvariant,
  assertConversionUnmaskablePiiFindingsInvariant,
  ConversionInferenceDestinationInvariantError,
  ConversionUnmaskablePiiFindingsInvariantError,
  type AuditConversionEvalStatus,
  type AuditEventConversion,
} from '../audit/auditEvent';
import { getKnowledgeHubBucketName } from '../storage';
import {
  DOCUMENT_IR_GCS_VERSION,
  writeDocumentIrSnapshot,
} from '../documentIrStorage';
import { createChunkFirestoreAdapter } from '../chunkFirestoreAdapter';
import { curatorFlow } from '../../agents/curator/flow';
import { modelId as curatorModelId } from '../../agents/_shared/genkitClient';
import {
  buildSafetyGateRestrictedFirestoreUpdate,
  UNMASKABLE_PII_RESTRICTION_REASON,
} from './firestoreDrafts';
import {
  recordConversionFailure,
  recordDocumentConvertAudit,
  recordPhaseFailure,
  toAuditDocumentSourceSubtype,
} from './audit';
import { safeDeleteMaskedObject } from './cleanup';
import {
  CuratorPhaseError,
  MaskerPhaseError,
  runMaskerPhase,
  type MaskerPhaseSuccess,
} from './phases';
import type {
  OrchestrateAuditContext,
  OrchestrateResult,
  PdfCuratorInputMode,
  PdfConversionAudit,
} from './types';

// ─────────────────────────────────────────────────────────────────────
// PDF path (Phase 3-H-2 M1)
// ─────────────────────────────────────────────────────────────────────

const PAGE_GROUP_MANIFEST_FORCE_MASKING_REASON =
  'Large PDF was classified from a page-group manifest; direct AI use is not trusted until full-text masking runs.';

function applyPdfCuratorInputModeSafety(
  result: CuratorOutputResult,
  curatorInputMode: PdfCuratorInputMode
): CuratorOutputResult {
  if (
    curatorInputMode !== 'page_group_manifest' ||
    result.aiUsePolicy !== 'direct'
  ) {
    return result;
  }

  return {
    ...result,
    sensitivity: 'Confidential',
    aiUsePolicy: 'requires_masking',
    rationale: `${result.rationale}\n${PAGE_GROUP_MANIFEST_FORCE_MASKING_REASON}`,
  };
}

/**
 * PDF curator phase — mirrors `runCuratorPhase` for text documents but maps
 * `requires_masking` → stay in `curating` until DocumentIR conversion completes,
 * then `orchestratePdfPath` runs Masker (same as text uploads).
 */
async function runPdfCuratorPhase(args: {
  docRef: DocumentReference;
  displayName: string;
  content: string;
  curatorInputMode: PdfCuratorInputMode;
  contentSha256: string;
}): Promise<{ result: CuratorOutputResult; completedAt: Date }> {
  try {
    const rawResult = await curatorFlow({
      fileName: args.displayName,
      content: args.content,
    });
    const result = applyPdfCuratorInputModeSafety(
      rawResult,
      args.curatorInputMode
    );
    const completedAt = new Date();

    // requires_masking: stay in curating until DocumentIR + Masker complete in orchestratePdfPath.
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
 *   6. requires_masking → Masker pipeline + sequential per-chunk mask + DocumentIR chunks.
 *      (see docs/decisions.md D-P3-M-PDF-1)
 */
export async function orchestratePdfPath(args: {
  docRef: DocumentReference;
  docId: string;
  displayName: string;
  content: string;
  curatorContent: string;
  curatorInputMode: PdfCuratorInputMode;
  contentSha256: string;
  storagePath: string;
  aiSafeStoragePath: string;
  documentIr: DocumentIr;
  auditContext?: OrchestrateAuditContext;
  conversion: PdfConversionAudit;
}): Promise<OrchestrateResult> {
  // Pre-flight: catch extractor/orchestrator wiring bugs (Vertex converter
  // missing inferenceDestination, or pdf-parse with one) before any chunks /
  // DocumentIR / audit are persisted. The same invariant is enforced again at
  // the audit write boundary; checking here keeps failure ordering symmetric
  // with non-Vertex paths so a wiring bug cannot leave orphan chunks behind a
  // failed document.
  const auditSourceSubtype = toAuditDocumentSourceSubtype(
    args.documentIr.source.sourceSubtype
  );
  const preflightConversion: AuditEventConversion = {
    converterId: args.conversion.converterId,
    sourceSubtype: auditSourceSubtype,
    evalStatus: 'pass',
    ...(args.conversion.unmaskablePiiFindingsCount !== undefined
      ? {
          unmaskablePiiFindings: {
            count: args.conversion.unmaskablePiiFindingsCount,
          },
        }
      : {}),
  };

  assertConversionInferenceDestinationInvariant({
    conversion: preflightConversion,
    inferenceDestination: args.conversion.inferenceDestination,
  });
  assertConversionUnmaskablePiiFindingsInvariant({
    conversion: preflightConversion,
    result: 'success',
  });

  let curatorOutput: { result: CuratorOutputResult; completedAt: Date };
  try {
    curatorOutput = await runPdfCuratorPhase({
      docRef: args.docRef,
      displayName: args.displayName,
      content: args.curatorContent,
      curatorInputMode: args.curatorInputMode,
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

  // D-PROD-1: OCR unmaskable-PII safety gate. When scan-pdf OCR reports PII it
  // could not mask (unmaskablePiiFindings.count >= 1), the document must not
  // reach an AI-readable terminal (curated/ai_safe). Restrict it BEFORE the
  // aiUsePolicy branch so it covers both `direct` (which skips the Masker) and
  // `requires_masking`. This is distinct from a Masker-promoted restriction: no
  // Masker runs, masker block stays null, origin = restrictionSource:'safety_gate'.
  // We deliberately skip the DocumentIR snapshot, health eval, and chunking so no
  // new artifact persists the unmaskable PII text (cf. GH #10).
  if ((args.conversion.unmaskablePiiFindingsCount ?? 0) >= 1) {
    return terminateRestrictedByUnmaskablePii({
      docRef: args.docRef,
      docId: args.docId,
      storagePath: args.storagePath,
      displayName: args.displayName,
      contentSha256: args.contentSha256,
      documentIr: args.documentIr,
      curatorOutput,
      auditContext: args.auditContext,
      conversion: args.conversion,
    });
  }

  // True once runMaskerPhase has committed status='ai_safe' + aiSafeStoragePath.
  // A later failure (per-chunk masking / chunk persistence) must roll those
  // artifacts back so the failed document keeps the aiSafeStoragePath invariant.
  let aiSafeCommitted = false;
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

    let maskerOutcome: MaskerPhaseSuccess;
    try {
      maskerOutcome = await runMaskerPhase({
        docRef: args.docRef,
        docId: args.docId,
        fileName: args.displayName,
        content: args.content,
        contentSha256: args.contentSha256,
        sourceKind: 'upload',
        externalSource: null,
        aiSafeStoragePath: args.aiSafeStoragePath,
        curatorContext: {
          sensitivity: curatorOutput.result.sensitivity,
          aiUsePolicy: curatorOutput.result.aiUsePolicy,
          businessDomain: curatorOutput.result.businessDomain,
        },
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
      aiSafeCommitted = true;
      const chunks = documentIrToKnowledgeChunks({
        documentIr: args.documentIr,
        docId: args.docId,
        extractorInput: args.content,
        documentSensitivity: curatorOutput.result.sensitivity,
        documentAiUsePolicy: 'requires_masking',
        title: args.displayName,
        sensitivitySource: 'inherited',
      });
      // Per-chunk masking is a Masker operation: classify failures as
      // maskerError (not conversionError) to match the document-level Masker
      // failure path. Roll back the ai_safe commit (masked object + status)
      // first, then rethrow MaskerPhaseError so the outer catch passes through.
      let maskedChunks: typeof chunks;
      try {
        maskedChunks = [];
        for (const chunk of chunks) {
          maskedChunks.push(await maskKnowledgeChunk(chunk));
        }
      } catch (e) {
        await safeDeleteMaskedObject(args.aiSafeStoragePath);
        await recordPhaseFailure(args.docRef, 'masker', e, {
          aiSafeStoragePath: null,
        });
        throw new MaskerPhaseError(args.docId, e);
      }
      const db = getFirestoreClient();
      const adapter = createChunkFirestoreAdapter(db);
      await adapter.replaceChunksForDocument(args.docId, maskedChunks, {
        extractorInput: args.content,
      });

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
  } catch (e) {
    // Masker failures already recorded maskerError (and rolled back any
    // ai_safe commit) inside runMaskerPhase or the per-chunk masking handler;
    // don't re-record them as a conversion failure.
    if (e instanceof MaskerPhaseError) throw e;
    // Chunk persistence can fail after the ai_safe commit. Roll the masked
    // object + aiSafeStoragePath back so the failed document keeps the
    // aiSafeStoragePath invariant. Pre-ai_safe failures leave both untouched.
    if (aiSafeCommitted) {
      await safeDeleteMaskedObject(args.aiSafeStoragePath);
      await recordConversionFailure(args.docRef, e, { aiSafeStoragePath: null });
    } else {
      await recordConversionFailure(args.docRef, e);
    }
    throw e;
  }
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
    // Eval-only fallback draft: this `documentAiUsePolicy` does not change the
    // document policy, and `conversion_eval` persists metrics/warnings only.
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
      documentIr: args.documentIr,
      chunkDrafts: chunks,
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

/**
 * D-PROD-1 terminal: restrict a scan-pdf whose OCR found unmaskable PII, before
 * any AI-readable terminal. Records the `document.convert` audit (carrying
 * `unmaskablePiiFindings.count`) and commits a safety-gate restricted document.
 * No Masker runs, no chunks, no DocumentIR snapshot, no health-eval artifact —
 * so nothing new persists the unmaskable PII text (cf. GH #10).
 */
async function terminateRestrictedByUnmaskablePii(args: {
  docRef: DocumentReference;
  docId: string;
  storagePath: string;
  displayName: string;
  contentSha256: string;
  documentIr: DocumentIr;
  curatorOutput: { result: CuratorOutputResult; completedAt: Date };
  auditContext?: OrchestrateAuditContext;
  conversion: PdfConversionAudit;
}): Promise<OrchestrateResult> {
  const curator = args.curatorOutput.result;
  if (curator.sensitivity === null || curator.aiUsePolicy === null) {
    // A curator terminal always sets these; guard keeps the safety gate honest.
    throw new Error(
      'terminateRestrictedByUnmaskablePii requires curator sensitivity and aiUsePolicy'
    );
  }

  // Audit the conversion (metadata only; carries unmaskablePiiFindings.count).
  // evalStatus is 'pass' because the conversion itself succeeded; the restriction
  // is a separate deterministic safety decision and we intentionally do not run
  // the health eval (avoids persisting unmaskable PII text — GH #10).
  await recordDocumentConvertAudit({
    auditContext: args.auditContext,
    docId: args.docId,
    displayName: args.displayName,
    documentIr: args.documentIr,
    sensitivity: curator.sensitivity,
    evalStatus: 'pass',
    conversion: args.conversion,
  });

  const update = buildSafetyGateRestrictedFirestoreUpdate({
    sensitivity: curator.sensitivity,
    aiUsePolicy: curator.aiUsePolicy,
    reason: UNMASKABLE_PII_RESTRICTION_REASON,
  });
  assertFirestoreInvariants({
    sourceKind: 'upload',
    externalSource: null,
    status: 'restricted',
    contentSha256: args.contentSha256,
    aiSafeStoragePath: null,
    sensitivity: update.sensitivity,
    aiUsePolicy: update.aiUsePolicy,
    sensitivitySource: update.sensitivitySource,
    originalCuratorSensitivity: update.originalCuratorSensitivity,
    sensitivityReason: update.sensitivityReason,
    restrictionSource: update.restrictionSource,
    curator: { aiUsePolicy: curator.aiUsePolicy },
    masker: null,
  });
  await args.docRef.update(update);

  return {
    kind: 'restricted',
    docId: args.docId,
    storagePath: args.storagePath,
    curator,
    curatorCompletedAt: args.curatorOutput.completedAt,
    restrictionSource: 'safety_gate',
    sensitivityReason: UNMASKABLE_PII_RESTRICTION_REASON,
  };
}

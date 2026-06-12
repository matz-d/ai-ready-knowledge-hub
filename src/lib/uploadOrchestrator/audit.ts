import type { DocumentReference } from '@google-cloud/firestore';
import type { Sensitivity } from '../../agents/curator/schema';
import type { DocumentIr, DocumentSourceSubtype } from '../../eval/conversion/documentIr';
import { FieldValue } from '../firestore';
import {
  ConversionInferenceDestinationInvariantError,
  ConversionUnmaskablePiiFindingsInvariantError,
  recordAuditEvent,
  type AuditConversionEvalStatus,
  type AuditDocumentSourceSubtype,
} from '../audit/auditEvent';
import type { OrchestrateAuditContext, PdfConversionAudit } from './types';

export async function recordConversionFailure(
  docRef: DocumentReference,
  cause: unknown,
  extraFields?: Record<string, unknown>
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
      ...extraFields,
    });
  } catch (updateErr) {
    console.error('[orchestrator] conversion failed status update', updateErr);
  }
}

export async function recordPhaseFailure(
  docRef: DocumentReference,
  phase: 'curator' | 'masker',
  cause: unknown,
  extraFields?: Record<string, unknown>
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
      ...extraFields,
    });
  } catch (updateErr) {
    console.error(`[orchestrator] ${phase} failed status update`, updateErr);
  }
}
export function toAuditDocumentSourceSubtype(
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
export async function recordDocumentConvertAudit(args: {
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
        ...(args.conversion.converterId === 'gemini-vertex-ocr' &&
        sourceSubtype === 'scan-pdf' &&
        args.conversion.unmaskablePiiFindingsCount !== undefined
          ? {
              unmaskablePiiFindings: {
                count: args.conversion.unmaskablePiiFindingsCount,
              },
            }
          : {}),
      },
      ...(args.conversion.inferenceDestination
        ? { inferenceDestination: args.conversion.inferenceDestination }
        : {}),
    });
  } catch (error) {
    if (
      error instanceof ConversionInferenceDestinationInvariantError ||
      error instanceof ConversionUnmaskablePiiFindingsInvariantError
    ) {
      throw error;
    }
    console.warn('[orchestrator] recordAuditEvent document.convert failed', error);
  }
}

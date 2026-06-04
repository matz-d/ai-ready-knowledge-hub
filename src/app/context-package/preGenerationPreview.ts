import type { CandidateRow } from './candidateSelectionUi';
import type { CandidateRecommendation } from '../../services/candidateSelection';

/**
 * Phase 4-UX S7: Pre-generation safety projection (deterministic, metadata-only).
 *
 * Given the candidate rows and the docIds the operator has selected, this predicts
 * what the authoritative generation path will actually do, BEFORE generation runs.
 * Its job is transparency ("安心"), not enforcement.
 *
 * ── Consistency with the authoritative gate (must never contradict it) ──────────
 * The real body gate lives downstream:
 *   /api/context-package → runSafetyGate (src/agents/strategist/safetyGate.ts)
 *                        → isSafeForContextPackageExport (src/lib/contextPackageInput.ts)
 * That gate is authoritative and ALWAYS strips Restricted/blocked regardless of which
 * docIds are submitted (defense-in-depth). This projection only *predicts* the gate.
 *
 * Because the candidate layer is metadata-only (no aiSafeContent / body / chunk reads,
 * per D-P4UX-0), the projection can be exact in the SAFE direction but only predictive
 * in the SEND direction:
 *   - `auto_excluded` mirrors safetyGate rules 1–2 on metadata (Restricted / blocked).
 *     The downstream gate enforces the identical exclusion, so this is never a
 *     contradiction — it is a guaranteed subset.
 *   - `will_send` is a PREDICTION. Final body-availability (aiSafeContent present) is
 *     confirmed only at generation. The gate may still move a predicted-send doc to
 *     human review if its masked/AI-safe body is missing. That is a NARROWING of the
 *     send set, never a WIDENING — so the preview never over-promises safety.
 *
 * No chunk bodies are fetched here; document metadata only.
 */

export type PreviewDisposition =
  | 'will_send' // predicted to be included as an AI-ready source
  | 'auto_excluded' // Restricted/blocked — safety gate removes it; never sent to AI
  | 'stale_warning' // superseded candidate — will send, but operator should confirm freshness
  | 'masking_pending' // requires masking but masked version not ready — gate excludes until ready
  | 'needs_confirmation'; // other needs_review / unexpected status — confirm before relying on it

export type PreviewRow = {
  docId: string;
  fileName: string;
  sensitivity: string;
  status: string;
  recommendation: CandidateRecommendation;
  disposition: PreviewDisposition;
  /** Japanese note for the UI explaining the disposition. */
  note: string;
  reasonCode?: string;
};

export type PreGenerationPreview = {
  /** Predicted to be sent to AI (metadata-level prediction; gate confirms body at generation). */
  willSend: PreviewRow[];
  /** Restricted/blocked among the selection — the safety gate strips these automatically. */
  autoExcluded: PreviewRow[];
  /** Stale / masking-pending / unexpected — operator should confirm before generating. */
  warnings: PreviewRow[];
  /** Selected docIds not present in the candidate list (e.g. advanced manual override). */
  unknownDocIds: string[];
  counts: {
    willSend: number;
    autoExcluded: number;
    warnings: number;
    unknownDocIds: number;
  };
  /** Selection contains Restricted/blocked docs (the gate will strip them safely). */
  hasAutoExcluded: boolean;
  /** Selection contains anything needing human confirmation (stale / masking / unknown). */
  hasWarnings: boolean;
};

/**
 * Restricted/blocked at the document-metadata level. Mirrors safetyGate rules 1–2
 * (sensitivity === 'Restricted' / aiUsePolicy === 'blocked') using the metadata that
 * survives into CandidateRow. The downstream gate enforces the same exclusion.
 */
function isUnsafeForAi(row: CandidateRow): boolean {
  return (
    row.sensitivity === 'Restricted' ||
    row.status === 'restricted' ||
    row.status === 'blocked' ||
    row.reasonCode === 'restricted_sensitivity'
  );
}

/** Confidential doc whose masked/AI-safe version is not yet available (gate rule 3). */
function isMaskingPending(row: CandidateRow): boolean {
  return row.reasonCode === 'masking_required_unavailable';
}

/** Superseded candidate — a freshness concern, not a safety one. */
function isStale(row: CandidateRow): boolean {
  return (
    row.freshness === 'superseded_candidate' ||
    row.reasonCode === 'superseded_or_stale'
  );
}

function classify(row: CandidateRow): { disposition: PreviewDisposition; note: string } {
  // Order is significant: the safety-critical exclusion is decided first so that an
  // unsafe doc can never fall through into `will_send`.
  if (isUnsafeForAi(row)) {
    return {
      disposition: 'auto_excluded',
      note: 'Restricted のため安全装置が自動で除外します（AI には渡りません）',
    };
  }
  if (isMaskingPending(row)) {
    return {
      disposition: 'masking_pending',
      note: 'マスク済み版が未生成のため、現状では AI に渡せません',
    };
  }
  if (isStale(row)) {
    return {
      disposition: 'stale_warning',
      note: '古い／上書き候補です。内容を確認してから生成してください',
    };
  }
  if (row.recommendation === 'include') {
    return {
      disposition: 'will_send',
      note: 'AI に渡す予定です',
    };
  }
  return {
    disposition: 'needs_confirmation',
    note: '状態を確認してください',
  };
}

function toPreviewRow(row: CandidateRow): PreviewRow {
  const { disposition, note } = classify(row);
  return {
    docId: row.docId,
    fileName: row.fileName,
    sensitivity: row.sensitivity,
    status: row.status,
    recommendation: row.recommendation,
    disposition,
    note,
    reasonCode: row.reasonCode,
  };
}

/**
 * Projects what generation will do with the operator's current selection.
 * Pure and deterministic. Only the selected candidates are considered.
 */
export function projectPreGenerationPreview(
  candidates: CandidateRow[],
  selectedDocIds: ReadonlySet<string>,
): PreGenerationPreview {
  const byId = new Map(candidates.map((c) => [c.docId, c]));

  const willSend: PreviewRow[] = [];
  const autoExcluded: PreviewRow[] = [];
  const warnings: PreviewRow[] = [];
  const unknownDocIds: string[] = [];

  // Iterate selection in a stable order: candidate order first, then any unknown ids.
  for (const candidate of candidates) {
    if (!selectedDocIds.has(candidate.docId)) continue;
    const previewRow = toPreviewRow(candidate);
    switch (previewRow.disposition) {
      case 'will_send':
        willSend.push(previewRow);
        break;
      case 'auto_excluded':
        autoExcluded.push(previewRow);
        break;
      default:
        warnings.push(previewRow);
        break;
    }
  }

  for (const docId of selectedDocIds) {
    if (!byId.has(docId)) {
      unknownDocIds.push(docId);
    }
  }

  return {
    willSend,
    autoExcluded,
    warnings,
    unknownDocIds,
    counts: {
      willSend: willSend.length,
      autoExcluded: autoExcluded.length,
      warnings: warnings.length,
      unknownDocIds: unknownDocIds.length,
    },
    hasAutoExcluded: autoExcluded.length > 0,
    hasWarnings: warnings.length > 0 || unknownDocIds.length > 0,
  };
}

/**
 * Whether the UI should require an explicit "内容を確認しました" acknowledgement
 * before enabling generation. True when the preview contains anything the operator
 * should consciously confirm (auto-excluded Restricted, stale, masking-pending, unknown).
 */
export function previewRequiresAcknowledgement(preview: PreGenerationPreview): boolean {
  return preview.hasAutoExcluded || preview.hasWarnings;
}

import type { Firestore } from '@google-cloud/firestore';
import type { DocumentIr } from '../../eval/conversion/documentIr';
import type { PdfConversionAudit } from '../uploadOrchestrator';
import { getFeatureFlag, isFeatureEnabled, type FeatureFlagId } from '../featureFlags';
import {
  extractPdfFromBuffer,
  type ExtractPdfFromBufferResult,
} from './pdfDocumentExtractor';
import {
  renderPdfPageGroupManifest,
  type DocumentPreflightReport,
  type PdfPageGroupSplitPlan,
} from './preflight';
import { extractSlidePdfFromBuffer } from './slidePdfDocumentExtractor';
import { extractScanPdfFromBuffer } from './scanPdfDocumentExtractor';
import {
  augmentOfficialDocWithTableAssist,
  type TableAssistSummary,
} from './officialDocPdfTableAssist';

export type PdfExtractionResult = {
  textContent: string;
  documentIr: DocumentIr;
  /** Per-page raw texts for table-assist grounding (WU-4). Only subtype-1. */
  pageTexts?: { pageNumber: number; text: string }[];
  preflightReport?: DocumentPreflightReport;
  pageGroupPlan?: PdfPageGroupSplitPlan;
  tableExtraction?: ExtractPdfFromBufferResult['tableExtraction'];
  /** Audit metadata threaded into `document.convert` (Phase 3-H-3 §4.2). */
  conversion: PdfConversionAudit;
};

/**
 * Converts a pageTexts array into a ReadonlyMap for O(1) page lookup.
 * Used by WU-4 to supply pageRawTexts to augmentOfficialDocWithTableAssist.
 */
export function pageTextsToMap(
  pageTexts: { pageNumber: number; text: string }[]
): ReadonlyMap<number, string> {
  return new Map(pageTexts.map((p) => [p.pageNumber, p.text]));
}

function appendTableAssistReason(
  summary: TableAssistSummary,
  reason: string
): TableAssistSummary {
  return {
    ...summary,
    reason:
      summary.reason === undefined || summary.reason.length === 0
        ? reason
        : `${summary.reason}; ${reason}`,
  };
}

type PdfSubtypePreFlightConfig = {
  flagId: FeatureFlagId;
  extract: (args: { buffer: Buffer; fileName: string }) => Promise<PdfExtractionResult>;
};

/** Gemini OCR `piiFindings` only — not heuristic DLP / Masker output. */
function countUnmaskablePiiFromGeminiOcr(
  piiFindings: ReadonlyArray<{ maskability: 'maskable' | 'unmaskable' }>
): number {
  return piiFindings.filter((finding) => finding.maskability === 'unmaskable')
    .length;
}

export const PDF_SUBTYPE_PRE_FLIGHT_CONFIGS: readonly PdfSubtypePreFlightConfig[] = [
  {
    flagId: 'pdf-conversion-subtype-3',
    extract: async ({ buffer, fileName }) => {
      const result = await extractScanPdfFromBuffer({ buffer, fileName });
      return {
        textContent: result.textContent,
        documentIr: result.documentIr,
        conversion: {
          converterId: result.conversion.converterId,
          inferenceDestination: {
            vendor: 'vertex',
            region: result.conversion.region,
            model: result.conversion.model,
          },
          unmaskablePiiFindingsCount: countUnmaskablePiiFromGeminiOcr(
            result.conversion.piiFindings
          ),
        },
      };
    },
  },
  {
    flagId: 'pdf-conversion-subtype-2',
    extract: async ({ buffer, fileName }) => {
      const result = await extractSlidePdfFromBuffer({ buffer, fileName });
      return {
        textContent: result.textContent,
        documentIr: result.documentIr,
        conversion: {
          converterId: result.conversion.converterId,
          inferenceDestination: {
            vendor: 'vertex',
            region: result.conversion.region,
            model: result.conversion.model,
          },
        },
      };
    },
  },
  {
    flagId: 'pdf-conversion-subtype-1',
    extract: async ({ buffer, fileName }) => {
      const result = await extractPdfFromBuffer({
        buffer,
        fileName,
        sourceSubtype: 'official-doc-pdf',
      });
      return {
        textContent: result.textContent,
        documentIr: result.documentIr,
        pageTexts: result.pageTexts,
        preflightReport: result.preflightReport,
        pageGroupPlan: result.pageGroupPlan,
        tableExtraction: result.tableExtraction,
        conversion: { converterId: 'pdf-parse' },
      };
    },
  },
] as const;

export const PDF_UPLOAD_BETA_DISABLED_MESSAGE =
  'PDF アップロードはベータ機能です。テナントのアクセス権を確認してください。';

export const PDF_CONFLICTING_SUBTYPE_FLAGS_MESSAGE =
  'PDF 変換の feature flag が競合しています。同一テナントで PDF 変換 subtype flag (official-doc-pdf / slide-pdf / scan-pdf) を複数同時に有効にできません。';

export const PDF_EXTRACTION_FAILED_MESSAGE =
  'PDF ファイルを解析できませんでした。';

export type PdfExtractionDispatchFailure =
  | { code: 'no_flag_enabled' }
  | { code: 'conflicting_flags'; enabledFlagIds: FeatureFlagId[] }
  | { code: 'extraction_failed'; cause: unknown };

export type PdfExtractionDispatchOutcome =
  | { ok: true; result: PdfExtractionResult }
  | { ok: false; failure: PdfExtractionDispatchFailure };

export type PdfFlagEnabledReader = (
  flagId: FeatureFlagId
) => Promise<boolean>;

export function createFirestorePdfFlagReader(
  db: Firestore,
  tenantId: string
): PdfFlagEnabledReader {
  return async (flagId) => {
    const flag = await getFeatureFlag(db, flagId);
    return isFeatureEnabled(flag, tenantId);
  };
}

export function buildPdfCuratorContent(result: PdfExtractionResult): string {
  if (result.preflightReport === undefined) {
    return result.textContent;
  }

  return renderPdfPageGroupManifest({
    fileName: result.documentIr.source.fileName,
    preflightReport: result.preflightReport,
    pageGroupPlan: result.pageGroupPlan,
    fallbackText: result.textContent,
  });
}

/**
 * Selects the enabled PDF conversion subtype (feature flag mutex) and runs
 * the matching extractor. Pure branching aside from injected flag reader and
 * extractor I/O.
 */
export async function dispatchPdfExtraction(args: {
  buffer: Buffer;
  fileName: string;
  isFlagEnabled: PdfFlagEnabledReader;
  configs?: readonly PdfSubtypePreFlightConfig[];
  /**
   * Execution-context gate for the grounded Gemini table-assist second pass
   * (P1-E Step 1, Decision 4). Defaults to 'disabled'. Only 'async' — passed
   * exclusively from the async ingest worker — combined with the tenant
   * `pdf-table-assist` flag lets the second pass run. The synchronous upload
   * route MUST pass 'disabled' (or omit it), so a flag alone can never fire
   * the second pass on the sync path.
   */
  tableAssistMode?: 'disabled' | 'async';
  /**
   * Injection seam for tests; defaults to the real, internally fail-soft
   * augmenter. Production never sets this.
   */
  augmentTableAssist?: typeof augmentOfficialDocWithTableAssist;
}): Promise<PdfExtractionDispatchOutcome> {
  const configs = args.configs ?? PDF_SUBTYPE_PRE_FLIGHT_CONFIGS;
  const enabledPdfConfigs: PdfSubtypePreFlightConfig[] = [];

  for (const config of configs) {
    if (await args.isFlagEnabled(config.flagId)) {
      enabledPdfConfigs.push(config);
    }
  }

  if (enabledPdfConfigs.length === 0) {
    return { ok: false, failure: { code: 'no_flag_enabled' } };
  }

  if (enabledPdfConfigs.length > 1) {
    return {
      ok: false,
      failure: {
        code: 'conflicting_flags',
        enabledFlagIds: enabledPdfConfigs.map((config) => config.flagId),
      },
    };
  }

  const selectedPdfConfig = enabledPdfConfigs[0]!;

  let result: PdfExtractionResult;
  try {
    result = await selectedPdfConfig.extract({
      buffer: args.buffer,
      fileName: args.fileName,
    });
  } catch (cause) {
    return { ok: false, failure: { code: 'extraction_failed', cause } };
  }

  // P1-E Step 1 — grounded Gemini table-assist second pass (WU-4).
  //
  // Double-gated (Decision 4): runs only for official-doc-pdf (subtype-1),
  // only in the async execution context (`tableAssistMode === 'async'`), and
  // only when the tenant `pdf-table-assist` flag is on. The flag read reuses
  // the same tenant-bound reader (no new reader is created). subtype-2/3 never
  // reach this branch even when `tableAssistMode === 'async'`, and the
  // synchronous upload path passes 'disabled', so a flag alone cannot fire it.
  //
  // INVARIANT — the merge must happen HERE, before the Masker. Grounding
  // matches each synthesized cell against the raw (pre-mask) pdf-parse page
  // text, so any post-Masker enrichment would reintroduce masked PII into
  // chunks. The augmenter is internally fail-soft (it returns the unchanged
  // pdf-parse IR plus a summary on any failure / per-page timeout), so we let
  // its result flow through rather than swallowing it into `extraction_failed`.
  if (
    selectedPdfConfig.flagId === 'pdf-conversion-subtype-1' &&
    (args.tableAssistMode ?? 'disabled') === 'async' &&
    (await args.isFlagEnabled('pdf-table-assist'))
  ) {
    const augment = args.augmentTableAssist ?? augmentOfficialDocWithTableAssist;
    const pageTexts = result.pageTexts ?? [];
    const outcome = await augment({
      mode: 'async',
      buffer: args.buffer,
      documentIr: result.documentIr,
      pageRawTexts: pageTextsToMap(pageTexts),
    });
    const tableAssistSummary =
      pageTexts.length === 0
        ? appendTableAssistReason(
            outcome.summary,
            'pageTexts unavailable; used DocumentIR block text fallback'
          )
        : outcome.summary;
    result = {
      ...result,
      documentIr: outcome.documentIr,
      conversion: {
        ...result.conversion,
        tableAssist: tableAssistSummary,
      },
    };
  }

  return { ok: true, result };
}

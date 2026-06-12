import type { Firestore } from '@google-cloud/firestore';
import type { DocumentIr } from '../../eval/conversion/documentIr';
import type { PdfConversionAudit } from '../uploadOrchestrator';
import { getFeatureFlag, isFeatureEnabled, type FeatureFlagId } from '../featureFlags';
import { extractPdfFromBuffer } from './pdfDocumentExtractor';
import { extractSlidePdfFromBuffer } from './slidePdfDocumentExtractor';
import { extractScanPdfFromBuffer } from './scanPdfDocumentExtractor';

export type PdfExtractionResult = {
  textContent: string;
  documentIr: DocumentIr;
  /** Audit metadata threaded into `document.convert` (Phase 3-H-3 §4.2). */
  conversion: PdfConversionAudit;
};

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

  try {
    const result = await selectedPdfConfig.extract({
      buffer: args.buffer,
      fileName: args.fileName,
    });
    return { ok: true, result };
  } catch (cause) {
    return { ok: false, failure: { code: 'extraction_failed', cause } };
  }
}

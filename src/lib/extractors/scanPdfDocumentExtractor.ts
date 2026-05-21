/**
 * Mainline scan-pdf extractor — Phase 3-H-3 M6 W1.
 *
 * Reads a scanned PDF buffer through Vertex AI Gemini OCR (structured JSON) and
 * produces a validated {@link DocumentIr}. Promoted from
 * `poc/document-conversion/scan-pdf/extract/geminiOcrExtractor.ts` with boundary
 * changes:
 *   - Input is `{ buffer, fileName }` (PoC took `inputPath`).
 *   - `sourceKind` is `'upload'` and `sourceSubtype` is `'scan-pdf'`.
 *   - Returns audit-ready `conversion` metadata (`converterId`, `calledVertex`,
 *     `model`, `region`, `piiFindings`) for orchestrator / AuditEvent handoff.
 *   - 60s timeout per `D-P3-H-7 Q3` (`AbortController` → `ai.generate({ abortSignal })`).
 *
 * Vertex SDK configuration is reused from `src/agents/_shared/genkitClient`.
 * No pdf-parse fallback — OCR failure paths are fail-closed (`D-P3-H-6 Q2`).
 */
import { location } from '../../agents/_shared/genkitClient';
import {
  DOCUMENT_IR_SCHEMA_VERSION,
  type DocumentIr,
  type DocumentIrBlock,
  type DocumentIrPage,
} from '../../eval/conversion/documentIr';
import {
  ScanPdfGeminiOcrError,
  generateScanPdfGeminiOcr,
  type GeminiScanPdfOutput,
  type GeminiScanPiiFinding,
} from './scanPdfGeminiOcr';

/** Gemini OCR wall-clock limit (`D-P3-H-7 Q3` — max(p95 × 2, 60s) = 60s). */
export const SCAN_PDF_GEMINI_TIMEOUT_MS = 60_000;

// ── Error classification ───────────────────────────────────────────────────────

export type ScanPdfExtractorErrorKind =
  | 'gemini-call-failed'
  | 'gemini-call-timeout'
  | 'gemini-output-empty'
  | 'gemini-schema-validation-failed';

export class ScanPdfExtractorError extends Error {
  readonly kind: ScanPdfExtractorErrorKind;
  readonly attempts?: readonly string[];

  constructor(
    kind: ScanPdfExtractorErrorKind,
    message: string,
    options?: { cause?: unknown; attempts?: readonly string[] }
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ScanPdfExtractorError';
    this.kind = kind;
    if (options?.attempts) this.attempts = options.attempts;
  }
}

function toBboxTuple(
  bbox: number[] | undefined
): [number, number, number, number] | undefined {
  if (!bbox) return undefined;
  return [bbox[0] ?? 0, bbox[1] ?? 0, bbox[2] ?? 0, bbox[3] ?? 0];
}

// ── Public types / API ─────────────────────────────────────────────────────────

export type ExtractScanPdfFromBufferOptions = {
  buffer: Buffer;
  fileName: string;
};

export type ScanPdfConversionMetadata = {
  converterId: 'gemini-vertex-ocr';
  calledVertex: true;
  model: string;
  region: string;
  piiFindings: GeminiScanPiiFinding[];
};

export type ExtractScanPdfFromBufferResult = {
  documentIr: DocumentIr;
  /**
   * Concatenation of all block text (joined with '\n').
   * Used as `extractorInput` for KnowledgeChunk source-hash computation,
   * mirroring {@link import('./slidePdfDocumentExtractor').extractSlidePdfFromBuffer}.
   */
  textContent: string;
  conversion: ScanPdfConversionMetadata;
};

/**
 * Extracts a {@link DocumentIr} from a scanned PDF buffer via Vertex AI Gemini OCR.
 *
 * @throws {ScanPdfExtractorError} fail-closed on any Gemini failure path.
 */
export async function extractScanPdfFromBuffer(
  options: ExtractScanPdfFromBufferOptions
): Promise<ExtractScanPdfFromBufferResult> {
  const extracted = await callGeminiOcr(options.buffer);
  const documentIr = buildScanPdfDocumentIr(options.fileName, extracted);
  const textContent = documentIr.pages
    .map((page) => page.blocks.map((block) => block.text).join('\n'))
    .join('\n');
  return {
    documentIr,
    textContent,
    conversion: {
      converterId: 'gemini-vertex-ocr',
      calledVertex: true,
      model: extracted.model,
      region: location,
      piiFindings: extracted.piiFindings,
    },
  };
}

// ── Internals ──────────────────────────────────────────────────────────────────

async function callGeminiOcr(
  buffer: Buffer
): Promise<GeminiScanPdfOutput & { model: string }> {
  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => {
    controller.abort();
  }, SCAN_PDF_GEMINI_TIMEOUT_MS);

  try {
    const result = await generateScanPdfGeminiOcr({
      buffer,
      abortSignal: controller.signal,
    });
    return { ...result.output, model: result.model };
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new ScanPdfExtractorError(
        'gemini-call-timeout',
        `Gemini scan-pdf OCR did not complete within ${SCAN_PDF_GEMINI_TIMEOUT_MS}ms`,
        cause instanceof Error ? { cause } : undefined
      );
    }
    if (cause instanceof ScanPdfGeminiOcrError) {
      throw new ScanPdfExtractorError(cause.kind, cause.message, {
        cause: cause.cause ?? cause,
        attempts: cause.attempts,
      });
    }
    throw cause;
  } finally {
    clearTimeout(timeoutTimer);
  }
}

function buildScanPdfDocumentIr(
  fileName: string,
  extracted: GeminiScanPdfOutput
): DocumentIr {
  const pages: DocumentIrPage[] = extracted.pages.map((page) => {
    const blocks: DocumentIrBlock[] = [];
    let blockSeq = 0;

    for (const block of page.blocks) {
      const text = block.text.trim();
      if (!text) continue;
      blockSeq += 1;
      blocks.push({
        blockId: `p${page.pageNumber}-ocr${blockSeq}`,
        kind: block.kind,
        text,
        locator: {
          pageNumber: page.pageNumber,
          bbox: toBboxTuple(block.bbox),
        },
        metadata: {
          ...block.metadata,
          extractionProvider: 'gemini-vertex-ocr',
          ocrConfidence: block.confidence,
        },
      });
    }

    return { pageNumber: page.pageNumber, blocks };
  });

  return {
    schemaVersion: DOCUMENT_IR_SCHEMA_VERSION,
    source: {
      fileName,
      mediaType: 'application/pdf',
      sourceKind: 'upload',
      sourceSubtype: 'scan-pdf',
    },
    pages,
  };
}

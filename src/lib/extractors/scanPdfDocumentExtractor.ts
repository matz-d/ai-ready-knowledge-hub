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
import { z } from 'zod';
import { ai, location, modelId, modelRef } from '../../agents/_shared/genkitClient';
import {
  DOCUMENT_IR_SCHEMA_VERSION,
  type DocumentIr,
  type DocumentIrBlock,
  type DocumentIrPage,
} from '../../eval/conversion/documentIr';

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

// ── Gemini structured output schema ────────────────────────────────────────────

const GeminiScanPiiFindingSchema = z.object({
  pageNumber: z.number().int().min(1),
  category: z.enum([
    'person_name',
    'email',
    'phone',
    'address',
    'employee_id',
    'customer_id',
    'bank_account',
    'my_number_like',
    'other',
  ]),
  evidenceSnippet: z.string(),
  maskability: z.enum(['maskable', 'unmaskable']),
  reason: z.string(),
});

const GeminiScanBlockSchema = z.object({
  kind: z.enum(['paragraph', 'heading', 'table', 'image_text', 'note']),
  text: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  bbox: z.array(z.number()).length(4).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const GeminiScanPageSchema = z.object({
  pageNumber: z.number().int().min(1),
  blocks: z.array(GeminiScanBlockSchema),
});

export const GeminiScanPdfOutputSchema = z.object({
  pages: z.array(GeminiScanPageSchema),
  piiFindings: z.array(GeminiScanPiiFindingSchema),
  warnings: z.array(z.string()).optional(),
});

export type GeminiScanPdfOutput = z.infer<typeof GeminiScanPdfOutputSchema>;
export type GeminiScanPiiFinding = z.infer<typeof GeminiScanPiiFindingSchema>;

function parseJsonFromModelText(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  const raw = fence ? fence[1]!.trim() : trimmed;
  return JSON.parse(raw) as unknown;
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

function assertNonEmptyScanGeminiOutput(extracted: GeminiScanPdfOutput): void {
  if (extracted.pages.length === 0) {
    throw new ScanPdfExtractorError(
      'gemini-output-empty',
      'Gemini returned zero pages'
    );
  }

  const hasVisibleText = extracted.pages.some((page) =>
    page.blocks.some((block) => block.text.trim().length > 0)
  );

  if (!hasVisibleText) {
    throw new ScanPdfExtractorError(
      'gemini-output-empty',
      'Gemini returned pages with no extractable text'
    );
  }
}

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
      model: modelId,
      region: location,
      piiFindings: extracted.piiFindings,
    },
  };
}

// ── Internals ──────────────────────────────────────────────────────────────────

async function callGeminiOcr(buffer: Buffer): Promise<GeminiScanPdfOutput> {
  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => {
    controller.abort();
  }, SCAN_PDF_GEMINI_TIMEOUT_MS);

  try {
    return await performGeminiOcrGenerate(buffer, controller.signal);
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new ScanPdfExtractorError(
        'gemini-call-timeout',
        `Gemini scan-pdf OCR did not complete within ${SCAN_PDF_GEMINI_TIMEOUT_MS}ms`,
        cause instanceof Error ? { cause } : undefined
      );
    }
    throw cause;
  } finally {
    clearTimeout(timeoutTimer);
  }
}

async function performGeminiOcrGenerate(
  buffer: Buffer,
  abortSignal: AbortSignal
): Promise<GeminiScanPdfOutput> {
  const pdfDataUri = `data:application/pdf;base64,${buffer.toString('base64')}`;

  let response: Awaited<ReturnType<typeof ai.generate>>;
  try {
    response = await ai.generate({
      model: modelRef(),
      abortSignal,
      system:
        'You are an OCR engine for scanned PDFs in an AI-ready document upload pipeline. Return only JSON grounded in visible page content.',
      prompt: [
        {
          text:
            'Read this PDF as scanned pages. Extract visible text in reading order into pages[].blocks. Use image_text when the text is embedded in a scan/photo or when layout confidence is low. Preserve page numbers. Also inspect the extracted text for PII-like strings. Mark a PII finding as maskable only when the exact text span is present and can be replaced safely by a masker. Mark it as unmaskable when OCR uncertainty, fragmentation, handwriting, partial visibility, or context-only identification means a downstream masker cannot reliably span-mask it. Return JSON only, with no markdown fences.',
        },
        {
          media: {
            url: pdfDataUri,
            contentType: 'application/pdf',
          },
        },
      ],
      output: {
        schema: GeminiScanPdfOutputSchema,
        constrained: true,
      },
      config: {
        temperature: 0,
        maxOutputTokens: 8192,
      },
    });
  } catch (cause) {
    if (abortSignal.aborted) {
      throw cause;
    }
    throw new ScanPdfExtractorError(
      'gemini-call-failed',
      `Gemini generate() failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause }
    );
  }

  const hasOutput = response.output != null;
  const hasText = typeof response.text === 'string' && response.text.trim().length > 0;
  if (!hasOutput && !hasText) {
    throw new ScanPdfExtractorError(
      'gemini-output-empty',
      'Gemini returned empty output and text'
    );
  }

  const attempts: string[] = [];

  if (hasOutput) {
    const parsed = GeminiScanPdfOutputSchema.safeParse(response.output);
    if (parsed.success) {
      assertNonEmptyScanGeminiOutput(parsed.data);
      return parsed.data;
    }
    attempts.push(`structured(output): ${parsed.error.message}`);
  }

  if (hasText) {
    try {
      const parsedText = GeminiScanPdfOutputSchema.safeParse(
        parseJsonFromModelText(response.text!)
      );
      if (parsedText.success) {
        assertNonEmptyScanGeminiOutput(parsedText.data);
        return parsedText.data;
      }
      attempts.push(`structured(text): ${parsedText.error.message}`);
    } catch (e) {
      attempts.push(
        `structured(text) JSON.parse: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  throw new ScanPdfExtractorError(
    'gemini-schema-validation-failed',
    `Gemini scan-pdf OCR output failed schema validation: ${attempts.join(' | ')}`,
    { attempts }
  );
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

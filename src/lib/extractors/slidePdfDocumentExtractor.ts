/**
 * Mainline slide-pdf extractor — Phase 3-H-3 M1.
 *
 * Reads a PDF buffer through Vertex AI Gemini (direct PDF input, structured
 * output) and produces a validated {@link DocumentIr}. Promoted from
 * `poc/document-conversion/slide-pdf/extract/` with three boundary changes:
 *   - Input is `{ buffer, fileName }` (PoC took `inputPath`).
 *   - `sourceKind` is `'upload'` and `sourceSubtype` is `'slide-pdf'`.
 *   - Returns audit-ready `conversion` metadata (`converterId`, `calledVertex`,
 *     `model`, `region`) so the orchestrator can attach `inferenceDestination`
 *     to the `document.convert` AuditEvent on Gemini-success paths.
 *
 * Vertex SDK configuration (`GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION` /
 * `GEMINI_MODEL`) is reused from `src/agents/_shared/genkitClient`. No new SDK
 * boundary is introduced.
 *
 * ── Handoff to next worker (Phase 3-H-3 M2.4 / 2.5) ────────────────────────────
 * - This extractor is **fail-closed**. The PoC's `pdf-parse` fallback and
 *   `SLIDE_PDF_SKIP_GEMINI` escape hatch must NOT be carried into the mainline
 *   (`D-P3-H-6 Q2`). Failures throw {@link SlidePdfExtractorError}; the caller
 *   maps to `evalStatus: 'fail' | 'error'` and does not chunk.
 * - Successful return implies Gemini was called: `conversion.calledVertex` is
 *   the literal `true` and `conversion.converterId` is `'gemini-direct-read'`.
 *   Use these to gate `inferenceDestination` on the `document.convert`
 *   AuditEvent (required only on subtype 2/3 + Gemini-success, per §4.2).
 * - For subtype 3 (`scan-pdf`), do not extend this file. Add a sibling
 *   extractor with its own converterId and consider a small
 *   `selectPdfExtractionForUpload(...)` helper so `/api/documents` stays thin.
 */
import { z } from 'zod';
import { ai, location, modelId, modelRef } from '../../agents/_shared/genkitClient';
import {
  DOCUMENT_IR_SCHEMA_VERSION,
  type DocumentIr,
  type DocumentIrBlock,
  type DocumentIrPage,
} from '../../eval/conversion/documentIr';

// ── Error classification ───────────────────────────────────────────────────────
//
// Three distinguishable failure modes so logs / AuditEvent / smoke tests can
// tell them apart. Anything that escapes this extractor is fail-closed for the
// upload path.

export type SlidePdfExtractorErrorKind =
  | 'gemini-call-failed'           // ai.generate() threw (quota, network, region, auth)
  | 'gemini-output-empty'          // both response.output and response.text are absent
  | 'gemini-schema-validation-failed'; // output and/or text present but not parseable as GeminiSlidePdfOutput

export class SlidePdfExtractorError extends Error {
  readonly kind: SlidePdfExtractorErrorKind;
  readonly attempts?: readonly string[];

  constructor(
    kind: SlidePdfExtractorErrorKind,
    message: string,
    options?: { cause?: unknown; attempts?: readonly string[] }
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'SlidePdfExtractorError';
    this.kind = kind;
    if (options?.attempts) this.attempts = options.attempts;
  }
}

// ── Gemini structured output schema ────────────────────────────────────────────

const GeminiSlideBlockSchema = z.object({
  kind: z.enum(['paragraph', 'heading', 'table', 'image_text', 'note']),
  text: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const GeminiSlideSchema = z.object({
  slideNumber: z.number().int().min(1),
  title: z.string().optional(),
  blocks: z.array(GeminiSlideBlockSchema),
});

export const GeminiSlidePdfOutputSchema = z.object({
  slides: z.array(GeminiSlideSchema),
  warnings: z.array(z.string()).optional(),
});

export type GeminiSlidePdfOutput = z.infer<typeof GeminiSlidePdfOutputSchema>;

function parseJsonFromModelText(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  const raw = fence ? fence[1]!.trim() : trimmed;
  return JSON.parse(raw) as unknown;
}

// ── Public types / API ─────────────────────────────────────────────────────────

export type ExtractSlidePdfFromBufferOptions = {
  buffer: Buffer;
  fileName: string;
};

/**
 * Audit-ready conversion metadata.
 *
 * Returned on success so the orchestrator can:
 *   - Set `AuditEventConversion.converterId` directly.
 *   - Build `AuditInferenceDestination = { vendor: 'vertex', region, model }`
 *     when `calledVertex` is true (gating per phase-3-h-3-direction §4.2).
 */
export type SlidePdfConversionMetadata = {
  converterId: 'gemini-direct-read';
  calledVertex: true;
  /** Vertex Gemini model id actually used (mirrors `genkitClient.modelId`). */
  model: string;
  /** Vertex region actually used (mirrors `genkitClient.location`). */
  region: string;
};

export type ExtractSlidePdfFromBufferResult = {
  documentIr: DocumentIr;
  /**
   * Concatenation of all block text (joined with '\n').
   * Used as `extractorInput` for KnowledgeChunk source-hash computation,
   * mirroring the contract of {@link import('./pdfDocumentExtractor').extractPdfFromBuffer}.
   */
  textContent: string;
  conversion: SlidePdfConversionMetadata;
};

/**
 * Extracts a {@link DocumentIr} from a slide-style PDF buffer via Vertex AI Gemini.
 *
 * @throws {SlidePdfExtractorError} fail-closed on any Gemini failure path.
 */
function assertNonEmptySlideGeminiOutput(extracted: GeminiSlidePdfOutput): void {
  if (extracted.slides.length === 0) {
    throw new SlidePdfExtractorError(
      'gemini-output-empty',
      'Gemini returned zero slides'
    );
  }

  const hasVisibleText = extracted.slides.some((slide) => {
    if (slide.title?.trim()) return true;
    return slide.blocks.some((block) => block.text.trim().length > 0);
  });

  if (!hasVisibleText) {
    throw new SlidePdfExtractorError(
      'gemini-output-empty',
      'Gemini returned slides with no extractable text'
    );
  }
}

export async function extractSlidePdfFromBuffer(
  options: ExtractSlidePdfFromBufferOptions
): Promise<ExtractSlidePdfFromBufferResult> {
  const extracted = await callGeminiDirect(options.buffer);
  const documentIr = buildSlidePdfDocumentIr(options.fileName, extracted);
  const textContent = documentIr.pages
    .map((page) => page.blocks.map((block) => block.text).join('\n'))
    .join('\n');
  return {
    documentIr,
    textContent,
    conversion: {
      converterId: 'gemini-direct-read',
      calledVertex: true,
      model: modelId,
      region: location,
    },
  };
}

// ── Internals ──────────────────────────────────────────────────────────────────

async function callGeminiDirect(
  buffer: Buffer
): Promise<GeminiSlidePdfOutput> {
  const pdfDataUri = `data:application/pdf;base64,${buffer.toString('base64')}`;

  let response: Awaited<ReturnType<typeof ai.generate>>;
  try {
    response = await ai.generate({
      model: modelRef(),
      system:
        'You convert slide-style PDFs into compact, page-located JSON for an upload pipeline. Return only facts visible in the PDF.',
      prompt: [
        {
          text:
            'Read this PDF directly. Treat each PDF page as one slide. Return JSON with slides[].slideNumber and slides[].blocks. Use heading for slide titles, paragraph for body text, table for table-like rows, image_text for visible text embedded in figures/screenshots, and note for speaker-note-like or marginal text. Preserve reading order within each slide. Do not include markdown fences.',
        },
        {
          media: {
            url: pdfDataUri,
            contentType: 'application/pdf',
          },
        },
      ],
      output: {
        schema: GeminiSlidePdfOutputSchema,
        constrained: true,
      },
      config: {
        temperature: 0,
        maxOutputTokens: 8192,
      },
    });
  } catch (cause) {
    throw new SlidePdfExtractorError(
      'gemini-call-failed',
      `Gemini generate() failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause }
    );
  }

  const hasOutput = response.output != null;
  const hasText = typeof response.text === 'string' && response.text.trim().length > 0;
  if (!hasOutput && !hasText) {
    throw new SlidePdfExtractorError(
      'gemini-output-empty',
      'Gemini returned empty output and text'
    );
  }

  const attempts: string[] = [];

  if (hasOutput) {
    const parsed = GeminiSlidePdfOutputSchema.safeParse(response.output);
    if (parsed.success) {
      assertNonEmptySlideGeminiOutput(parsed.data);
      return parsed.data;
    }
    attempts.push(`structured(output): ${parsed.error.message}`);
  }

  if (hasText) {
    try {
      const parsedText = GeminiSlidePdfOutputSchema.safeParse(
        parseJsonFromModelText(response.text!)
      );
      if (parsedText.success) {
        assertNonEmptySlideGeminiOutput(parsedText.data);
        return parsedText.data;
      }
      attempts.push(`structured(text): ${parsedText.error.message}`);
    } catch (e) {
      attempts.push(
        `structured(text) JSON.parse: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  throw new SlidePdfExtractorError(
    'gemini-schema-validation-failed',
    `Gemini slide-pdf output failed schema validation: ${attempts.join(' | ')}`,
    { attempts }
  );
}

function buildSlidePdfDocumentIr(
  fileName: string,
  extracted: GeminiSlidePdfOutput
): DocumentIr {
  const pages: DocumentIrPage[] = extracted.slides.map((slide) => {
    const blocks: DocumentIrBlock[] = [];
    let blockSeq = 0;

    if (slide.title?.trim()) {
      blocks.push({
        blockId: `s${slide.slideNumber}-title`,
        kind: 'heading',
        text: slide.title.trim(),
        locator: {
          pageNumber: slide.slideNumber,
          slideNumber: slide.slideNumber,
        },
        metadata: { headingLevel: 1, extractionProvider: 'gemini-direct' },
      });
    }

    for (const block of slide.blocks) {
      const text = block.text.trim();
      if (!text) continue;
      blockSeq += 1;
      blocks.push({
        blockId: `s${slide.slideNumber}-b${blockSeq}`,
        kind: block.kind,
        text,
        locator: {
          pageNumber: slide.slideNumber,
          slideNumber: slide.slideNumber,
        },
        metadata: {
          ...block.metadata,
          extractionProvider: 'gemini-direct',
        },
      });
    }

    return { pageNumber: slide.slideNumber, blocks };
  });

  return {
    schemaVersion: DOCUMENT_IR_SCHEMA_VERSION,
    source: {
      fileName,
      mediaType: 'application/pdf',
      sourceKind: 'upload',
      sourceSubtype: 'slide-pdf',
    },
    pages,
  };
}

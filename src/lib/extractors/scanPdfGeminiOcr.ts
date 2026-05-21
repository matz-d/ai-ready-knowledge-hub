import { z } from 'zod';
import { ai, modelId, modelRef } from '../../agents/_shared/genkitClient';

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
  // Vertex response_json_schema rejects tuple-style `items: [...]`.
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

const GeminiUsageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  totalTokens: z.number().optional(),
  inputCharacters: z.number().optional(),
  outputCharacters: z.number().optional(),
  inputImages: z.number().optional(),
  thoughtsTokens: z.number().optional(),
  cachedContentTokens: z.number().optional(),
});

export type GeminiScanPdfOutput = z.infer<typeof GeminiScanPdfOutputSchema>;
export type GeminiScanPiiFinding = z.infer<typeof GeminiScanPiiFindingSchema>;
export type GeminiOcrUsage = z.infer<typeof GeminiUsageSchema>;

export const SCAN_PDF_GEMINI_OCR_SYSTEM_PROMPT =
  'You are an OCR engine for scanned PDFs in an AI-ready document conversion pipeline. Return only JSON grounded in visible page content.';

export const SCAN_PDF_GEMINI_OCR_PROMPT =
  'Read this PDF as scanned pages. Extract visible text in reading order into pages[].blocks. Use image_text when the text is embedded in a scan/photo or when layout confidence is low. Preserve page numbers. Also inspect the extracted text for PII-like strings. Mark a PII finding as maskable only when the exact text span is present and can be replaced safely by a masker. Mark it as unmaskable when OCR uncertainty, fragmentation, handwriting, partial visibility, or context-only identification means a downstream masker cannot reliably span-mask it. A visibly labeled PII field with a value clipped or obscured by scan damage is unmaskable even when only fragments remain. Return JSON only, with no markdown fences.';

export type ScanPdfGeminiOcrErrorKind =
  | 'gemini-call-failed'
  | 'gemini-output-empty'
  | 'gemini-schema-validation-failed';

export class ScanPdfGeminiOcrError extends Error {
  readonly kind: ScanPdfGeminiOcrErrorKind;
  readonly attempts?: readonly string[];

  constructor(
    kind: ScanPdfGeminiOcrErrorKind,
    message: string,
    options?: { cause?: unknown; attempts?: readonly string[] }
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ScanPdfGeminiOcrError';
    this.kind = kind;
    if (options?.attempts) this.attempts = options.attempts;
  }
}

export type GenerateScanPdfGeminiOcrOptions = {
  buffer: Buffer;
  abortSignal?: AbortSignal;
};

export type GenerateScanPdfGeminiOcrResult = {
  output: GeminiScanPdfOutput;
  usage: GeminiOcrUsage;
  model: string;
};

function parseJsonFromModelText(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  const raw = fence ? fence[1]!.trim() : trimmed;
  return JSON.parse(raw) as unknown;
}

function assertNonEmptyScanGeminiOutput(extracted: GeminiScanPdfOutput): void {
  if (extracted.pages.length === 0) {
    throw new ScanPdfGeminiOcrError(
      'gemini-output-empty',
      'Gemini returned zero pages'
    );
  }

  const hasVisibleText = extracted.pages.some((page) =>
    page.blocks.some((block) => block.text.trim().length > 0)
  );

  if (!hasVisibleText) {
    throw new ScanPdfGeminiOcrError(
      'gemini-output-empty',
      'Gemini returned pages with no extractable text'
    );
  }
}

function parseGeminiScanPdfOutput(response: {
  output?: unknown;
  text?: string;
}): GeminiScanPdfOutput {
  const hasOutput = response.output != null;
  const hasText = typeof response.text === 'string' && response.text.trim().length > 0;
  if (!hasOutput && !hasText) {
    throw new ScanPdfGeminiOcrError(
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
    } catch (error) {
      attempts.push(
        `structured(text) JSON.parse: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  throw new ScanPdfGeminiOcrError(
    'gemini-schema-validation-failed',
    `Gemini scan-pdf OCR output failed schema validation: ${attempts.join(' | ')}`,
    { attempts }
  );
}

export async function generateScanPdfGeminiOcr(
  options: GenerateScanPdfGeminiOcrOptions
): Promise<GenerateScanPdfGeminiOcrResult> {
  const pdfDataUri = `data:application/pdf;base64,${options.buffer.toString(
    'base64'
  )}`;

  let response: Awaited<ReturnType<typeof ai.generate>>;
  try {
    response = await ai.generate({
      model: modelRef(),
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
      system: SCAN_PDF_GEMINI_OCR_SYSTEM_PROMPT,
      prompt: [
        { text: SCAN_PDF_GEMINI_OCR_PROMPT },
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
    if (options.abortSignal?.aborted) throw cause;
    throw new ScanPdfGeminiOcrError(
      'gemini-call-failed',
      `Gemini generate() failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause }
    );
  }

  return {
    output: parseGeminiScanPdfOutput(response),
    usage: GeminiUsageSchema.parse(response.usage ?? {}),
    model: response.model ?? modelId,
  };
}

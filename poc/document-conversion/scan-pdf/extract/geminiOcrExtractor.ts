import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { ai, modelId, modelRef } from '../../../../src/agents/_shared/genkitClient';

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
  // Keep the model-facing schema as a fixed-length array and coerce to
  // DocumentIR's tuple shape in the adapter.
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

export type ExtractScanPdfWithGeminiResult = {
  output: GeminiScanPdfOutput;
  usage: GeminiOcrUsage;
  model: string;
  durationMs: number;
};

function parseJsonFromModelText(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  const raw = fence ? fence[1]!.trim() : trimmed;
  return JSON.parse(raw) as unknown;
}

export type ExtractScanPdfWithGeminiOptions = {
  inputPath: string;
};

export async function extractScanPdfWithGemini(
  options: ExtractScanPdfWithGeminiOptions
): Promise<ExtractScanPdfWithGeminiResult> {
  const startedAt = Date.now();
  const pdf = await readFile(options.inputPath);
  const pdfDataUri = `data:application/pdf;base64,${pdf.toString('base64')}`;

  const response = await ai.generate({
    model: modelRef(),
    system:
      'You are an OCR engine for scanned PDFs in an AI-ready document conversion PoC. Return only JSON grounded in visible page content.',
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

  const parsed = GeminiScanPdfOutputSchema.safeParse(response.output);
  if (parsed.success) {
    return {
      output: parsed.data,
      usage: GeminiUsageSchema.parse(response.usage ?? {}),
      model: response.model ?? modelId,
      durationMs: Date.now() - startedAt,
    };
  }

  if (response.text) {
    const parsedText = GeminiScanPdfOutputSchema.safeParse(
      parseJsonFromModelText(response.text)
    );
    if (parsedText.success) {
      return {
        output: parsedText.data,
        usage: GeminiUsageSchema.parse(response.usage ?? {}),
        model: response.model ?? modelId,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  throw new Error(
    `Gemini scan-pdf OCR output failed schema validation: ${parsed.error.message}`
  );
}

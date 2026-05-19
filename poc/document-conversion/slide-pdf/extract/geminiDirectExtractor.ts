import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { ai, modelRef } from '../../../../src/agents/_shared/genkitClient';

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

export type ExtractSlidePdfWithGeminiOptions = {
  inputPath: string;
};

export async function extractSlidePdfWithGemini(
  options: ExtractSlidePdfWithGeminiOptions
): Promise<GeminiSlidePdfOutput> {
  const pdf = await readFile(options.inputPath);
  const pdfDataUri = `data:application/pdf;base64,${pdf.toString('base64')}`;

  const response = await ai.generate({
    model: modelRef(),
    system:
      'You convert slide-style PDFs into compact, page-located JSON for a document conversion PoC. Return only facts visible in the PDF.',
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

  const parsed = GeminiSlidePdfOutputSchema.safeParse(response.output);
  if (parsed.success) return parsed.data;

  if (response.text) {
    const parsedText = GeminiSlidePdfOutputSchema.safeParse(
      parseJsonFromModelText(response.text)
    );
    if (parsedText.success) return parsedText.data;
  }

  throw new Error(
    `Gemini slide-pdf output failed schema validation: ${parsed.error.message}`
  );
}

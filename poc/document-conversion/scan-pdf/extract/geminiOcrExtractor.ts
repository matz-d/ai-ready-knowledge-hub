import { readFile } from 'node:fs/promises';
import {
  generateScanPdfGeminiOcr,
  type GeminiOcrUsage,
  type GeminiScanPdfOutput,
  type GeminiScanPiiFinding,
} from '../../../../src/lib/extractors/scanPdfGeminiOcr';

export type { GeminiOcrUsage, GeminiScanPdfOutput, GeminiScanPiiFinding };

export type ExtractScanPdfWithGeminiResult = {
  output: GeminiScanPdfOutput;
  usage: GeminiOcrUsage;
  model: string;
  durationMs: number;
};

export type ExtractScanPdfWithGeminiOptions = {
  inputPath: string;
};

export async function extractScanPdfWithGemini(
  options: ExtractScanPdfWithGeminiOptions
): Promise<ExtractScanPdfWithGeminiResult> {
  const startedAt = Date.now();
  const pdf = await readFile(options.inputPath);
  const result = await generateScanPdfGeminiOcr({ buffer: pdf });

  return {
    output: result.output,
    usage: result.usage,
    model: result.model,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * P1-E Step 1 — table-only Gemini second pass for one (already split) page.
 *
 * Mirrors the production `scanPdfGeminiOcr.ts` call shape (constrained output,
 * AbortSignal, text-fallback parse, typed error). It only asks for visible
 * table-like rows; correctness is enforced downstream by cell-level grounding,
 * so this pass is allowed to be noisy.
 */
import { z } from 'zod';
import { ai, modelId, modelRefFor } from '../../../agents/_shared/genkitClient';
import type { RawTableRow } from './types';

const GeminiTableRowSchema = z.object({
  cells: z.array(z.string()),
});

export const GeminiTableOnlyOutputSchema = z.object({
  rows: z.array(GeminiTableRowSchema),
});

export type GeminiTableOnlyOutput = z.infer<typeof GeminiTableOnlyOutputSchema>;

export const officialDocTableAssistModelId =
  process.env.OFFICIAL_DOC_TABLE_ASSIST_MODEL ?? modelId;

export const OFFICIAL_DOC_TABLE_ASSIST_SYSTEM_PROMPT =
  'You extract visible table rows from a single page of a born-digital Japanese public document, for a document-conversion pipeline. Return only JSON grounded in text actually visible on the page.';

export const OFFICIAL_DOC_TABLE_ASSIST_PROMPT =
  'This PDF is one page from a public document. Extract only visible table rows and table-like label/value rows into rows[]. Each row is { "cells": [left-to-right cell texts] }. Use only text actually visible on the page. Do not infer, summarize, complete, translate, or merge unrelated lines, and do not add rows that are not visibly tabular. If the page has no table-like rows, return { "rows": [] }. Return JSON only, with no markdown fences.';

export type OfficialDocTableAssistErrorKind =
  | 'gemini-call-failed'
  | 'gemini-output-empty'
  | 'gemini-schema-validation-failed';

export class OfficialDocTableAssistError extends Error {
  readonly kind: OfficialDocTableAssistErrorKind;

  constructor(
    kind: OfficialDocTableAssistErrorKind,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : undefined
    );
    this.name = 'OfficialDocTableAssistError';
    this.kind = kind;
  }
}

function parseJsonFromModelText(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  const raw = fence ? fence[1]!.trim() : trimmed;
  return JSON.parse(raw) as unknown;
}

function parseTableOnlyOutput(response: {
  output?: unknown;
  text?: string;
}): GeminiTableOnlyOutput {
  const hasOutput = response.output != null;
  const hasText =
    typeof response.text === 'string' && response.text.trim().length > 0;

  if (hasOutput) {
    const parsed = GeminiTableOnlyOutputSchema.safeParse(response.output);
    if (parsed.success) return parsed.data;
  }
  if (hasText) {
    try {
      const parsed = GeminiTableOnlyOutputSchema.safeParse(
        parseJsonFromModelText(response.text!)
      );
      if (parsed.success) return parsed.data;
    } catch {
      // fall through to the error below
    }
  }
  if (!hasOutput && !hasText) {
    // An empty table page is legitimate (no tables on the page).
    return { rows: [] };
  }
  throw new OfficialDocTableAssistError(
    'gemini-schema-validation-failed',
    'Gemini table-assist output failed schema validation'
  );
}

/**
 * Runs the table-only pass on one single-page PDF and returns raw rows tagged
 * with the caller-supplied (authoritative) page number. Empty cells are dropped.
 */
export async function extractTableRowsForPage(options: {
  pdfBytes: Uint8Array;
  pageNumber: number;
  abortSignal?: AbortSignal;
}): Promise<RawTableRow[]> {
  const pdfDataUri = `data:application/pdf;base64,${Buffer.from(
    options.pdfBytes
  ).toString('base64')}`;

  let response: Awaited<ReturnType<typeof ai.generate>>;
  try {
    response = await ai.generate({
      model: modelRefFor(officialDocTableAssistModelId),
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
      system: OFFICIAL_DOC_TABLE_ASSIST_SYSTEM_PROMPT,
      prompt: [
        { text: OFFICIAL_DOC_TABLE_ASSIST_PROMPT },
        { media: { url: pdfDataUri, contentType: 'application/pdf' } },
      ],
      output: { schema: GeminiTableOnlyOutputSchema, constrained: true },
      config: { temperature: 0, maxOutputTokens: 8192 },
    });
  } catch (cause) {
    if (options.abortSignal?.aborted) throw cause;
    throw new OfficialDocTableAssistError(
      'gemini-call-failed',
      `Gemini generate() failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause }
    );
  }

  const output = parseTableOnlyOutput(response);
  return output.rows
    .map((row) => ({
      pageNumber: options.pageNumber,
      cells: row.cells.map((cell) => cell.trim()).filter((cell) => cell.length > 0),
    }))
    .filter((row) => row.cells.length > 0);
}

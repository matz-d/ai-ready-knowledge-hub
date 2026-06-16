/**
 * WU-6a — masking safety regression for the table-assist second pass.
 *
 * The grounded Gemini table-assist pass re-surfaces text that already exists in
 * the *raw* (pre-mask) pdf-parse output as new table structure. This is only
 * safe because the merge happens inside the extractor dispatch — strictly
 * BEFORE the Masker. This test pins that invariant as an executable trip-wire:
 *
 *   dispatchPdfExtraction (merge)  →  documentIrToKnowledgeChunks  →  Masker
 *
 * A masking-target token (a phone number) lives in the raw page text; the
 * injected Gemini pass grounds a table row on it; the merge appends that row as
 * a table block; the chunk adapter turns it into a chunk; the Masker masks it.
 * If anyone ever moved the merge AFTER the Masker (the forbidden post-terminal
 * enrichment), the grounded cell would bypass masking and this test would fail
 * with the raw phone number still present in the chunk.
 *
 * Only the Gemini call and PDF page-split are faked (injected deps). The real
 * grounding + merge + chunk adapter + simple-rule Masker all run.
 */
import { describe, expect, it } from 'vitest';
import type { DocumentIr } from '../../../eval/conversion/documentIr';
import { maskKnowledgeChunk } from '../../../agents/masker/maskKnowledgeChunk';
import { documentIrToKnowledgeChunks } from '../../conversion/documentIrToKnowledgeChunk';
import { augmentOfficialDocWithTableAssist } from '../officialDocPdfTableAssist';
import {
  dispatchPdfExtraction,
  type PdfExtractionResult,
} from '../pdfExtractionDispatcher';

/** PII token the Masker must redact via the deterministic `phone_like` rule. */
const MASK_TARGET_PHONE = '03-1234-5678';
/** A second cell that also grounds, so the row clears MIN_GROUNDED_CELLS_PER_ROW. */
const GROUNDING_LABEL = '電話';

/**
 * Raw pdf-parse page text. Two row-like lines so the page is selected as a
 * table-assist candidate, and it contains both grounding cells (the token must
 * already be in the raw text for the grounded cell to survive).
 */
const RAW_PAGE_TEXT = [
  '時間外労働の上限 月 45時間',
  `担当 ${GROUNDING_LABEL} ${MASK_TARGET_PHONE}`,
].join('\n');

function officialDocExtractionResult(): PdfExtractionResult {
  const documentIr: DocumentIr = {
    schemaVersion: 1,
    source: {
      fileName: 'labor-notice.pdf',
      mediaType: 'application/pdf',
      sourceKind: 'upload',
      sourceSubtype: 'official-doc-pdf',
    },
    pages: [
      {
        pageNumber: 1,
        // Single pdf-parse paragraph block carrying the raw (pre-mask) PII.
        blocks: [{ blockId: 'p1-b0', kind: 'paragraph', text: RAW_PAGE_TEXT }],
      },
    ],
  };

  return {
    textContent: RAW_PAGE_TEXT,
    documentIr,
    pageTexts: [{ pageNumber: 1, text: RAW_PAGE_TEXT }],
    conversion: { converterId: 'pdf-parse' },
  };
}

/**
 * Runs the REAL augmenter (grounding + merge) with only Gemini + page-split
 * faked: the injected table-only pass emits a row that grounds on the raw PII.
 */
const augmentWithFakeGemini: typeof augmentOfficialDocWithTableAssist = (
  options
) =>
  augmentOfficialDocWithTableAssist({
    ...options,
    deps: {
      splitPages: async ({ pageNumbers }) =>
        pageNumbers.map((pageNumber) => ({
          pageNumber,
          pdfBytes: new Uint8Array(),
        })),
      extractTableRowsForPage: async ({ pageNumber }) => [
        { pageNumber, cells: [GROUNDING_LABEL, MASK_TARGET_PHONE] },
      ],
    },
  });

describe('table-assist masking safety regression (WU-6a)', () => {
  it('masks a token that table-assist re-surfaces from raw text into a chunk', async () => {
    // 1) dispatch with table-assist active (subtype-1 + async + flag on).
    const outcome = await dispatchPdfExtraction({
      buffer: Buffer.from('%PDF-1.4 fake'),
      fileName: 'labor-notice.pdf',
      isFlagEnabled: async (flagId) =>
        flagId === 'pdf-conversion-subtype-1' || flagId === 'pdf-table-assist',
      tableAssistMode: 'async',
      configs: [
        {
          flagId: 'pdf-conversion-subtype-1',
          extract: async () => officialDocExtractionResult(),
        },
      ],
      augmentTableAssist: augmentWithFakeGemini,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected extraction to succeed');

    // The merge ran inside dispatch and produced one grounded table row.
    expect(outcome.result.conversion.tableAssist?.status).toBe('merged');
    expect(outcome.result.conversion.tableAssist?.rowsMerged).toBe(1);

    // 2) chunk the MERGED IR (this is what the production pdf path masks).
    const chunks = documentIrToKnowledgeChunks({
      documentIr: outcome.result.documentIr,
      docId: 'doc-labor-notice',
      extractorInput: outcome.result.textContent,
      documentSensitivity: 'Confidential',
      documentAiUsePolicy: 'requires_masking',
    });

    // The grounded row became its own table chunk carrying the raw PII verbatim
    // — proving the token genuinely round-tripped through the merge.
    const tableChunks = chunks.filter((c) => c.structureType === 'table');
    expect(tableChunks).toHaveLength(1);
    const tableAssistChunk = tableChunks[0]!;
    expect(tableAssistChunk.text).toBe(`${GROUNDING_LABEL}\t${MASK_TARGET_PHONE}`);
    expect(tableAssistChunk.text).toContain(MASK_TARGET_PHONE);

    // 3) run the deterministic Masker over every chunk.
    const maskedChunks = await Promise.all(
      chunks.map((chunk) => maskKnowledgeChunk(chunk, { provider: 'simple-rule' }))
    );

    // INVARIANT: the table-assist-derived chunk is masked, not leaked. Only
    // reachable because merge happened before the Masker.
    const maskedTableChunk = maskedChunks.find(
      (c) => c.structureType === 'table'
    );
    expect(maskedTableChunk?.maskedText).toBeDefined();
    expect(maskedTableChunk?.maskedText).toContain('[REDACTED:PHONE]');
    expect(maskedTableChunk?.maskedText).not.toContain(MASK_TARGET_PHONE);

    // The original paragraph chunk is masked too (baseline sanity).
    const maskedParagraph = maskedChunks.find(
      (c) => c.structureType === 'paragraph'
    );
    expect(maskedParagraph?.maskedText).not.toContain(MASK_TARGET_PHONE);
  });
});

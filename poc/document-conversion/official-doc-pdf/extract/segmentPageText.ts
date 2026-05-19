/**
 * Splits a single page's raw text (as produced by pdf-parse `getText`) into
 * DocumentIR blocks.
 *
 * Phase 3-H §5 keeps the lossy mapping table small:
 *   - `paragraph` is the default catch-all (mapped to KnowledgeChunk structureType="paragraph").
 *   - `heading` is emitted when a short line "looks like" a section header.
 *
 * Heuristics are intentionally conservative — official-doc PDFs (e.g. MHLW
 * notices) mostly arrive as numbered prefixes ("第1章", "1.", "(1)") followed
 * by short titles. We avoid over-classifying so we never *promote* body prose
 * to a heading by accident.
 */
import type { DocumentBlockKind } from '../../shared/documentIr';

export type SegmentedTextBlock = {
  kind: Extract<DocumentBlockKind, 'paragraph' | 'heading'>;
  text: string;
  headingLevel?: number;
};

const HEADING_PREFIX_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  level: number;
}> = [
  // 第1章 / 第 1 章 / 第１章 etc.
  { pattern: /^第\s*[0-9０-９一二三四五六七八九十]+\s*章/u, level: 1 },
  // 第1節
  { pattern: /^第\s*[0-9０-９一二三四五六七八九十]+\s*節/u, level: 2 },
  // "1." / "1．" / "1、" at line start (top-level numbered headings).
  { pattern: /^[0-9０-９]+\s*[.．、]\s*\S/u, level: 2 },
  // "(1)" / "（1）" — sub-section markers.
  { pattern: /^[（(]\s*[0-9０-９]+\s*[)）]/u, level: 3 },
];

/** Single line is treated as a heading only when reasonably short. */
const HEADING_MAX_CHARS = 60;

function classifyLine(line: string): SegmentedTextBlock | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > HEADING_MAX_CHARS) {
    return { kind: 'paragraph', text: trimmed };
  }
  for (const { pattern, level } of HEADING_PREFIX_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { kind: 'heading', text: trimmed, headingLevel: level };
    }
  }
  return null;
}

/**
 * Segments a page's raw text into blocks.
 *
 * Algorithm:
 *  1. Normalise CRLF → LF and collapse runs of blank lines.
 *  2. Split on blank lines → paragraph candidates.
 *  3. Within each candidate, the *first* line is re-classified: if it matches
 *     a heading pattern AND the candidate is exactly one line long, emit a
 *     heading block; otherwise emit a paragraph block (joined with spaces so
 *     the text stays grep-friendly).
 *
 * Returns an empty array if the page has no extractable text.
 */
export function segmentPageText(rawText: string): SegmentedTextBlock[] {
  const normalised = rawText.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  const paragraphs = normalised
    .split(/\n{2,}/u)
    .map((chunk) => chunk.replace(/[ \t]+\n/g, '\n').trim())
    .filter((chunk) => chunk.length > 0);

  const blocks: SegmentedTextBlock[] = [];
  for (const para of paragraphs) {
    const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    if (lines.length === 1) {
      const heading = classifyLine(lines[0]);
      if (heading && heading.kind === 'heading') {
        blocks.push(heading);
        continue;
      }
      blocks.push({ kind: 'paragraph', text: lines[0] });
      continue;
    }

    blocks.push({ kind: 'paragraph', text: lines.join(' ') });
  }

  return blocks;
}

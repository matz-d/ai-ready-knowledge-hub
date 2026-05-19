/**
 * DocumentIR → KnowledgeChunk adapter (Phase 3-H §5 lossy mapping).
 *
 * Source of truth: docs/phase-3-h-direction.md §5.
 *
 * Mapping summary:
 *
 * | DocumentIR block.kind | KnowledgeChunk.structureType | Notes |
 * |---|---|---|
 * | `paragraph` | `paragraph` | direct |
 * | `heading`   | `paragraph` | demoted; `headingLevel` recorded in `extractionWarnings` |
 * | `table`     | `table`     | one IR row block → one chunk (rowIndex carried via paragraphId) |
 * | `image_text`| `imageText` | locator collapses to `{ kind: 'imageText' }` |
 * | `note`      | (dropped)   | not surfaced as a chunk |
 *
 * Locator synthesis:
 *
 * | sourceSubtype     | Locator emitted                                    |
 * |-------------------|----------------------------------------------------|
 * | `official-doc-pdf`| `{ kind: 'pdf', page, paragraphId }`               |
 * | `scan-pdf`        | `{ kind: 'pdf', page, paragraphId }` (or imageText)|
 * | `slide-pdf`       | `{ kind: 'slide', slide }`                          |
 * | `office-native`   | `{ kind: 'paragraph' }`                             |
 *
 * For `pdf` locators, `paragraphId` is synthesised as:
 *   - `table-{tableIndex}-row-{rowIndex}` when both are present on the block locator;
 *   - otherwise the block's `blockId`.
 *
 * Information that has no place in {@link KnowledgeChunk} (heading level,
 * bbox) is preserved as breadcrumbs in `extractionWarnings` — that field is
 * intended for audit annotations and is the only schema-honest landing zone
 * until the production schema grows a `metadata` column.
 *
 * Size policy:
 *   Each candidate chunk is sized against {@link MAX_FIRESTORE_CHUNK_DOCUMENT_BYTES}
 *   (500 KiB). Oversized chunks are split into paragraph-aligned parts
 *   (`\n\n` → `\n` → fixed character window). Each part receives a `:part-N`
 *   suffix on both `id` and `locator.paragraphId`, which automatically gives
 *   the part a unique `sourceHash` (locator participates in the hash).
 */
import type { AiUsePolicy, Sensitivity } from '../../agents/curator/schema';
import {
  computeChunkSourceHash,
  estimateKnowledgeChunkFirestoreBytes,
  KNOWLEDGE_CHUNK_SCHEMA_VERSION,
  MAX_FIRESTORE_CHUNK_DOCUMENT_BYTES,
  type KnowledgeChunk,
  type KnowledgeChunkLocator,
} from '../../lib/knowledgeChunkSchema';
import {
  documentSourceSubtypeToKnowledgeChunkSourceType,
  type DocumentBlockKind,
  type DocumentIr,
  type DocumentIrBlock,
  type DocumentIrLocator,
  type DocumentSourceSubtype,
} from './documentIr';

const SUBTYPE_TO_EXTRACTION_PROVIDER: Record<
  DocumentSourceSubtype,
  KnowledgeChunk['extractionProvider']
> = {
  'official-doc-pdf': 'pdf',
  'scan-pdf': 'pdf',
  'slide-pdf': 'slides',
  'office-native': 'text',
};

export type DocumentIrToKnowledgeChunkOptions = {
  documentIr: DocumentIr;
  docId: string;
  /** Same bytes/string fed to the extractor — used by `computeChunkSourceHash`. */
  extractorInput: string;
  documentSensitivity: Sensitivity;
  documentAiUsePolicy: AiUsePolicy;
  /** Optional pre-masked text for `requires_masking` chunks. */
  maskedText?: string;
  /** Optional title applied to every produced chunk (e.g., source file name). */
  title?: string;
  /** Source of the sensitivity classification. Defaults to `'inherited'`. */
  sensitivitySource?: KnowledgeChunk['sensitivitySource'];
  /** Required when `sensitivitySource === 'columnRule'`. */
  sensitivityReason?: string;
  /** Injection seam for deterministic tests. */
  now?: () => Date;
  /** Override the per-chunk Firestore byte cap (default: 500 KiB). */
  maxChunkBytes?: number;
};

/** §5: `kind` → `structureType` (`null` means "drop"). */
export function documentIrBlockToStructureType(
  kind: DocumentBlockKind
): KnowledgeChunk['structureType'] | null {
  switch (kind) {
    case 'paragraph':
    case 'heading':
      return 'paragraph';
    case 'table':
      return 'table';
    case 'image_text':
      return 'imageText';
    case 'note':
      return null;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * `paragraphId` synthesis (§5):
 *   - tables: `table-{tableIndex}-row-{rowIndex}`
 *   - everything else: the block's stable `blockId`.
 */
export function buildPdfParagraphId(block: DocumentIrBlock): string {
  const locator = block.locator;
  if (locator?.tableIndex !== undefined && locator.rowIndex !== undefined) {
    return `table-${locator.tableIndex}-row-${locator.rowIndex}`;
  }
  return block.blockId;
}

function buildLocator(
  block: DocumentIrBlock,
  pageNumber: number,
  subtype: DocumentSourceSubtype,
  structureType: KnowledgeChunk['structureType']
): KnowledgeChunkLocator {
  if (structureType === 'imageText') {
    return { kind: 'imageText' };
  }
  switch (subtype) {
    case 'official-doc-pdf':
    case 'scan-pdf':
      return {
        kind: 'pdf',
        page: pageNumber,
        paragraphId: buildPdfParagraphId(block),
      };
    case 'slide-pdf':
      return {
        kind: 'slide',
        slide: block.locator?.slideNumber ?? pageNumber,
      };
    case 'office-native':
      return { kind: 'paragraph' };
    default: {
      const _exhaustive: never = subtype;
      return _exhaustive;
    }
  }
}

function buildExtractionWarnings(
  block: DocumentIrBlock
): string[] | undefined {
  const warnings: string[] = [];
  if (block.kind === 'heading') {
    const level =
      (block.metadata?.headingLevel as number | undefined) ?? 1;
    warnings.push(
      `headingLevel=${level} (heading demoted to paragraph; KnowledgeChunk has no heading structureType)`
    );
  }
  const bbox: DocumentIrLocator['bbox'] | undefined = block.locator?.bbox;
  if (bbox) {
    warnings.push(
      `bbox=[${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}] (locator schema has no bbox; preserved as warning)`
    );
  }
  return warnings.length > 0 ? warnings : undefined;
}

function withParagraphIdSuffix(
  locator: KnowledgeChunkLocator,
  suffix: string
): KnowledgeChunkLocator {
  if (locator.kind !== 'pdf') return locator;
  const existing = locator.paragraphId;
  return {
    ...locator,
    paragraphId: existing ? `${existing}${suffix}` : suffix.replace(/^:/, ''),
  };
}

/**
 * Splits text into paragraph-aligned pieces.
 *
 * Tier 1: split on blank lines (`\n{2,}`).
 * Tier 2 (if Tier 1 produced a single piece): split on single `\n`.
 * Tier 3 is applied per oversized piece during packing: fixed character window.
 */
function splitTextByParagraph(text: string): string[] {
  const byBlank = text
    .split(/\n{2,}/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (byBlank.length > 1) return byBlank;
  const byLine = text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return byLine.length > 0 ? byLine : [text];
}

/**
 * Char-window fallback for a single paragraph that itself exceeds the byte
 * cap. Binary-search the largest prefix that still fits, emit it, recurse on
 * the remainder.
 */
function splitByCharWindow(
  piece: string,
  fits: (candidate: string) => boolean
): string[] {
  if (fits(piece)) return [piece];
  const parts: string[] = [];
  let remainder = piece;
  while (remainder.length > 0 && !fits(remainder)) {
    let lo = 1;
    let hi = remainder.length;
    let best = 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (fits(remainder.slice(0, mid))) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    parts.push(remainder.slice(0, best));
    remainder = remainder.slice(best);
  }
  if (remainder.length > 0) parts.push(remainder);
  return parts;
}

function partitionText(
  text: string,
  fits: (candidate: string) => boolean
): string[] {
  if (fits(text)) return [text];

  const pieces = splitTextByParagraph(text);
  const groups: string[] = [];
  let buffer: string[] = [];

  const flush = (): void => {
    if (buffer.length === 0) return;
    groups.push(buffer.join('\n\n'));
    buffer = [];
  };

  for (const piece of pieces) {
    if (!fits(piece)) {
      flush();
      for (const sub of splitByCharWindow(piece, fits)) groups.push(sub);
      continue;
    }
    const tentative =
      buffer.length === 0 ? piece : `${buffer.join('\n\n')}\n\n${piece}`;
    if (fits(tentative)) {
      buffer.push(piece);
    } else {
      flush();
      buffer.push(piece);
    }
  }
  flush();

  return groups.length > 0 ? groups : [text];
}

type ChunkSeed = Omit<KnowledgeChunk, 'id' | 'sourceHash' | 'text'>;

function finaliseChunk(
  seed: ChunkSeed,
  id: string,
  text: string,
  locator: KnowledgeChunkLocator,
  extractorInput: string
): KnowledgeChunk {
  return {
    ...seed,
    id,
    text,
    locator,
    sourceHash: computeChunkSourceHash({ extractorInput, locator }),
  };
}

/**
 * Adapt every renderable block on every page into one or more
 * {@link KnowledgeChunk}s.
 *
 * Returned chunks satisfy {@link KnowledgeChunkSchema} and, given a matching
 * parent document, {@link validateKnowledgeChunkInvariants}.
 */
export function documentIrToKnowledgeChunks(
  options: DocumentIrToKnowledgeChunkOptions
): KnowledgeChunk[] {
  const {
    documentIr,
    docId,
    extractorInput,
    documentSensitivity,
    documentAiUsePolicy,
    maskedText,
    title,
    sensitivitySource = 'inherited',
    sensitivityReason,
    now = (): Date => new Date(),
    maxChunkBytes = MAX_FIRESTORE_CHUNK_DOCUMENT_BYTES,
  } = options;

  const subtype = documentIr.source.sourceSubtype;
  const sourceType = documentSourceSubtypeToKnowledgeChunkSourceType(subtype);
  const extractionProvider = SUBTYPE_TO_EXTRACTION_PROVIDER[subtype];
  const timestamp = now().toISOString();

  const chunks: KnowledgeChunk[] = [];

  for (const page of documentIr.pages) {
    for (const block of page.blocks) {
      const structureType = documentIrBlockToStructureType(block.kind);
      if (structureType === null) continue;

      const baseLocator = buildLocator(
        block,
        page.pageNumber,
        subtype,
        structureType
      );
      const extractionWarnings = buildExtractionWarnings(block);

      const seed: ChunkSeed = {
        docId,
        schemaVersion: KNOWLEDGE_CHUNK_SCHEMA_VERSION,
        sourceType,
        structureType,
        locator: baseLocator,
        ...(title !== undefined ? { title } : {}),
        ...(maskedText !== undefined ? { maskedText } : {}),
        sensitivity: documentSensitivity,
        aiUsePolicy: documentAiUsePolicy,
        sensitivitySource,
        ...(sensitivityReason !== undefined ? { sensitivityReason } : {}),
        extractionProvider,
        ...(extractionWarnings !== undefined ? { extractionWarnings } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const baseId = `${docId}:${block.blockId}`;

      const fitsBase = (candidateText: string): boolean => {
        const candidate = finaliseChunk(
          seed,
          baseId,
          candidateText,
          baseLocator,
          extractorInput
        );
        return estimateKnowledgeChunkFirestoreBytes(candidate) <= maxChunkBytes;
      };

      if (fitsBase(block.text)) {
        chunks.push(
          finaliseChunk(
            seed,
            baseId,
            block.text,
            baseLocator,
            extractorInput
          )
        );
        continue;
      }

      // Split form: each part carries `:part-N` on its paragraphId AND an
      // extra `split=N/M (...)` warning. Both inflate the JSON payload, so the
      // binary-search predicate must size against the *split* form — not the
      // base form — or the last part will tip the cap.
      const SPLIT_OVERHEAD_PROBE = {
        suffix: ':part-999',
        warning: `split=999/999 (exceeded ${maxChunkBytes}B; paragraph-aligned)`,
      };
      const splitProbeLocator = withParagraphIdSuffix(
        baseLocator,
        SPLIT_OVERHEAD_PROBE.suffix
      );
      const splitProbeSeed: ChunkSeed = {
        ...seed,
        locator: splitProbeLocator,
        extractionWarnings: [
          ...(extractionWarnings ?? []),
          SPLIT_OVERHEAD_PROBE.warning,
        ],
      };
      const fitsSplit = (candidateText: string): boolean => {
        const candidate = finaliseChunk(
          splitProbeSeed,
          `${baseId}${SPLIT_OVERHEAD_PROBE.suffix}`,
          candidateText,
          splitProbeLocator,
          extractorInput
        );
        return estimateKnowledgeChunkFirestoreBytes(candidate) <= maxChunkBytes;
      };

      const parts = partitionText(block.text, fitsSplit);

      parts.forEach((part, index) => {
        const suffix = `:part-${index + 1}`;
        const locator = withParagraphIdSuffix(baseLocator, suffix);
        const warningsWithSplit = [
          ...(extractionWarnings ?? []),
          `split=${index + 1}/${parts.length} (exceeded ${maxChunkBytes}B; paragraph-aligned)`,
        ];
        const partSeed: ChunkSeed = {
          ...seed,
          locator,
          extractionWarnings: warningsWithSplit,
        };
        chunks.push(
          finaliseChunk(
            partSeed,
            `${baseId}${suffix}`,
            part,
            locator,
            extractorInput
          )
        );
      });
    }
  }

  return chunks;
}

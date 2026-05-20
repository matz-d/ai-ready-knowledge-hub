/**
 * Heuristic stage: `safety_readiness` axis (Phase 3-H-2 §6.2).
 *
 * This evaluator probes the existing Cloud DLP masker once per docId and maps
 * detected spans back onto chunks. A finding is considered maskable only when
 * it is fully contained in one chunk that has a locator and is not image text.
 */
import {
  applyCloudDlpMask,
  type CloudDlpMaskerOptions,
} from '../../../agents/masker/cloudDlpMasker';
import type { MaskedSpan } from '../../../agents/masker/maskingSchema';
import type { ConversionEvalResult } from '../conversionEvalResult';
import type { HeuristicEvalChunk, HeuristicEvalInput } from './types';

export const SAFETY_READINESS_DRY_RUN_RESULT: Pick<
  ConversionEvalResult,
  'safetyReadiness'
> = {
  safetyReadiness: {
    unmaskablePiiFindings: 0,
    maskableChunkRate: 1,
  },
};

const CHUNK_BOUNDARY = '\n\n<<<CONVERSION_EVAL_CHUNK_BOUNDARY>>>\n\n';

export type SafetyReadinessEvalChunk = HeuristicEvalChunk & {
  docId?: string;
  id?: string;
  structureType?: string;
  locator?: { kind?: string } | Record<string, unknown>;
};

export type EvalSafetyReadinessHeuristicOptions = CloudDlpMaskerOptions & {
  dryRun?: boolean;
};

type ChunkRange<TChunk extends SafetyReadinessEvalChunk> = {
  chunk: TChunk;
  start: number;
  end: number;
};

function isDryRun(options: EvalSafetyReadinessHeuristicOptions): boolean {
  return options.dryRun ?? process.env.DLP_DRY_RUN === 'true';
}

function docIdForChunk<TChunk extends SafetyReadinessEvalChunk>(
  chunk: TChunk,
  fallbackDocId: string
): string {
  return typeof chunk.docId === 'string' && chunk.docId.trim() !== ''
    ? chunk.docId
    : fallbackDocId;
}

function groupChunksByDocId<TChunk extends SafetyReadinessEvalChunk>(
  chunks: readonly TChunk[],
  fallbackDocId: string
): Map<string, TChunk[]> {
  const groups = new Map<string, TChunk[]>();
  for (const chunk of chunks) {
    const docId = docIdForChunk(chunk, fallbackDocId);
    const group = groups.get(docId);
    if (group) {
      group.push(chunk);
    } else {
      groups.set(docId, [chunk]);
    }
  }
  return groups;
}

function buildJoinedContent<TChunk extends SafetyReadinessEvalChunk>(
  chunks: readonly TChunk[]
): { content: string; ranges: ChunkRange<TChunk>[] } {
  let content = '';
  const ranges: ChunkRange<TChunk>[] = [];

  for (const chunk of chunks) {
    if (content.length > 0) {
      content += CHUNK_BOUNDARY;
    }
    const start = content.length;
    content += chunk.text;
    ranges.push({ chunk, start, end: content.length });
  }

  return { content, ranges };
}

function containingRange<TChunk extends SafetyReadinessEvalChunk>(
  span: MaskedSpan,
  ranges: readonly ChunkRange<TChunk>[]
): ChunkRange<TChunk> | null {
  return (
    ranges.find((range) => span.start >= range.start && span.end <= range.end) ??
    null
  );
}

function isImageTextChunk(chunk: SafetyReadinessEvalChunk): boolean {
  return chunk.structureType === 'imageText' || chunk.locator?.kind === 'imageText';
}

function hasUsableLocator(chunk: SafetyReadinessEvalChunk): boolean {
  return chunk.locator !== undefined && chunk.locator !== null;
}

function isMaskableFinding<TChunk extends SafetyReadinessEvalChunk>(
  span: MaskedSpan,
  ranges: readonly ChunkRange<TChunk>[]
): { maskable: boolean; chunk: TChunk | null } {
  const range = containingRange(span, ranges);
  if (!range) {
    return { maskable: false, chunk: null };
  }
  if (isImageTextChunk(range.chunk) || !hasUsableLocator(range.chunk)) {
    return { maskable: false, chunk: range.chunk };
  }
  return { maskable: true, chunk: range.chunk };
}

export async function evalSafetyReadinessHeuristic<
  TChunk extends SafetyReadinessEvalChunk,
>(
  input: HeuristicEvalInput<TChunk>,
  options: EvalSafetyReadinessHeuristicOptions = {}
): Promise<Pick<ConversionEvalResult, 'safetyReadiness'>> {
  if (isDryRun(options)) {
    return SAFETY_READINESS_DRY_RUN_RESULT;
  }

  if (input.chunks.length === 0) {
    return {
      safetyReadiness: {
        unmaskablePiiFindings: 0,
        maskableChunkRate: 1,
      },
    };
  }

  const fallbackDocId = input.documentIr.source.fileName;
  const groups = groupChunksByDocId(input.chunks, fallbackDocId);
  const maskableChunkIds = new Set<number>();
  let unmaskablePiiFindings = 0;
  let ordinal = 0;
  const chunkOrdinals = new Map<TChunk, number>();
  for (const chunk of input.chunks) {
    chunkOrdinals.set(chunk, ordinal);
    ordinal += 1;
  }

  for (const [docId, chunks] of groups) {
    const { content, ranges } = buildJoinedContent(chunks);
    const result = await applyCloudDlpMask(
      {
        fileName: docId,
        content,
        curatorContext: {
          sensitivity: 'Confidential',
          aiUsePolicy: 'requires_masking',
          businessDomain: 'その他',
        },
      },
      options
    );

    for (const span of result.maskedSpans) {
      const finding = isMaskableFinding(span, ranges);
      if (!finding.maskable) {
        unmaskablePiiFindings += 1;
        continue;
      }
      const index = finding.chunk ? chunkOrdinals.get(finding.chunk) : undefined;
      if (index !== undefined) {
        maskableChunkIds.add(index);
      }
    }
  }

  return {
    safetyReadiness: {
      unmaskablePiiFindings,
      maskableChunkRate: maskableChunkIds.size / input.chunks.length,
    },
  };
}

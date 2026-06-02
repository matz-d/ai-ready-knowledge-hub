/**
 * API 境界用の view projection（Phase 3-C-4 セキュリティ修正）。
 *
 * Why this exists:
 *   `StrategistChunkSelection` / `SafetyExcludedChunk` は domain object として
 *   `chunk: KnowledgeChunk` を丸ごと保持しており、その中には **raw（未マスク）の
 *   `text`** が含まれる。これを `/api/context-package` の JSON でそのまま返すと、
 *   `requires_masking` の Confidential 本文や `restricted` の本文が露出する。
 *   markdown export 側は {@link includedBodyForChunk} で AI-safe 本文に差し替えて
 *   いるのに、JSON だけが raw を漏らしていた。
 *
 * 方針:
 *   - included: AI-safe 本文（{@link includedBodyForChunk}）だけを `aiSafeContent` で返す。
 *     requires_masking は maskedText のみ。raw `text` は絶対に載せない。
 *   - excluded / safetyExcluded: 本文を一切載せない（メタデータのみ）。
 *     safetyExcluded は Restricted / blocked の raw 本文を含み得るため body を出さない。
 */
import type { Sensitivity } from '../../agents/curator/schema';
import type { StrategistExclusionReason } from '../../agents/strategist/schema';
import { chunkRequiresMasking, includedBodyForChunk } from './toContextPackage';
import type { SafetyExcludedChunk, StrategistChunkSelection } from './types';

type SafeParentView = {
  fileName: string;
  documentType: string;
  businessDomain: string;
};

type SafeChunkMetaView = {
  title?: string;
  sensitivity: Sensitivity;
};

export type IncludedChunkView = {
  docId: string;
  chunkId: string;
  rationale: string;
  confidence?: number;
  /** Masker の AI-safe 版を採用しているか（原本ではなくマスク済みを同梱） */
  aiSafeViaMasking: boolean;
  chunk: SafeChunkMetaView;
  parent: SafeParentView;
  /** AI に渡してよい本文（requires_masking は maskedText のみ。raw text は載せない）。 */
  aiSafeContent: string;
};

export type ExcludedChunkView = {
  docId: string;
  chunkId: string;
  rationale: string;
  reason?: StrategistExclusionReason;
  chunk: SafeChunkMetaView;
  parent: SafeParentView;
};

export type SafetyExcludedChunkView = {
  docId: string;
  chunkId: string;
  rationale: string;
  reason: string;
  chunk: SafeChunkMetaView;
  parent: SafeParentView;
};

function safeParent(parent: StrategistChunkSelection['parent']): SafeParentView {
  return {
    fileName: parent.fileName,
    documentType: parent.documentType,
    businessDomain: parent.businessDomain,
  };
}

function safeChunkMeta(chunk: StrategistChunkSelection['chunk']): SafeChunkMetaView {
  return {
    ...(chunk.title ? { title: chunk.title } : {}),
    sensitivity: chunk.sensitivity,
  };
}

export function toIncludedChunkView(
  selection: StrategistChunkSelection,
): IncludedChunkView {
  const { chunk } = selection;
  const masked = chunk.maskedText?.trim();
  return {
    docId: selection.docId,
    chunkId: selection.chunkId,
    rationale: selection.rationale,
    ...(selection.confidence !== undefined ? { confidence: selection.confidence } : {}),
    aiSafeViaMasking: chunkRequiresMasking(chunk) && Boolean(masked),
    chunk: safeChunkMeta(chunk),
    parent: safeParent(selection.parent),
    aiSafeContent: includedBodyForChunk(chunk),
  };
}

export function toExcludedChunkView(
  selection: StrategistChunkSelection,
): ExcludedChunkView {
  return {
    docId: selection.docId,
    chunkId: selection.chunkId,
    rationale: selection.rationale,
    ...(selection.reason ? { reason: selection.reason } : {}),
    chunk: safeChunkMeta(selection.chunk),
    parent: safeParent(selection.parent),
  };
}

export function toSafetyExcludedChunkView(
  row: SafetyExcludedChunk,
): SafetyExcludedChunkView {
  return {
    docId: row.docId,
    chunkId: row.chunkId,
    rationale: row.rationale,
    reason: row.reason,
    chunk: safeChunkMeta(row.chunk),
    parent: safeParent(row.parent),
  };
}

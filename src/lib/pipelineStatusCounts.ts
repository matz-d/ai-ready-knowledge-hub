import type { FirestoreDocumentStatus } from './firestoreSchema';

/**
 * Pipeline 可視化用の status 別件数。
 *
 * Inventory（terminal のみ）と違い、`uploaded` / `curating` / `masking` /
 * `failed` を含む全ライフサイクルを数える。export 経路の不変条件
 * （terminal な effective fields のみ扱う）には一切触れない別レイヤ。
 *
 * このモジュールは純関数のみ。Firestore reader は
 * `inventoryFirestoreAdapter.countDocumentsByStatusFromFirestore` にある
 * （client component から import しても server 依存を引き込まないため）。
 */
export type PipelineStatusCounts = Record<FirestoreDocumentStatus, number> & {
  /**
   * `status=curated` のうち、Curator が direct と判定済みの件数。
   *
   * `curated` には legacy の `requires_masking + maskingPending:true` も含まれるため、
   * AI-ready KPI は status だけでなくこの内訳を使って安全側に数える。
   */
  directCurated: number;
};

export type PipelineDocumentCountInput = {
  status: unknown;
  aiUsePolicy?: unknown;
  maskingPending?: unknown;
};

export const PIPELINE_STATUSES = [
  'uploaded',
  'curating',
  'masking',
  'curated',
  'blocked',
  'ai_safe',
  'restricted',
  'failed',
] as const satisfies readonly FirestoreDocumentStatus[];

export function emptyPipelineStatusCounts(): PipelineStatusCounts {
  return {
    uploaded: 0,
    curating: 0,
    masking: 0,
    curated: 0,
    blocked: 0,
    ai_safe: 0,
    restricted: 0,
    failed: 0,
    directCurated: 0,
  };
}

const KNOWN_STATUSES = new Set<string>(PIPELINE_STATUSES);

function isKnownStatus(value: unknown): value is FirestoreDocumentStatus {
  return typeof value === 'string' && KNOWN_STATUSES.has(value);
}

/**
 * status 値の列を件数へ集計する。未知の status は黙って数えない
 * （破損 document を skip する inventory reader と同じ方針）。
 */
export function aggregatePipelineStatusCounts(
  statuses: Iterable<unknown>
): PipelineStatusCounts {
  const counts = emptyPipelineStatusCounts();
  for (const status of statuses) {
    if (isKnownStatus(status)) {
      counts[status] += 1;
    }
  }
  return counts;
}

export function aggregatePipelineDocumentCounts(
  documents: Iterable<PipelineDocumentCountInput>
): PipelineStatusCounts {
  const counts = emptyPipelineStatusCounts();
  for (const document of documents) {
    if (!isKnownStatus(document.status)) {
      continue;
    }
    counts[document.status] += 1;
    if (
      document.status === 'curated' &&
      document.aiUsePolicy === 'direct' &&
      document.maskingPending !== true
    ) {
      counts.directCurated += 1;
    }
  }
  return counts;
}

/** パイプライン処理中（非 terminal）の文書数。 */
export function inFlightDocumentCount(counts: PipelineStatusCounts): number {
  return counts.uploaded + counts.curating + counts.masking;
}

/** AI に渡せる状態で終端した文書数（direct curated + マスキング済み）。 */
export function aiReadyDocumentCount(counts: PipelineStatusCounts): number {
  return counts.directCurated + counts.ai_safe;
}

/** 機密のため AI 利用から保護された文書数（除外は断言、の側）。 */
export function protectedDocumentCount(counts: PipelineStatusCounts): number {
  return counts.restricted + counts.blocked;
}

export function totalDocumentCount(counts: PipelineStatusCounts): number {
  return PIPELINE_STATUSES.reduce((sum, status) => sum + counts[status], 0);
}

export function readyPercentFromCounts(counts: PipelineStatusCounts): number {
  const total = totalDocumentCount(counts);
  return total > 0 ? Math.round((aiReadyDocumentCount(counts) / total) * 100) : 0;
}

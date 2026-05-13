// Phase 3-C-1: 型の正本は schema.ts に移動。このファイルは後方互換のための再エクスポート。
export type {
  IncludedChunkRef,
  ExcludedChunkRef,
  MissingInfo,
  HumanReviewQuestion,
  StrategistChunkInput,
  StrategistParentInventoryMetadata,
  StrategistInput,
  StrategistOutput,
  ExclusionReason,
  ExclusionReasonLabel,
  ExclusionReasonOriginType,
} from './schema';

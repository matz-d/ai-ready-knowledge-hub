import {
  toSerializableCurator,
  toSerializableMasker,
  type DocumentUploadSuccessResponse,
} from './documents';
import type { OrchestrateResult } from './uploadOrchestrator';

/**
 * `POST /api/documents` 成功時ボディ。HTTP 境界と orchestrator の橋渡しのみ（副作用なし）。
 */
export function documentUploadSuccessBodyFromOrchestrate(args: {
  displayName: string;
  contentType: string;
  byteSize: number;
  modelId: string;
  result: OrchestrateResult;
  ingestMeta: {
    kind: 'created' | 'overwritten';
    skipped?: boolean;
  };
}): DocumentUploadSuccessResponse {
  const { displayName, contentType, byteSize, modelId, result, ingestMeta } =
    args;
  const base = {
    docId: result.docId,
    fileName: displayName,
    contentType,
    byteSize,
    storagePath: result.storagePath,
    status: result.kind,
    kind: ingestMeta.kind,
    ...(ingestMeta.skipped === true ? { skipped: true as const } : {}),
    curator: toSerializableCurator(
      result.curator,
      modelId,
      result.curatorCompletedAt
    ),
  };

  if (result.kind === 'ai_safe') {
    return {
      ...base,
      aiSafeStoragePath: result.aiSafeStoragePath,
      masker: toSerializableMasker(result.masker),
    };
  }

  if (result.kind === 'restricted') {
    return {
      ...base,
      masker: toSerializableMasker(result.masker),
      sensitivityReason: result.sensitivityReason,
      originalCuratorSensitivity: result.originalCuratorSensitivity,
    };
  }

  if (result.kind === 'curated' && result.maskingPending === true) {
    return { ...base, maskingPending: true };
  }

  return base;
}

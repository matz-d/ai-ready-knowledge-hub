/**
 * Context Package の audit target を組み立てる共有ヘルパー。
 *
 * 同期経路（route）と非同期 worker（job runner）の両方が `document.export` を
 * 同型で記録するために 1 か所に集約する。
 */
import type { Sensitivity } from '../../agents/curator/schema';
import type { StrategistOrchestratorResult } from './types';

export function contextPackageAuditTarget(result: StrategistOrchestratorResult): {
  docId: string;
  fileName: string;
  sourceKind: 'upload';
  sensitivity: Sensitivity | 'Unknown';
} {
  const row =
    result.included[0] ?? result.excluded[0] ?? result.safetyExcluded[0];
  if (row) {
    return {
      docId: row.chunk.docId,
      fileName: row.parent.fileName,
      sourceKind: 'upload',
      sensitivity: row.chunk.sensitivity,
    };
  }
  return {
    docId: 'context-package',
    fileName:
      result.purpose.trim().length > 0
        ? result.purpose.slice(0, 200)
        : 'Context Package',
    sourceKind: 'upload',
    sensitivity: 'Unknown',
  };
}

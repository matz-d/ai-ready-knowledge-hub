import type {
  ContextPackageExportInput,
  ExcludedContextDocument,
  IncludedContextDocument,
} from '../../lib/exportContextPackage';
import { exportContextPackageMarkdown } from '../../lib/exportContextPackage';
import type { KnowledgeChunk } from '../../lib/knowledgeChunkSchema';
import type {
  SafetyExcludedChunk,
  StrategistChunkSelection,
  StrategistOrchestratorParent,
  StrategistOrchestratorResult,
} from './types';

function chunkSheetRangeHint(chunk: KnowledgeChunk): string | undefined {
  if (chunk.locator.kind !== 'spreadsheet') {
    return undefined;
  }
  return `sheet=${chunk.locator.sheetName}, range=${chunk.locator.range}`;
}

function strategistChunkDisplayName(
  parent: StrategistOrchestratorParent,
  chunk: KnowledgeChunk,
): string {
  const hint = chunkSheetRangeHint(chunk);
  if (!hint) {
    return parent.fileName;
  }
  return `${parent.fileName} (${hint})`;
}

function chunkRequiresMasking(chunk: KnowledgeChunk): boolean {
  return chunk.aiUsePolicy === 'requires_masking';
}

function includedBodyForChunk(chunk: KnowledgeChunk): string {
  if (chunkRequiresMasking(chunk)) {
    const masked = chunk.maskedText?.trim();
    if (masked) {
      return masked;
    }
    return chunk.text.trim();
  }
  return chunk.text.trim();
}

function selectionToIncludedDocument(
  selection: StrategistChunkSelection,
): IncludedContextDocument {
  const { chunk, parent, rationale } = selection;
  const requiresMasking = chunkRequiresMasking(chunk);
  const masked = chunk.maskedText?.trim();
  const aiSafeViaMasking = requiresMasking && Boolean(masked);
  return {
    fileName: strategistChunkDisplayName(parent, chunk),
    reason: rationale,
    sourceType: parent.documentType,
    sensitivity: chunk.sensitivity,
    aiSafeViaMasking,
    aiSafeContent: includedBodyForChunk(chunk),
  };
}

function strategistExcludedReason(selection: StrategistChunkSelection): string {
  const base = selection.rationale.trim();
  if (selection.reason) {
    return `${base} [${selection.reason}]`;
  }
  return base;
}

function selectionToExcludedDocument(
  selection: StrategistChunkSelection,
): ExcludedContextDocument {
  return {
    fileName: strategistChunkDisplayName(selection.parent, selection.chunk),
    reason: strategistExcludedReason(selection),
  };
}

function safetyToHumanReviewDocument(
  row: SafetyExcludedChunk,
): ExcludedContextDocument {
  return {
    fileName: strategistChunkDisplayName(row.parent, row.chunk),
    reason: `${row.rationale.trim()} [safety: ${row.reason}]`,
    status: row.reason,
  };
}

function buildStrategistExportInput(
  result: StrategistOrchestratorResult,
): ContextPackageExportInput {
  return {
    purpose: result.purpose,
    generatedAt: result.generatedAt,
    sourceDocumentsReviewed: result.sourceDocumentsReviewed,
    includedDocuments: result.included.map(selectionToIncludedDocument),
    excludedDocuments: result.excluded.map(selectionToExcludedDocument),
    humanReviewDocuments: result.safetyExcluded.map(safetyToHumanReviewDocument),
    missingKnowledge: [...result.missing],
    questionsForHumanOwner: [...result.humanReviewQuestions],
  };
}

/**
 * Converts a {@link StrategistOrchestratorResult} into {@link ContextPackageExportInput}
 * and rendered markdown. Strategist-only mapping: does not use {@link buildContextPackageExportInput}.
 */
export function buildStrategistContextPackage(
  result: StrategistOrchestratorResult,
): {
  input: ContextPackageExportInput;
  markdown: string;
} {
  const input = buildStrategistExportInput(result);
  return {
    input,
    markdown: exportContextPackageMarkdown(input),
  };
}

import type {
  ContextPackageExportInput,
  ExcludedContextDocument,
  IncludedContextDocument,
} from './exportContextPackage';
import type { InventoryDocument } from './inventory';
import type { KnowledgeChunk } from './knowledgeChunkSchema';
import {
  isBlockedForAi,
  needsMaskerEvaluation,
} from '../agents/masker/upgrade';

const DEMO_PLACEHOLDER_PREFIX = '[Demo: body not loaded';
const EXPORTABLE_STATUSES = new Set<InventoryDocument['status']>([
  'curated',
  'ai_safe',
]);

/** Default-off path: rows without a real UTF-8 body are not listed under Full AI-Ready Sources. */
export const CONTEXT_PACKAGE_BODY_UNAVAILABLE_REASON =
  'Body not available for Context Package export';

function placeholderContent(doc: InventoryDocument): string {
  return `${DEMO_PLACEHOLDER_PREFIX} — ${doc.fileName}]`;
}

/** True when this inventory row may appear under Full AI-Ready Sources for export. */
export function isSafeForContextPackageExport(doc: InventoryDocument): boolean {
  if (!EXPORTABLE_STATUSES.has(doc.status)) {
    return false;
  }
  if (doc.contextPackageBodyLoadError) {
    return false;
  }
  if (isBlockedForAi(doc) || needsMaskerEvaluation(doc)) {
    return false;
  }
  if (doc.status === 'ai_safe' && !doc.aiSafeContent?.trim()) {
    return false;
  }
  const needsMaskedBody =
    doc.sensitivity === 'Confidential' && doc.aiUsePolicy === 'requires_masking';
  if (needsMaskedBody && !doc.aiSafeContent?.trim()) {
    return false;
  }
  if (!doc.aiSafeContent?.trim()) {
    return false;
  }
  return true;
}

export type BuildContextPackageInputOptions = {
  purpose: string;
  documents: InventoryDocument[];
  chunks?: KnowledgeChunk[];
  generatedAt?: Date | string;
  missingKnowledge?: string[];
  questionsForHumanOwner?: string[];
  /**
   * When false (default), rows without trimmed `aiSafeContent` never use demo placeholders
   * under Full AI-Ready Sources. Enable for W1 fixtures / offline demo fallback only.
   */
  allowPlaceholderBodies?: boolean;
};

function buildDocumentOnlyContextPackageExportInput(
  options: BuildContextPackageInputOptions
): ContextPackageExportInput {
  const allowPlaceholderBodies = options.allowPlaceholderBodies ?? false;
  const includedDocuments: IncludedContextDocument[] = [];
  const excludedDocuments: ExcludedContextDocument[] = [];
  const humanReviewDocuments: ExcludedContextDocument[] = [];

  for (const doc of options.documents) {
    if (isBlockedForAi(doc)) {
      humanReviewDocuments.push({
        fileName: doc.fileName,
        reason:
          doc.sensitivityReason ??
          'Restricted after Masker residual risk — not for downstream AI',
        status: 'Restricted / human review only',
      });
      continue;
    }

    if (!EXPORTABLE_STATUSES.has(doc.status)) {
      humanReviewDocuments.push({
        fileName: doc.fileName,
        reason: `Document status ${doc.status} is not ready for Context Package export`,
        status: doc.status,
      });
      continue;
    }

    if (needsMaskerEvaluation(doc)) {
      humanReviewDocuments.push({
        fileName: doc.fileName,
        reason: 'Masker evaluation required before AI inclusion',
        status: 'Pending masking review',
      });
      continue;
    }

    if (doc.contextPackageBodyLoadError) {
      humanReviewDocuments.push({
        fileName: doc.fileName,
        reason: doc.contextPackageBodyLoadError,
        status: doc.status,
      });
      continue;
    }

    const needsMaskedBody =
      doc.sensitivity === 'Confidential' && doc.aiUsePolicy === 'requires_masking';
    const hasSafe = Boolean(doc.aiSafeContent?.trim());

    if ((doc.status === 'ai_safe' || needsMaskedBody) && !hasSafe) {
      humanReviewDocuments.push({
        fileName: doc.fileName,
        reason:
          'Confidential — masking required / no AI-safe version available for export',
        status: 'Human review required',
      });
      continue;
    }

    if (!hasSafe && !allowPlaceholderBodies) {
      humanReviewDocuments.push({
        fileName: doc.fileName,
        reason: CONTEXT_PACKAGE_BODY_UNAVAILABLE_REASON,
        status: 'Human review required',
      });
      continue;
    }

    const aiSafeContent = hasSafe
      ? doc.aiSafeContent!.trim()
      : placeholderContent(doc);

    const aiSafeViaMasking = Boolean(
      doc.maskerEvaluation && doc.aiSafeContent?.trim()
    );

    includedDocuments.push({
      fileName: doc.fileName,
      reason: doc.rationale,
      sourceType: doc.documentType,
      sensitivity: doc.sensitivity,
      aiSafeViaMasking,
      aiSafeContent,
    });
  }

  const filteredIncluded = includedDocuments.filter(
    (row) => row.sensitivity !== 'Restricted'
  );

  return {
    purpose: options.purpose,
    generatedAt: options.generatedAt,
    sourceDocumentsReviewed: options.documents.length,
    includedDocuments: filteredIncluded,
    excludedDocuments,
    humanReviewDocuments,
    missingKnowledge: options.missingKnowledge ?? [],
    questionsForHumanOwner: options.questionsForHumanOwner ?? [],
  };
}

function chunkSheetRangeHint(chunk: KnowledgeChunk): string | undefined {
  if (chunk.locator.kind !== 'spreadsheet') {
    return undefined;
  }
  return `sheet=${chunk.locator.sheetName}, range=${chunk.locator.range}`;
}

function chunkFileName(parent: InventoryDocument, chunk: KnowledgeChunk): string {
  const hint = chunkSheetRangeHint(chunk);
  if (!hint) {
    return parent.fileName;
  }
  return `${parent.fileName} (${hint})`;
}

function buildChunkAwareContextPackageExportInput(
  options: BuildContextPackageInputOptions
): ContextPackageExportInput {
  const includedDocuments: IncludedContextDocument[] = [];
  const excludedDocuments: ExcludedContextDocument[] = [];
  const humanReviewDocuments: ExcludedContextDocument[] = [];
  const parentById = new Map(options.documents.map((doc) => [doc.id, doc]));
  const chunksByDocId = new Map<string, KnowledgeChunk[]>();

  for (const chunk of options.chunks ?? []) {
    const chunks = chunksByDocId.get(chunk.docId) ?? [];
    chunks.push(chunk);
    chunksByDocId.set(chunk.docId, chunks);
  }

  for (const doc of options.documents) {
    const chunks = chunksByDocId.get(doc.id);
    if (chunks && chunks.length > 0) {
      continue;
    }

    const documentOnly = buildDocumentOnlyContextPackageExportInput({
      ...options,
      documents: [doc],
      chunks: undefined,
    });
    includedDocuments.push(...documentOnly.includedDocuments);
    excludedDocuments.push(...documentOnly.excludedDocuments);
    humanReviewDocuments.push(...(documentOnly.humanReviewDocuments ?? []));
  }

  for (const chunk of options.chunks ?? []) {
    const parent = parentById.get(chunk.docId);
    if (!parent) {
      humanReviewDocuments.push({
        fileName: chunk.id,
        reason: `Chunk parent document not found for docId=${chunk.docId}`,
        status: 'Human review required',
      });
      continue;
    }

    if (parent.status === 'blocked' || parent.status === 'restricted') {
      continue;
    }

    if (chunk.aiUsePolicy === 'blocked' || chunk.sensitivity === 'Restricted') {
      continue;
    }

    if (chunk.aiUsePolicy === 'requires_masking') {
      const masked = chunk.maskedText?.trim();
      if (!masked) {
        humanReviewDocuments.push({
          fileName: chunkFileName(parent, chunk),
          reason: 'Chunk requires masking but maskedText is unavailable',
          status: 'Human review required',
        });
        continue;
      }

      includedDocuments.push({
        fileName: chunkFileName(parent, chunk),
        reason: parent.rationale,
        sourceType: parent.documentType,
        sensitivity: chunk.sensitivity,
        aiSafeViaMasking: true,
        aiSafeContent: masked,
      });
      continue;
    }

    const content = chunk.text?.trim();
    if (!content) {
      humanReviewDocuments.push({
        fileName: chunkFileName(parent, chunk),
        reason: 'Chunk text content is empty or unavailable',
        status: 'Human review required',
      });
      continue;
    }

    includedDocuments.push({
      fileName: chunkFileName(parent, chunk),
      reason: parent.rationale,
      sourceType: parent.documentType,
      sensitivity: chunk.sensitivity,
      aiSafeViaMasking: false,
      aiSafeContent: content,
    });
  }

  return {
    purpose: options.purpose,
    generatedAt: options.generatedAt,
    sourceDocumentsReviewed: options.documents.length,
    includedDocuments,
    excludedDocuments,
    humanReviewDocuments,
    missingKnowledge: options.missingKnowledge ?? [],
    questionsForHumanOwner: options.questionsForHumanOwner ?? [],
  };
}

/**
 * Maps inventory documents/chunks to `exportContextPackageMarkdown` input.
 * - Without chunks: keeps existing document-only behavior.
 * - With chunks: chunk-first per document when a document has chunks, with document-only
 *   fallback for documents that still have zero chunks. This keeps older live corpora
 *   exportable while newly chunked documents use sheet/range-aware sources.
 */
export function buildContextPackageExportInput(
  options: BuildContextPackageInputOptions
): ContextPackageExportInput {
  if (options.chunks === undefined) {
    return buildDocumentOnlyContextPackageExportInput(options);
  }
  return buildChunkAwareContextPackageExportInput(options);
}

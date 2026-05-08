import type {
  ContextPackageExportInput,
  ExcludedContextDocument,
  IncludedContextDocument,
} from './exportContextPackage';
import type { InventoryDocument } from './inventory';
import {
  isBlockedForAi,
  needsMaskerEvaluation,
} from '../agents/masker/upgrade';

const DEMO_PLACEHOLDER_PREFIX = '[Demo: body not loaded';

function placeholderContent(doc: InventoryDocument): string {
  return `${DEMO_PLACEHOLDER_PREFIX} — ${doc.fileName}]`;
}

/** True when this inventory row may appear under Full AI-Ready Sources for export. */
export function isSafeForContextPackageExport(doc: InventoryDocument): boolean {
  if (isBlockedForAi(doc) || needsMaskerEvaluation(doc)) {
    return false;
  }
  const needsMaskedBody =
    doc.sensitivity === 'Confidential' && doc.aiUsePolicy === 'requires_masking';
  if (needsMaskedBody && !doc.aiSafeContent?.trim()) {
    return false;
  }
  return true;
}

export type BuildContextPackageInputOptions = {
  purpose: string;
  documents: InventoryDocument[];
  generatedAt?: Date | string;
  missingKnowledge?: string[];
  questionsForHumanOwner?: string[];
};

/**
 * Maps inventory documents to `exportContextPackageMarkdown` input.
 * Restricted / blocked documents never appear in included bodies; Confidential without
 * an AI-safe body or pending Masker evaluation goes to human review.
 */
export function buildContextPackageExportInput(
  options: BuildContextPackageInputOptions
): ContextPackageExportInput {
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

    if (needsMaskerEvaluation(doc)) {
      humanReviewDocuments.push({
        fileName: doc.fileName,
        reason: 'Masker evaluation required before AI inclusion',
        status: 'Pending masking review',
      });
      continue;
    }

    const needsMaskedBody =
      doc.sensitivity === 'Confidential' && doc.aiUsePolicy === 'requires_masking';
    const hasSafe = Boolean(doc.aiSafeContent?.trim());

    if (needsMaskedBody && !hasSafe) {
      humanReviewDocuments.push({
        fileName: doc.fileName,
        reason:
          'Confidential — masking required / no AI-safe version available for export',
        status: 'Human review required',
      });
      continue;
    }

    const aiSafeContent = doc.aiSafeContent?.trim()
      ? doc.aiSafeContent.trim()
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

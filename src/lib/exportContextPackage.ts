// 機密度・文書種別の値域は curator schema (R5 確定 enum) を直接参照する。
// D-W1-Close 原則: UI 都合で英語の派生 enum を作らず、Strategist 側で揃える。
import type {
  DocumentType,
  Sensitivity,
} from '../agents/curator/schema';

export type IncludedContextDocument = {
  fileName: string;
  reason: string;
  /** Curator が判定した文書種別 (R5 enum)。 */
  sourceType: DocumentType;
  /**
   * Curator が判定した機密度 (R5 enum)。Masker 由来の AI-safe 変換は
   * `aiSafeViaMasking` で別途表現し、enum 値そのものは汚さない。
   */
  sensitivity: Sensitivity;
  /**
   * `true` なら Masker のマスキング後テキスト (`ai_safe_version`) を採用していること、
   * すなわち原本ではなく AI-safe 版を Context Package に同梱していることを示す。
   */
  aiSafeViaMasking?: boolean;
  aiSafeContent: string;
};

export type ExcludedContextDocument = {
  fileName: string;
  reason: string;
  status?: string;
};

export type ContextPackageExportInput = {
  purpose: string;
  generatedAt?: Date | string;
  sourceDocumentsReviewed: number;
  includedDocuments: IncludedContextDocument[];
  excludedDocuments: ExcludedContextDocument[];
  humanReviewDocuments?: ExcludedContextDocument[];
  missingKnowledge: string[];
  questionsForHumanOwner: string[];
};

const downstreamInstructions = [
  'Use only the included AI-ready sources below.',
  'Do not use excluded documents.',
  'Do not infer missing operational rules.',
  'If required information is missing, ask the human owner.',
];

function formatGeneratedAt(value: Date | string | undefined): string {
  if (typeof value === 'string') {
    return value;
  }

  const date = value ?? new Date();
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
    timeZoneName: 'short',
  }).format(date);
}

function bulletList(items: string[]): string {
  if (items.length === 0) {
    return '- None';
  }

  return items.map((item) => `- ${item}`).join('\n');
}

function numberedList(items: string[]): string {
  if (items.length === 0) {
    return '1. No questions.';
  }

  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

function sensitivityForDisplay(document: IncludedContextDocument): string {
  return document.aiSafeViaMasking
    ? `${document.sensitivity} (AI-safe via masking)`
    : document.sensitivity;
}

function includedDocumentsMarkdown(documents: IncludedContextDocument[]): string {
  if (documents.length === 0) {
    return '- None';
  }

  return documents
    .map(
      (document) => `- ${document.fileName}
  - Reason: ${document.reason}
  - Source type: ${document.sourceType}
  - Sensitivity: ${sensitivityForDisplay(document)}`
    )
    .join('\n');
}

function excludedDocumentsMarkdown(documents: ExcludedContextDocument[]): string {
  if (documents.length === 0) {
    return '- None';
  }

  return documents
    .map((document) => {
      const status = document.status ? `\n  - Status: ${document.status}` : '';
      return `- ${document.fileName}
  - Reason: ${document.reason}${status}`;
    })
    .join('\n');
}

function fullSourcesMarkdown(documents: IncludedContextDocument[]): string {
  if (documents.length === 0) {
    return 'No AI-ready sources were included.';
  }

  return documents
    .map(
      (document) => `## Source: ${document.fileName}

\`\`\`text
${document.aiSafeContent.trim()}
\`\`\``
    )
    .join('\n\n');
}

export function exportContextPackageMarkdown(
  input: ContextPackageExportInput
): string {
  const humanReviewDocuments = input.humanReviewDocuments ?? [];
  const allExcludedDocuments = [
    ...input.excludedDocuments,
    ...humanReviewDocuments.map((document) => ({
      ...document,
      status: document.status ?? 'Restricted / human review only',
    })),
  ];

  return `# AI-Ready Context Package

## Package Manifest

- Purpose: ${input.purpose}
- Generated at: ${formatGeneratedAt(input.generatedAt)}
- Source documents reviewed: ${input.sourceDocumentsReviewed}
- Included documents: ${input.includedDocuments.length}
- Excluded documents: ${input.excludedDocuments.length}
- Human review required: ${humanReviewDocuments.length}

## Instructions for Downstream AI

${downstreamInstructions.join('\n')}

## Included Documents

${includedDocumentsMarkdown(input.includedDocuments)}

## Excluded Documents

${excludedDocumentsMarkdown(allExcludedDocuments)}

## Missing Knowledge

${bulletList(input.missingKnowledge)}

## Questions for Human Owner

${numberedList(input.questionsForHumanOwner)}

---

# Full AI-Ready Sources

${fullSourcesMarkdown(input.includedDocuments)}
`;
}

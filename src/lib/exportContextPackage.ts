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

/**
 * pre-LLM input budget で落とした safe chunk の文書別内訳。
 * これが空でないとき、その Context Package は「全件をレビューした完全版ではない」。
 */
export type BudgetTruncatedDocument = {
  fileName: string;
  droppedChunks: number;
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
  /**
   * budget で Strategist へ渡す前に落とした safe chunk の内訳。
   * 空 / 未指定なら truncation なし（完全版）。
   */
  budgetTruncatedDocuments?: BudgetTruncatedDocument[];
};

const downstreamInstructions = [
  'Use only the included AI-ready sources below.',
  'Do not use excluded documents.',
  'Do not infer missing operational rules.',
  'If required information is missing, ask the human owner.',
];

const truncationInstruction =
  'This package is INCOMPLETE: some safe content was dropped to fit the model input budget (see "Budget Truncation"). Treat coverage as partial and re-run with a narrower docIds scope for full coverage.';

function totalDroppedChunks(documents: BudgetTruncatedDocument[]): number {
  return documents.reduce((sum, doc) => sum + doc.droppedChunks, 0);
}

function budgetTruncationMarkdown(documents: BudgetTruncatedDocument[]): string {
  if (documents.length === 0) {
    return '- None';
  }

  return documents
    .map((doc) => `- ${doc.fileName}\n  - Dropped chunks: ${doc.droppedChunks}`)
    .join('\n');
}

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

  const truncatedDocuments = input.budgetTruncatedDocuments ?? [];
  const droppedChunks = totalDroppedChunks(truncatedDocuments);
  const isTruncated = droppedChunks > 0;

  const manifestTruncationLine = isTruncated
    ? `\n- ⚠️ Budget truncation: ${droppedChunks} safe chunk(s) across ${truncatedDocuments.length} document(s) were dropped to fit the model input budget — coverage is INCOMPLETE`
    : '';
  const instructions = isTruncated
    ? [...downstreamInstructions, truncationInstruction]
    : downstreamInstructions;

  return `# AI-Ready Context Package

## Package Manifest

- Purpose: ${input.purpose}
- Generated at: ${formatGeneratedAt(input.generatedAt)}
- Source documents reviewed: ${input.sourceDocumentsReviewed}
- Included documents: ${input.includedDocuments.length}
- Excluded documents: ${input.excludedDocuments.length}
- Human review required: ${humanReviewDocuments.length}${manifestTruncationLine}

## Instructions for Downstream AI

${instructions.join('\n')}

## Included Documents

${includedDocumentsMarkdown(input.includedDocuments)}

## Excluded Documents

${excludedDocumentsMarkdown(allExcludedDocuments)}

## Budget Truncation (Incomplete Coverage)

${budgetTruncationMarkdown(truncatedDocuments)}

## Missing Knowledge

${bulletList(input.missingKnowledge)}

## Questions for Human Owner

${numberedList(input.questionsForHumanOwner)}

---

# Full AI-Ready Sources

${fullSourcesMarkdown(input.includedDocuments)}
`;
}

// --- Source bundle export (D-DLV-1 fast-follow) -----------------------------
//
// 単一 .md は manifest（メタ層）と本文（Full AI-Ready Sources）を1ファイルに
// 混在させるため、NotebookLM が後半本文を一次データとして拾えず「構成案」と
// 誤読する failure mode が E2E 検証で実証された（docs/delivery-e2e/）。
// その対策として、included 各文書を「個別の source ファイル（本文のみ）」に分け、
// 4分類のメタ層は guide ファイル1枚に閉じ込める。
// 安全性は「guide の指示を守らせること」ではなく、excluded/restricted/pending を
// source 群に物理的に出力しないこと（exclusion by absence）で担保する。

export type ContextPackageSourceRole = 'guide' | 'included-source';

export type ContextPackageSourceFile = {
  /** bundle 内のファイル名（NotebookLM に渡す source 名）。bundle 内で一意。 */
  fileName: string;
  content: string;
  /** ダウンロード/添付時の MIME。NotebookLM が native 形式で扱えるようにする。 */
  contentType: string;
  role: ContextPackageSourceRole;
};

export type ContextPackageSourceBundle = {
  files: ContextPackageSourceFile[];
};

export const CONTEXT_PACKAGE_GUIDE_FILE_NAME = '00-CONTEXT-PACKAGE-GUIDE.md';

/** guide の Instructions 節。本文層を別 source に置いたことを明示する。 */
const sourceBundleInstructions = [
  'Included source filenames are provided as separate sources. Use those source files for factual answers.',
  'Do not use excluded documents — they are intentionally NOT provided as source files.',
  'Do not infer missing operational rules.',
  'If required information is missing, ask the human owner.',
];

function contentTypeForFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.tsv')) return 'text/tab-separated-values';
  if (lower.endsWith('.json')) return 'application/json';
  return 'text/plain';
}

function fileNameWithIndex(fileName: string, index: number): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) {
    return `${fileName}-${index}`;
  }
  return `${fileName.slice(0, dot)}-${index}${fileName.slice(dot)}`;
}

/** bundle 内でファイル名衝突（同名 included 文書）を避ける。 */
function dedupeFileName(fileName: string, used: Set<string>): string {
  if (!used.has(fileName)) {
    used.add(fileName);
    return fileName;
  }
  let index = 2;
  let candidate = fileNameWithIndex(fileName, index);
  while (used.has(candidate)) {
    index += 1;
    candidate = fileNameWithIndex(fileName, index);
  }
  used.add(candidate);
  return candidate;
}

/**
 * guide（メタ層）の markdown。included は名前+理由のみで本文は載せない
 * （本文を載せると単一 .md と同じ frame 誤読を再発させるため）。
 */
function buildSourceBundleGuideMarkdown(
  input: ContextPackageExportInput,
  includedSourceFileNames: string[]
): string {
  const humanReviewDocuments = input.humanReviewDocuments ?? [];
  const allExcludedDocuments = [
    ...input.excludedDocuments,
    ...humanReviewDocuments.map((document) => ({
      ...document,
      status: document.status ?? 'Restricted / human review only',
    })),
  ];

  const truncatedDocuments = input.budgetTruncatedDocuments ?? [];
  const droppedChunks = totalDroppedChunks(truncatedDocuments);
  const isTruncated = droppedChunks > 0;
  const manifestTruncationLine = isTruncated
    ? `\n- ⚠️ Budget truncation: ${droppedChunks} safe chunk(s) across ${truncatedDocuments.length} document(s) were dropped to fit the model input budget — coverage is INCOMPLETE`
    : '';
  const instructions = isTruncated
    ? [...sourceBundleInstructions, truncationInstruction]
    : sourceBundleInstructions;

  const includedSourceList =
    includedSourceFileNames.length === 0
      ? '- None'
      : includedSourceFileNames.map((name) => `- ${name}`).join('\n');

  return `# AI-Ready Context Package — Guide

This file is the META guide for a Context Package. It does NOT contain the factual
content. The factual content is delivered as the separate included source files
listed below — use those source files for factual answers.

## Package Manifest

- Purpose: ${input.purpose}
- Generated at: ${formatGeneratedAt(input.generatedAt)}
- Source documents reviewed: ${input.sourceDocumentsReviewed}
- Included documents: ${input.includedDocuments.length}
- Excluded documents: ${input.excludedDocuments.length}
- Human review required: ${humanReviewDocuments.length}${manifestTruncationLine}

## Instructions for Downstream AI

${instructions.join('\n')}

## Included Source Files

${includedDocumentsMarkdown(input.includedDocuments)}

### File list

${includedSourceList}

## Excluded Documents (NOT provided as sources)

${excludedDocumentsMarkdown(allExcludedDocuments)}

## Budget Truncation (Incomplete Coverage)

${budgetTruncationMarkdown(truncatedDocuments)}

## Missing Knowledge

${bulletList(input.missingKnowledge)}

## Questions for Human Owner

${numberedList(input.questionsForHumanOwner)}
`;
}

/**
 * Context Package を「個別 source ファイル群 + guide 1枚」に分割して返す。
 * - included: 1文書 = 1ファイル（本文のみ。masked 文書は ai_safe 本文）。
 * - excluded / restricted / pending masking: source file は作らず guide に名前+理由のみ。
 * - guide: メタ層（manifest / instructions / 4分類）。
 * UI / スクリプトはこの純関数を共有して download(zip) / ファイル出力に使う。
 */
export function exportContextPackageSourceBundle(
  input: ContextPackageExportInput
): ContextPackageSourceBundle {
  const used = new Set<string>([CONTEXT_PACKAGE_GUIDE_FILE_NAME]);
  const includedFiles: ContextPackageSourceFile[] = input.includedDocuments.map(
    (document) => {
      const fileName = dedupeFileName(document.fileName, used);
      return {
        fileName,
        content: document.aiSafeContent,
        contentType: contentTypeForFileName(fileName),
        role: 'included-source' as const,
      };
    }
  );

  const guideFile: ContextPackageSourceFile = {
    fileName: CONTEXT_PACKAGE_GUIDE_FILE_NAME,
    content: buildSourceBundleGuideMarkdown(
      input,
      includedFiles.map((file) => file.fileName)
    ),
    contentType: 'text/markdown',
    role: 'guide',
  };

  // guide を先頭に（ファイル名 00- でソート時も先頭に来る）。
  return { files: [guideFile, ...includedFiles] };
}

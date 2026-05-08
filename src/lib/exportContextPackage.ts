// `Sensitivity` の値域は正本である curator schema を参照する (R5 確定 enum)。
// Strategist 出力の都合で AI-safe 変換注記など派生表現も許容するため `| string` を残す。
import type { Sensitivity } from '../agents/curator/schema';
export type { Sensitivity };

export type ExportSourceType =
  | 'Text'
  | 'Markdown'
  | 'CSV'
  | 'PDF'
  | 'Template'
  | 'Checklist'
  | 'Policy'
  | 'Other';

export type IncludedContextDocument = {
  fileName: string;
  reason: string;
  sourceType: ExportSourceType | string;
  sensitivity: Sensitivity | string;
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

function includedDocumentsMarkdown(documents: IncludedContextDocument[]): string {
  if (documents.length === 0) {
    return '- None';
  }

  return documents
    .map(
      (document) => `- ${document.fileName}
  - Reason: ${document.reason}
  - Source type: ${document.sourceType}
  - Sensitivity: ${document.sensitivity}`
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

export const sampleContextPackage: ContextPackageExportInput = {
  purpose: '新人スタッフ向けに給与計算業務を学べるAIを作りたい',
  generatedAt: '2026-05-08 18:00 JST',
  sourceDocumentsReviewed: 7,
  includedDocuments: [
    {
      fileName: '給与計算チェックリスト.md',
      reason: '現行版であり、給与計算の基本手順を含む',
      sourceType: 'Markdown',
      sensitivity: 'Internal',
      aiSafeContent:
        '勤怠データを確認する\n残業時間、欠勤、控除項目を確認する\n支給前に先輩確認が必要なケースを確認する',
    },
    {
      fileName: '顧客対応メモ_匿名化.txt',
      reason: '例外対応の参考になる。個人情報はマスク済み',
      sourceType: 'Text',
      sensitivity: 'Confidential -> AI-safe',
      aiSafeContent:
        '[Person_001] 社では月途中入社時の日割り計算について確認が必要。\n[Company_001] では交通費精算の締め日が通常と異なる。',
    },
  ],
  excludedDocuments: [
    {
      fileName: '古い料金表_2023.csv',
      reason: '旧版候補。今回の目的には使わない',
    },
  ],
  humanReviewDocuments: [
    {
      fileName: '顧問契約書_実案件サンプル.txt',
      reason: 'Masker detected residual re-identification risk',
    },
  ],
  missingKnowledge: [
    '給与計算で先輩確認が必要な例外条件',
    '顧客ごとの特殊ルールの管理方法',
    '法改正時にどの資料を正本として更新するか',
  ],
  questionsForHumanOwner: [
    '給与計算で必ず先輩確認が必要な条件は何ですか?',
    '顧客ごとに例外処理が発生する代表パターンは何ですか?',
    '新人スタッフに参照させてはいけない資料はありますか?',
  ],
};

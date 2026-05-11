import type { AiUsePolicy, Sensitivity } from '../agents/curator/schema';
import type { KnowledgeChunk } from './knowledgeChunkSchema';

export type ColumnSensitivityRule = {
  matchExact?: string[];
  matchPartial?: string[];
  sensitivity: Sensitivity;
  aiUsePolicy: AiUsePolicy;
  reason: string;
};

/** Higher rank = more restrictive (aligned with {@link SensitivityEnum} ordering intent). */
const SENSITIVITY_RANK: Record<Sensitivity, number> = {
  Public: 0,
  Internal: 1,
  Confidential: 2,
  Restricted: 3,
};

export const DEFAULT_COLUMN_SENSITIVITY_RULES: ColumnSensitivityRule[] = [
  {
    matchExact: ['顧客名', '氏名', '担当者'],
    matchPartial: ['顧客', '氏名', '担当'],
    sensitivity: 'Confidential',
    aiUsePolicy: 'requires_masking',
    reason: '列ヘッダが顧客名/氏名/担当者を示すため',
  },
  {
    matchExact: ['メール', 'Email'],
    matchPartial: ['メール', 'email', 'e-mail'],
    sensitivity: 'Confidential',
    aiUsePolicy: 'requires_masking',
    reason: '列ヘッダがメールアドレス情報を示すため',
  },
  {
    matchExact: ['電話番号', 'Tel'],
    matchPartial: ['電話', 'tel', 'phone'],
    sensitivity: 'Confidential',
    aiUsePolicy: 'requires_masking',
    reason: '列ヘッダが電話番号情報を示すため',
  },
  {
    matchExact: ['住所'],
    matchPartial: ['住所', '所在地', 'address'],
    sensitivity: 'Confidential',
    aiUsePolicy: 'requires_masking',
    reason: '列ヘッダが住所情報を示すため',
  },
  {
    matchExact: ['個別金額', '単価', '報酬'],
    matchPartial: ['金額', '単価', '報酬', 'fee', 'price'],
    sensitivity: 'Confidential',
    aiUsePolicy: 'requires_masking',
    reason: '列ヘッダが個別金額/単価/報酬を示すため',
  },
];

const TABLE_SEPARATOR_CELL_PATTERN = /^:?-{3,}:?$/;

function normalizeHeaderValue(value: string): string {
  return value.trim().normalize('NFKC').toLowerCase();
}

function parseMarkdownRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) {
    return [];
  }

  const withoutEdgePipes = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return withoutEdgePipes.split('|').map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = parseMarkdownRow(line).filter((cell) => cell.length > 0);
  if (cells.length === 0) {
    return false;
  }
  return cells.every((cell) => TABLE_SEPARATOR_CELL_PATTERN.test(cell));
}

function extractMarkdownTableHeaderCells(text: string): string[] {
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length - 1; i += 1) {
    const headerCells = parseMarkdownRow(lines[i]).filter(
      (cell) => cell.length > 0
    );
    if (headerCells.length === 0) {
      continue;
    }
    const separatorLine = lines[i + 1];
    const separatorCells = parseMarkdownRow(separatorLine).filter(
      (cell) => cell.length > 0
    );
    if (
      separatorCells.length !== headerCells.length ||
      !isMarkdownTableSeparator(separatorLine)
    ) {
      continue;
    }
    return headerCells;
  }

  return [];
}

function matchesRule(
  normalizedHeaderCells: string[],
  rule: ColumnSensitivityRule
): boolean {
  const normalizedExact = (rule.matchExact ?? []).map(normalizeHeaderValue);
  const normalizedPartial = (rule.matchPartial ?? []).map(normalizeHeaderValue);

  return normalizedHeaderCells.some((header) => {
    if (normalizedExact.some((candidate) => candidate === header)) {
      return true;
    }
    return normalizedPartial.some(
      (candidate) => candidate.length > 0 && header.includes(candidate)
    );
  });
}

export function upgradeChunkSensitivityFromColumnHeader(
  chunk: KnowledgeChunk,
  rules: ColumnSensitivityRule[]
): KnowledgeChunk {
  const headerCells = extractMarkdownTableHeaderCells(chunk.text);
  if (headerCells.length === 0) {
    return { ...chunk };
  }

  const normalizedHeaderCells = headerCells.map(normalizeHeaderValue);
  const matchedRule = rules.find((rule) => matchesRule(normalizedHeaderCells, rule));
  if (matchedRule === undefined) {
    return { ...chunk };
  }

  // Never lower sensitivity from column rules; only promote when the rule is stricter.
  if (
    SENSITIVITY_RANK[chunk.sensitivity] >= SENSITIVITY_RANK[matchedRule.sensitivity]
  ) {
    return { ...chunk };
  }

  return {
    ...chunk,
    sensitivity: matchedRule.sensitivity,
    aiUsePolicy: matchedRule.aiUsePolicy,
    sensitivitySource: 'columnRule',
    sensitivityReason: matchedRule.reason,
  };
}

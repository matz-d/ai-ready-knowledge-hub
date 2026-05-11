import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLUMN_SENSITIVITY_RULES,
  upgradeChunkSensitivityFromColumnHeader,
  type ColumnSensitivityRule,
} from '../columnSensitivityRules';
import { KnowledgeChunkSchema, type KnowledgeChunk } from '../knowledgeChunkSchema';

function buildChunk(
  text: string,
  overrides: Partial<KnowledgeChunk> = {}
): KnowledgeChunk {
  const base = {
    id: 'chunk-1',
    docId: 'doc-1',
    schemaVersion: 1 as const,
    sourceType: 'spreadsheet' as const,
    structureType: 'table' as const,
    locator: {
      kind: 'spreadsheet' as const,
      sheetName: 'Sheet1',
      range: 'A1:C3',
    },
    text,
    sensitivity: 'Internal' as const,
    aiUsePolicy: 'direct' as const,
    sensitivitySource: 'inherited' as const,
    extractionProvider: 'xlsx' as const,
    sourceHash: 'source-hash',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  return KnowledgeChunkSchema.parse({ ...base, ...overrides });
}

function markdownTable(header: string): string {
  return `| ${header} | メモ |\n| --- | --- |\n| value | note |`;
}

describe('upgradeChunkSensitivityFromColumnHeader', () => {
  const rules = DEFAULT_COLUMN_SENSITIVITY_RULES;

  it.each(['顧客名', 'メール', '電話番号', '住所', '単価'])(
    'promotes to Confidential on exact match header: %s',
    (header) => {
      const chunk = buildChunk(markdownTable(header));
      const upgraded = upgradeChunkSensitivityFromColumnHeader(chunk, rules);

      expect(upgraded.sensitivity).toBe('Confidential');
      expect(upgraded.aiUsePolicy).toBe('requires_masking');
      expect(upgraded.sensitivitySource).toBe('columnRule');
      expect(upgraded.sensitivityReason).toBeTruthy();
    }
  );

  it.each([
    '主要顧客担当',
    '連絡先Emailアドレス',
    'Tel(携帯)',
    '住所(都道府県)',
    '報酬(税込)',
  ])('promotes to Confidential on partial match header: %s', (header) => {
    const chunk = buildChunk(markdownTable(header));
    const upgraded = upgradeChunkSensitivityFromColumnHeader(chunk, rules);

    expect(upgraded.sensitivity).toBe('Confidential');
    expect(upgraded.aiUsePolicy).toBe('requires_masking');
    expect(upgraded.sensitivitySource).toBe('columnRule');
    expect(upgraded.sensitivityReason).toBeTruthy();
  });

  it('does not change an already Restricted chunk even when header matches', () => {
    const chunk = buildChunk(markdownTable('顧客名'), {
      sensitivity: 'Restricted',
      aiUsePolicy: 'blocked',
      sensitivitySource: 'inherited',
    });

    const upgraded = upgradeChunkSensitivityFromColumnHeader(chunk, rules);
    expect(upgraded).toEqual(chunk);
  });

  it('does not change an already Confidential chunk when header matches same tier rule', () => {
    const chunk = buildChunk(markdownTable('顧客名'), {
      sensitivity: 'Confidential',
      aiUsePolicy: 'requires_masking',
      sensitivitySource: 'inherited',
    });

    const upgraded = upgradeChunkSensitivityFromColumnHeader(chunk, rules);
    expect(upgraded).toEqual(chunk);
  });

  it('promotes Confidential to Restricted when a stricter rule matches', () => {
    const stricterRules: ColumnSensitivityRule[] = [
      {
        matchExact: ['顧客名'],
        sensitivity: 'Restricted',
        aiUsePolicy: 'blocked',
        reason: 'PII column requires Restricted',
      },
    ];
    const chunk = buildChunk(markdownTable('顧客名'), {
      sensitivity: 'Confidential',
      aiUsePolicy: 'requires_masking',
      sensitivitySource: 'inherited',
    });

    const upgraded = upgradeChunkSensitivityFromColumnHeader(chunk, stricterRules);
    expect(upgraded.sensitivity).toBe('Restricted');
    expect(upgraded.aiUsePolicy).toBe('blocked');
    expect(upgraded.sensitivitySource).toBe('columnRule');
    expect(upgraded.sensitivityReason).toBe('PII column requires Restricted');
  });

  it('ignores markdown tables whose separator column count does not match header', () => {
    const text = '| 顧客名 | メモ |\n| --- |\n| value | note |';
    const chunk = buildChunk(text);
    const upgraded = upgradeChunkSensitivityFromColumnHeader(chunk, rules);

    expect(upgraded.sensitivity).toBe('Internal');
    expect(upgraded.sensitivitySource).toBe('inherited');
  });

  it('keeps inherited source when no rules match', () => {
    const chunk = buildChunk(markdownTable('部署'));
    const upgraded = upgradeChunkSensitivityFromColumnHeader(chunk, rules);

    expect(upgraded.sensitivity).toBe('Internal');
    expect(upgraded.aiUsePolicy).toBe('direct');
    expect(upgraded.sensitivitySource).toBe('inherited');
    expect(upgraded.sensitivityReason).toBeUndefined();
  });

  it('applies rule-configured reason and policy', () => {
    const customRules: ColumnSensitivityRule[] = [
      {
        matchExact: ['部署'],
        sensitivity: 'Confidential',
        aiUsePolicy: 'requires_masking',
        reason: 'custom reason',
      },
    ];
    const chunk = buildChunk(markdownTable('部署'));
    const upgraded = upgradeChunkSensitivityFromColumnHeader(chunk, customRules);

    expect(upgraded.sensitivitySource).toBe('columnRule');
    expect(upgraded.sensitivityReason).toBe('custom reason');
    expect(upgraded.aiUsePolicy).toBe('requires_masking');
  });
});

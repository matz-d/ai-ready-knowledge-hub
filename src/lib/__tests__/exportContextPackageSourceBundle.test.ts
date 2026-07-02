import { describe, expect, it } from 'vitest';

import {
  CONTEXT_PACKAGE_GUIDE_FILE_NAME,
  exportContextPackageMarkdown,
  exportContextPackageSourceBundle,
  type ContextPackageExportInput,
} from '../exportContextPackage';

function baseInput(
  overrides: Partial<ContextPackageExportInput> = {}
): ContextPackageExportInput {
  return {
    purpose: '料金問い合わせアシスタント',
    generatedAt: new Date('2026-06-09T00:00:00.000Z'),
    sourceDocumentsReviewed: 4,
    includedDocuments: [
      {
        fileName: '料金表_2026.csv',
        reason: '現行料金表',
        sourceType: '表',
        sensitivity: 'Internal',
        aiSafeContent: '業務,料金\n給与計算,33000',
      },
      {
        fileName: '顧客対応メモ_匿名化.txt',
        reason: 'masked AI-safe',
        sourceType: 'メモ',
        sensitivity: 'Confidential',
        aiSafeViaMasking: true,
        aiSafeContent: '顧客名: [顧客X社]',
      },
    ],
    excludedDocuments: [
      { fileName: '料金表_2023.csv', reason: 'superseded' },
    ],
    humanReviewDocuments: [
      { fileName: '顧問契約書.txt', reason: 'Restricted' },
    ],
    missingKnowledge: ['同業比較データ'],
    questionsForHumanOwner: ['見積もり確定の承認可否'],
    ...overrides,
  };
}

describe('exportContextPackageSourceBundle', () => {
  it('emits a guide first plus one file per included document', () => {
    const { files } = exportContextPackageSourceBundle(baseInput());

    expect(files[0].fileName).toBe(CONTEXT_PACKAGE_GUIDE_FILE_NAME);
    expect(files[0].role).toBe('guide');
    expect(files.filter((f) => f.role === 'included-source')).toHaveLength(2);
    expect(files.map((f) => f.fileName)).toEqual([
      CONTEXT_PACKAGE_GUIDE_FILE_NAME,
      '料金表_2026.csv',
      '顧客対応メモ_匿名化.txt',
    ]);
  });

  it('keeps factual bodies out of the guide and inside their own source files', () => {
    const { files } = exportContextPackageSourceBundle(baseInput());
    const guide = files.find((f) => f.role === 'guide')!;
    const pricing = files.find((f) => f.fileName === '料金表_2026.csv')!;

    // 本文（実数字）は guide に載らず、個別 source にのみ存在する。
    expect(guide.content).not.toContain('33000');
    expect(pricing.content).toContain('33000');
    expect(pricing.content).toBe('業務,料金\n給与計算,33000');
  });

  it('does NOT create source files for excluded / human-review docs (exclusion by absence)', () => {
    const { files } = exportContextPackageSourceBundle(baseInput());
    const names = files.map((f) => f.fileName);

    expect(names).not.toContain('料金表_2023.csv');
    expect(names).not.toContain('顧問契約書.txt');

    // ただし guide には名前と理由が残る（除外の根拠を開示する）。
    const guide = files.find((f) => f.role === 'guide')!;
    expect(guide.content).toContain('料金表_2023.csv');
    expect(guide.content).toContain('顧問契約書.txt');
  });

  it('guide instructs downstream AI to use the separate source files', () => {
    const guide = exportContextPackageSourceBundle(baseInput()).files[0];
    expect(guide.content).toContain(
      'Use those source files for factual answers.'
    );
    expect(guide.content).toContain('Confidential (AI-safe via masking)');
  });

  it('marks budget truncation inside the portable bundle guide', () => {
    const guide = exportContextPackageSourceBundle(
      baseInput({
        budgetTruncatedDocuments: [
          { fileName: '給与計算チェックリスト.md', droppedChunks: 1 },
          { fileName: 'mhlw-r07-model-work-rules.pdf', droppedChunks: 167 },
        ],
      }),
    ).files[0];

    expect(guide.content).toContain(
      'Budget truncation: 168 safe chunk(s) across 2 document(s)',
    );
    expect(guide.content).toContain('coverage is INCOMPLETE');
    expect(guide.content).toContain(
      'This package is INCOMPLETE: some safe content was dropped',
    );
    expect(guide.content).toContain('## Budget Truncation (Incomplete Coverage)');
    expect(guide.content).toContain('- 給与計算チェックリスト.md');
    expect(guide.content).toContain('  - Dropped chunks: 1');
    expect(guide.content).toContain('- mhlw-r07-model-work-rules.pdf');
    expect(guide.content).toContain('  - Dropped chunks: 167');
  });

  it('marks budget truncation in the single markdown artifact as well', () => {
    const markdown = exportContextPackageMarkdown(
      baseInput({
        budgetTruncatedDocuments: [
          { fileName: '給与計算チェックリスト.md', droppedChunks: 1 },
        ],
      }),
    );

    expect(markdown).toContain(
      'Budget truncation: 1 safe chunk(s) across 1 document(s)',
    );
    expect(markdown).toContain('coverage is INCOMPLETE');
    expect(markdown).toContain(
      'This package is INCOMPLETE: some safe content was dropped',
    );
    expect(markdown).toContain('## Budget Truncation (Incomplete Coverage)');
    expect(markdown).toContain('- 給与計算チェックリスト.md');
    expect(markdown).toContain('  - Dropped chunks: 1');
  });

  it('marks degraded missing consolidation in portable artifacts', () => {
    const input = baseInput({
      missingKnowledgeConsolidation: 'deterministic_fallback',
      missingKnowledge: ['給与締め日の確定情報'],
    });
    const markdown = exportContextPackageMarkdown(input);
    const guide = exportContextPackageSourceBundle(input).files[0].content;

    expect(markdown).toContain('Missing knowledge consolidation degraded');
    expect(markdown).toContain('- 給与締め日の確定情報');
    expect(guide).toContain('Missing knowledge consolidation degraded');
    expect(guide).toContain('- 給与締め日の確定情報');
  });

  it('infers content type from the file extension', () => {
    const { files } = exportContextPackageSourceBundle(baseInput());
    const byName = new Map(files.map((f) => [f.fileName, f.contentType]));

    expect(byName.get(CONTEXT_PACKAGE_GUIDE_FILE_NAME)).toBe('text/markdown');
    expect(byName.get('料金表_2026.csv')).toBe('text/csv');
    expect(byName.get('顧客対応メモ_匿名化.txt')).toBe('text/plain');
  });

  it('keeps recognized source extensions at the end for NotebookLM uploads', () => {
    const input = baseInput({
      includedDocuments: [
        {
          fileName: '料金表_2026.csv (sheet=Sheet1, range=A1:D12)',
          reason: '現行料金表',
          sourceType: '表',
          sensitivity: 'Internal',
          aiSafeContent: '業務,料金\n給与計算,33000',
        },
      ],
    });

    const { files } = exportContextPackageSourceBundle(input);

    expect(files[1]).toEqual(
      expect.objectContaining({
        fileName: '料金表_2026 (sheet=Sheet1, range=A1_D12).csv',
        originalFileName: '料金表_2026.csv (sheet=Sheet1, range=A1:D12)',
        contentType: 'text/csv',
      })
    );
    expect(files[0].content).toContain(
      'Source file: `料金表_2026 (sheet=Sheet1, range=A1_D12).csv`'
    );
  });

  it('disambiguates duplicate included file names', () => {
    const input = baseInput({
      includedDocuments: [
        {
          fileName: 'memo.txt',
          reason: 'a',
          sourceType: 'メモ',
          sensitivity: 'Internal',
          aiSafeContent: 'A',
        },
        {
          fileName: 'memo.txt',
          reason: 'b',
          sourceType: 'メモ',
          sensitivity: 'Internal',
          aiSafeContent: 'B',
        },
      ],
    });

    const names = exportContextPackageSourceBundle(input).files.map(
      (f) => f.fileName
    );
    expect(names).toEqual([
      CONTEXT_PACKAGE_GUIDE_FILE_NAME,
      'memo.txt',
      'memo-2.txt',
    ]);
  });

  it('sanitizes source file names before they become filesystem or zip paths', () => {
    const input = baseInput({
      includedDocuments: [
        {
          fileName: '../顧客/evil:name?.csv',
          reason: 'path-like name',
          sourceType: '表',
          sensitivity: 'Internal',
          aiSafeContent: 'safe body',
        },
        {
          fileName: 'CON.txt',
          reason: 'windows reserved name',
          sourceType: 'メモ',
          sensitivity: 'Internal',
          aiSafeContent: 'reserved',
        },
      ],
    });

    const { files } = exportContextPackageSourceBundle(input);
    const names = files.map((f) => f.fileName);
    const guide = files[0].content;

    expect(names).toEqual([
      CONTEXT_PACKAGE_GUIDE_FILE_NAME,
      '_顧客_evil_name_.csv',
      '_CON.txt',
    ]);
    for (const name of names) {
      expect(name).not.toMatch(/[\\/]/);
      expect(name).not.toContain('..');
      expect(name).not.toMatch(/[<>:"|?*\x00-\x1F]/);
    }
    expect(guide).toContain('- Source file: `_顧客_evil_name_.csv`');
    expect(guide).toContain('- Original document: `../顧客/evil:name?.csv`');
  });

  it('dedupes after sanitization and preserves original file names for audit', () => {
    const input = baseInput({
      includedDocuments: [
        {
          fileName: 'dir/memo.txt',
          reason: 'first',
          sourceType: 'メモ',
          sensitivity: 'Internal',
          aiSafeContent: 'A',
        },
        {
          fileName: 'dir\\memo.txt',
          reason: 'second',
          sourceType: 'メモ',
          sensitivity: 'Internal',
          aiSafeContent: 'B',
        },
      ],
    });

    const { files } = exportContextPackageSourceBundle(input);
    expect(files.map((f) => f.fileName)).toEqual([
      CONTEXT_PACKAGE_GUIDE_FILE_NAME,
      'dir_memo.txt',
      'dir_memo-2.txt',
    ]);
    expect(files[1]).toEqual(
      expect.objectContaining({
        fileName: 'dir_memo.txt',
        originalFileName: 'dir/memo.txt',
      })
    );
    expect(files[2]).toEqual(
      expect.objectContaining({
        fileName: 'dir_memo-2.txt',
        originalFileName: 'dir\\memo.txt',
      })
    );
  });

  it('maps rich guide metadata to the actual sanitized/deduped source file names', () => {
    const input = baseInput({
      includedDocuments: [
        {
          fileName: 'memo.txt',
          reason: 'first reason',
          sourceType: 'メモ',
          sensitivity: 'Internal',
          aiSafeContent: 'A',
        },
        {
          fileName: 'memo.txt',
          reason: 'second reason',
          sourceType: 'メモ',
          sensitivity: 'Confidential',
          aiSafeViaMasking: true,
          aiSafeContent: 'B',
        },
      ],
    });

    const guide = exportContextPackageSourceBundle(input).files[0].content;

    expect(guide).toContain('- Source file: `memo.txt`');
    expect(guide).toContain('- Source file: `memo-2.txt`');
    expect(guide).toContain('- Reason: first reason');
    expect(guide).toContain('- Reason: second reason');
    expect(guide).toContain(
      '- Sensitivity: Confidential (AI-safe via masking)'
    );
  });
});

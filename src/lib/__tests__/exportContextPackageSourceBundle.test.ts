import { describe, expect, it } from 'vitest';

import {
  CONTEXT_PACKAGE_GUIDE_FILE_NAME,
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
      { fileName: '古い料金表_2023.csv', reason: 'superseded' },
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

    expect(names).not.toContain('古い料金表_2023.csv');
    expect(names).not.toContain('顧問契約書.txt');

    // ただし guide には名前と理由が残る（除外の根拠を開示する）。
    const guide = files.find((f) => f.role === 'guide')!;
    expect(guide.content).toContain('古い料金表_2023.csv');
    expect(guide.content).toContain('顧問契約書.txt');
  });

  it('guide instructs downstream AI to use the separate source files', () => {
    const guide = exportContextPackageSourceBundle(baseInput()).files[0];
    expect(guide.content).toContain(
      'Use those source files for factual answers.'
    );
    expect(guide.content).toContain('Confidential (AI-safe via masking)');
  });

  it('infers content type from the file extension', () => {
    const { files } = exportContextPackageSourceBundle(baseInput());
    const byName = new Map(files.map((f) => [f.fileName, f.contentType]));

    expect(byName.get(CONTEXT_PACKAGE_GUIDE_FILE_NAME)).toBe('text/markdown');
    expect(byName.get('料金表_2026.csv')).toBe('text/csv');
    expect(byName.get('顧客対応メモ_匿名化.txt')).toBe('text/plain');
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
});

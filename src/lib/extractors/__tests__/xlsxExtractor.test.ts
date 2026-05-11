import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { extractXlsx } from '../xlsxExtractor';

const baseInput = {
  docId: 'doc-xlsx-1',
  fileName: 'sample.xlsx',
  documentSensitivity: 'Internal' as const,
  documentAiUsePolicy: 'direct' as const,
};

function createWorkbookBuffer(sheetCount = 2): Buffer {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['顧客名', '数量'],
      ['Acme', 10],
    ]),
    '顧客一覧'
  );

  if (sheetCount >= 2) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['部署', '人数'],
        ['営業', 3],
      ]),
      '部署集計'
    );
  }

  for (let i = 2; i < sheetCount; i += 1) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['列1', '列2'],
        [`row-${i}`, `${i}`],
      ]),
      `Sheet${i + 1}`
    );
  }

  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;
}

describe('extractXlsx', () => {
  it('extracts chunks by sheet used range and sets spreadsheet locator', () => {
    const content = createWorkbookBuffer();
    const { chunks, normalizedMarkdown } = extractXlsx({
      ...baseInput,
      content: new Uint8Array(content),
    });

    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.locator)).toEqual([
      { kind: 'spreadsheet', sheetName: '顧客一覧', range: 'A1:B2' },
      { kind: 'spreadsheet', sheetName: '部署集計', range: 'A1:B2' },
    ]);
    expect(normalizedMarkdown).toContain('## 顧客一覧');
    expect(normalizedMarkdown).toContain('## 部署集計');
  });

  it('applies column header sensitivity rules for each chunk independently', () => {
    const { chunks } = extractXlsx({
      ...baseInput,
      content: createWorkbookBuffer(),
    });

    const customerChunk = chunks.find(
      (chunk) =>
        chunk.locator.kind === 'spreadsheet' &&
        chunk.locator.sheetName === '顧客一覧'
    );
    const departmentChunk = chunks.find(
      (chunk) =>
        chunk.locator.kind === 'spreadsheet' &&
        chunk.locator.sheetName === '部署集計'
    );

    expect(customerChunk).toBeDefined();
    expect(departmentChunk).toBeDefined();

    if (!customerChunk || !departmentChunk) {
      return;
    }

    expect(customerChunk.sensitivity).toBe('Confidential');
    expect(customerChunk.aiUsePolicy).toBe('requires_masking');
    expect(customerChunk.sensitivitySource).toBe('columnRule');

    expect(departmentChunk.sensitivity).toBe('Internal');
    expect(departmentChunk.aiUsePolicy).toBe('direct');
    expect(departmentChunk.sensitivitySource).toBe('inherited');
  });

  it('keeps chunk count within practical limits for typical multi-sheet inputs', () => {
    const { chunks } = extractXlsx({
      ...baseInput,
      content: createWorkbookBuffer(12),
    });

    expect(chunks.length).toBeLessThanOrEqual(50);
  });
});

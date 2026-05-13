import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { extractXlsx } from '../xlsxExtractor';

const baseInput = {
  docId: 'doc-xlsx-1',
  fileName: 'sample.xlsx',
  documentSensitivity: 'Internal' as const,
  documentAiUsePolicy: 'direct' as const,
};

async function createWorkbookBuffer(sheetCount = 2): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  workbook.addWorksheet('顧客一覧').addRows([
    ['顧客名', '数量'],
    ['Acme', 10],
  ]);

  if (sheetCount >= 2) {
    workbook.addWorksheet('部署集計').addRows([
      ['部署', '人数'],
      ['営業', 3],
    ]);
  }

  for (let i = 2; i < sheetCount; i += 1) {
    workbook.addWorksheet(`Sheet${i + 1}`).addRows([
      ['列1', '列2'],
      [`row-${i}`, `${i}`],
    ]);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('extractXlsx', () => {
  it('extracts chunks by sheet used range and sets spreadsheet locator', async () => {
    const content = await createWorkbookBuffer();
    const { chunks, normalizedMarkdown } = await extractXlsx({
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

  it('applies column header sensitivity rules for each chunk independently', async () => {
    const { chunks } = await extractXlsx({
      ...baseInput,
      content: await createWorkbookBuffer(),
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

  it('keeps chunk count within practical limits for typical multi-sheet inputs', async () => {
    const { chunks } = await extractXlsx({
      ...baseInput,
      content: await createWorkbookBuffer(12),
    });

    expect(chunks.length).toBeLessThanOrEqual(50);
  });
});

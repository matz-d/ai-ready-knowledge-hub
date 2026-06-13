import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildXlsxCuratorInput, extractXlsx } from '../xlsxExtractor';

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

async function createLargeSheetWorkbookBuffer(rowCount: number): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('明細');
  sheet.addRow(['顧客名', '数量']);
  for (let i = 0; i < rowCount; i += 1) {
    sheet.addRow([`Acme ${i}`, i]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function createWideLowRowWorkbookBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('横長明細');
  sheet.addRow(['顧客名', '長文メモ']);
  sheet.addRow(['Acme', 'a'.repeat(100_001)]);
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

  it('splits a large sheet into a summary chunk and row-window chunks', async () => {
    const { chunks, preflightReport } = await extractXlsx({
      ...baseInput,
      content: await createLargeSheetWorkbookBuffer(1001),
    });

    expect(chunks).toHaveLength(4);
    expect(preflightReport).toMatchObject({
      fileType: 'xlsx',
      sheetCount: 1,
      rowCount: 1002,
      columnCount: 2,
      maxSheetRows: 1002,
      recommendedSplitUnit: 'row_group',
      suggestedRowGroupSize: 500,
    });
    expect(preflightReport.reasons).toContain('maxSheetRows>1000');
    expect(chunks[0].extractionWarnings).toContainEqual(
      expect.stringContaining('preflight: fileType=xlsx')
    );
    expect(chunks.map((chunk) => chunk.locator)).toEqual([
      { kind: 'spreadsheet', sheetName: '明細', range: 'A1:B1002' },
      { kind: 'spreadsheet', sheetName: '明細', range: 'A2:B501' },
      { kind: 'spreadsheet', sheetName: '明細', range: 'A502:B1001' },
      { kind: 'spreadsheet', sheetName: '明細', range: 'A1002:B1002' },
    ]);
    expect(chunks[1].text).toContain('## 明細 rows 2-501');
    expect(chunks[1].text).toContain('| 顧客名 | 数量 |');
    expect(chunks[1].extractionWarnings).toContain('rowWindow=2-501');
  });

  it('splits a low-row sheet when preflight recommends row groups from estimated chars', async () => {
    const { chunks, preflightReport } = await extractXlsx({
      ...baseInput,
      content: await createWideLowRowWorkbookBuffer(),
    });

    expect(preflightReport).toMatchObject({
      fileType: 'xlsx',
      rowCount: 2,
      maxSheetRows: 2,
      recommendedSplitUnit: 'row_group',
      suggestedRowGroupSize: 500,
    });
    expect(preflightReport.reasons).toContain('estimatedChars>100000');
    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.locator)).toEqual([
      { kind: 'spreadsheet', sheetName: '横長明細', range: 'A1:B2' },
      { kind: 'spreadsheet', sheetName: '横長明細', range: 'A2:B2' },
    ]);
    expect(chunks[1].extractionWarnings).toContain('rowWindow=2-2');
  });

  it('builds a bounded table manifest for large XLSX Curator input', async () => {
    const result = await buildXlsxCuratorInput({
      fileName: 'sales.xlsx',
      content: await createLargeSheetWorkbookBuffer(1001),
    });

    expect(result.inputMode).toBe('table_manifest');
    expect(result.content).toContain('Table preflight manifest');
    expect(result.content).toContain('Recommended split unit: row_group');
    expect(result.content).toContain('### 明細');
    expect(result.content).toContain('| 顧客名 | 数量 |');
    expect(result.content).toContain('| Acme 3 | 3 |');
    expect(result.content).not.toContain('Acme 1000');
  });
});

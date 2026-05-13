import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { xlsxToMarkdownSheets } from '../xlsxExtractor';

const DRIVE_EXPORT_FIXTURE_PATH = resolve(
  process.cwd(),
  'tests/fixtures/google-sheets/sample-drive-export.xlsx'
);

async function createUserUploadWorkbookBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  workbook.addWorksheet('SimpleTable').addRows([
    ['Item', 'Qty', 'UnitPrice'],
    ['Acme', 3, 1200],
    ['Globex', 1, 980],
    ['Initech', 5, 450],
    ['Umbrella', 2, 800],
    ['Soylent', 4, 650],
  ]);

  const dateCells = workbook.addWorksheet('DateCells');
  dateCells.addRows([
    ['Label', 'Date', 'Note'],
    ['Start', null, 'project start'],
    ['Checkpoint', null, 'review'],
    ['Launch', null, 'go live'],
    ['LegacySerial', null, 'raw serial'],
    ['Leap', null, 'leap day'],
  ]);

  dateCells.getCell('B2').value = new Date('2025-01-15T00:00:00Z');
  dateCells.getCell('B3').value = new Date('2025-02-01T00:00:00Z');
  dateCells.getCell('B4').value = new Date('2025-03-20T00:00:00Z');
  dateCells.getCell('B5').value = new Date('2025-01-21T00:00:00Z');
  dateCells.getCell('B6').value = new Date('2024-02-29T00:00:00Z');
  for (const cellAddress of ['B2', 'B3', 'B4', 'B5', 'B6']) {
    dateCells.getCell(cellAddress).numFmt = 'yyyy-mm-dd';
  }

  const formulaMerged = workbook.addWorksheet('FormulaMerged');
  formulaMerged.addRows([
    ['Metric', 'Value', 'Comment'],
    ['North', 10, ''],
    ['South', 20, ''],
    ['West', 15, ''],
    ['Total', null, 'auto calc'],
    ['Merged block', '', ''],
    ['Tail', 7, 'post merge'],
  ]);
  formulaMerged.getCell('B5').value = {
    formula: 'SUM(B2:B4)',
    result: 45,
  };
  formulaMerged.mergeCells('A6:C6');

  workbook.addWorksheet('EmptySheet');

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function pickSheet(
  sheets: Awaited<ReturnType<typeof xlsxToMarkdownSheets>>,
  sheetName: string
) {
  const sheet = sheets.find((item) => item.sheetName === sheetName);
  if (!sheet) {
    throw new Error(`sheet not found: ${sheetName}`);
  }
  return {
    sheetName: sheet.sheetName,
    range: sheet.range,
    markdownTable: sheet.markdownTable,
  };
}

describe('xlsxToMarkdownSheets (Drive export fixture)', () => {
  it('recognizes all sheets in the Drive export workbook', async () => {
    const driveExportBuffer = readFileSync(DRIVE_EXPORT_FIXTURE_PATH);

    const sheets = await xlsxToMarkdownSheets(driveExportBuffer);

    expect(sheets.map((sheet) => sheet.sheetName)).toEqual([
      'SimpleTable',
      'DateCells',
      'FormulaMerged',
      'EmptySheet',
    ]);
  });

  it('renders date/formula/merged cells equivalently to user-upload xlsx', async () => {
    const driveExportSheets = await xlsxToMarkdownSheets(
      readFileSync(DRIVE_EXPORT_FIXTURE_PATH)
    );
    const userUploadSheets = await xlsxToMarkdownSheets(
      await createUserUploadWorkbookBuffer()
    );

    const driveSpecialSheets = {
      dateCells: pickSheet(driveExportSheets, 'DateCells'),
      formulaMerged: pickSheet(driveExportSheets, 'FormulaMerged'),
      emptySheet: pickSheet(driveExportSheets, 'EmptySheet'),
    };
    const userUploadSpecialSheets = {
      dateCells: pickSheet(userUploadSheets, 'DateCells'),
      formulaMerged: pickSheet(userUploadSheets, 'FormulaMerged'),
      emptySheet: pickSheet(userUploadSheets, 'EmptySheet'),
    };

    expect(driveSpecialSheets).toEqual(userUploadSpecialSheets);
    expect(driveSpecialSheets).toMatchSnapshot();
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { xlsxToMarkdownSheets } from '../xlsxExtractor';

const DRIVE_EXPORT_FIXTURE_PATH = resolve(
  process.cwd(),
  'tests/fixtures/google-sheets/sample-drive-export.xlsx'
);

function excelSerialFromIsoDate(isoDate: string): number {
  const excelEpoch = Date.UTC(1899, 11, 30);
  const target = Date.parse(`${isoDate}T00:00:00Z`);
  return Math.floor((target - excelEpoch) / 86_400_000);
}

function createUserUploadWorkbookBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();

  const simpleTable = XLSX.utils.aoa_to_sheet([
    ['Item', 'Qty', 'UnitPrice'],
    ['Acme', 3, 1200],
    ['Globex', 1, 980],
    ['Initech', 5, 450],
    ['Umbrella', 2, 800],
    ['Soylent', 4, 650],
  ]);
  XLSX.utils.book_append_sheet(workbook, simpleTable, 'SimpleTable');

  const dateCells = XLSX.utils.aoa_to_sheet([
    ['Label', 'Date', 'Note'],
    ['Start', null, 'project start'],
    ['Checkpoint', null, 'review'],
    ['Launch', null, 'go live'],
    ['LegacySerial', null, 'raw serial'],
    ['Leap', null, 'leap day'],
  ]);

  dateCells.B2 = {
    t: 'n',
    v: excelSerialFromIsoDate('2025-01-15'),
    z: 'yyyy-mm-dd',
  };
  dateCells.B3 = {
    t: 'n',
    v: excelSerialFromIsoDate('2025-02-01'),
    z: 'yyyy-mm-dd',
  };
  dateCells.B4 = {
    t: 'n',
    v: excelSerialFromIsoDate('2025-03-20'),
    z: 'yyyy-mm-dd',
  };
  dateCells.B5 = {
    t: 'n',
    v: 45678,
    z: 'yyyy-mm-dd',
  };
  dateCells.B6 = {
    t: 'n',
    v: excelSerialFromIsoDate('2024-02-29'),
    z: 'yyyy-mm-dd',
  };

  XLSX.utils.book_append_sheet(workbook, dateCells, 'DateCells');

  const formulaMerged = XLSX.utils.aoa_to_sheet([
    ['Metric', 'Value', 'Comment'],
    ['North', 10, ''],
    ['South', 20, ''],
    ['West', 15, ''],
    ['Total', null, 'auto calc'],
    ['Merged block', '', ''],
    ['Tail', 7, 'post merge'],
  ]);
  formulaMerged.B5 = {
    t: 'n',
    f: 'SUM(B2:B4)',
    v: 45,
  };
  formulaMerged['!merges'] = [XLSX.utils.decode_range('A6:C6')];
  XLSX.utils.book_append_sheet(workbook, formulaMerged, 'FormulaMerged');

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), 'EmptySheet');

  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;
}

function pickSheet(
  sheets: ReturnType<typeof xlsxToMarkdownSheets>,
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
  it('recognizes all sheets in the Drive export workbook', () => {
    const driveExportBuffer = readFileSync(DRIVE_EXPORT_FIXTURE_PATH);

    const sheets = xlsxToMarkdownSheets(driveExportBuffer);

    expect(sheets.map((sheet) => sheet.sheetName)).toEqual([
      'SimpleTable',
      'DateCells',
      'FormulaMerged',
      'EmptySheet',
    ]);
  });

  it('renders date/formula/merged cells equivalently to user-upload xlsx', () => {
    const driveExportSheets = xlsxToMarkdownSheets(
      readFileSync(DRIVE_EXPORT_FIXTURE_PATH)
    );
    const userUploadSheets = xlsxToMarkdownSheets(createUserUploadWorkbookBuffer());

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

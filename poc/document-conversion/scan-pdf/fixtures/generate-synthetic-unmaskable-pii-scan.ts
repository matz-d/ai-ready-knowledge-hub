#!/usr/bin/env tsx
// Generates a deterministic low-quality synthetic fax copy for the W5b
// unmaskable PII live-smoke path. All PII-like strings are invented fixtures.
import { once } from 'node:events';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../../..');
const outputPath = path.join(
  repoRoot,
  'sample-data/document-conversion/scan-pdf/synthetic-unmaskable-pii-scan.pdf'
);

function pickFont(): string {
  const candidates = [
    process.env.SYNTHETIC_UNMASKABLE_SCAN_FONT_PATH,
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ].filter((candidate): candidate is string => Boolean(candidate));

  const fontPath = candidates.find((candidate) => existsSync(candidate));
  if (!fontPath) {
    throw new Error(
      'No fixture font found. Set SYNTHETIC_UNMASKABLE_SCAN_FONT_PATH.'
    );
  }
  return fontPath;
}

function drawDamagedField(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  y: number,
  damageX: number,
  damageWidth: number
): void {
  doc
    .fillColor('#111827')
    .fontSize(12)
    .text(label, 54, y, { width: 126 })
    .fontSize(18)
    .text(value, 184, y - 4, { width: 340 });

  doc
    .save()
    .fillColor('#ffffff')
    .rect(damageX, y - 5, damageWidth, 31)
    .fill()
    .fillColor('#d1d5db')
    .rect(damageX + 4, y - 3, Math.max(damageWidth - 8, 8), 27)
    .fillOpacity(0.65)
    .fill()
    .restore();
}

async function writeSourcePdf(sourcePath: string): Promise<void> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 46,
    info: {
      Title: 'Synthetic damaged PII scan fixture',
      Author: 'AI-Ready Knowledge Hub',
      Subject: 'Deterministic W5b unmaskable PII scan source',
    },
  });
  const stream = createWriteStream(sourcePath);
  doc.pipe(stream);
  doc.font(pickFont());

  doc
    .fillColor('#111827')
    .fontSize(24)
    .text('Synthetic damaged fax intake', 54, 54)
    .fillColor('#9b1c1c')
    .fontSize(10)
    .text('EVALUATION ONLY. ALL PII-LIKE FIELDS BELOW ARE SYNTHETIC.', 54, 92)
    .fillColor('#374151')
    .fontSize(10)
    .text(
      'Fax copy quality note: a fold damaged the contact fields. Compare the source page before retyping any partial contact value.',
      54,
      116,
      { width: 480 }
    );

  doc
    .save()
    .strokeColor('#6b7280')
    .lineWidth(1)
    .rect(48, 166, 499, 284)
    .stroke()
    .restore();

  drawDamagedField(doc, 'Employee name', 'XXXX Taro', 199, 192, 160);
  drawDamagedField(doc, 'Phone', '090-1234-5678', 254, 200, 194);
  drawDamagedField(doc, 'Address', '1-2-3 XXXX-cho, Shibuya-ku', 309, 190, 268);
  drawDamagedField(doc, 'My Number-like', '1234-5678-9012', 364, 198, 198);

  doc
    .save()
    .strokeColor('#111827')
    .lineWidth(12)
    .opacity(0.22)
    .moveTo(118, 181)
    .lineTo(486, 431)
    .stroke()
    .restore();

  doc
    .fillColor('#374151')
    .fontSize(10)
    .text('Visible fragments came from synthetic values only:', 54, 487)
    .fontSize(9)
    .text(
      'Name, phone, address, and My Number-like rows are clipped by fold bands and fax noise.',
      54,
      506,
      { width: 480 }
    )
    .text(
      'No customer record, employee record, credential, or real export was used.',
      54,
      530,
      { width: 480 }
    );

  doc.end();
  await once(stream, 'finish');
}

async function rasterizeDamagedScan(
  sourcePath: string,
  targetPath: string
): Promise<void> {
  await execFileAsync('magick', [
    '-density',
    '62',
    sourcePath,
    '-units',
    'PixelsPerInch',
    '-density',
    '62',
    '-background',
    'white',
    '-alpha',
    'remove',
    '-alpha',
    'off',
    '-colorspace',
    'Gray',
    '-filter',
    'point',
    '-resize',
    '58%',
    '-filter',
    'triangle',
    '-resize',
    '172%',
    '-blur',
    '0x1.7',
    '-seed',
    '35063',
    '-evaluate',
    'Gaussian-noise',
    '1.15',
    '-brightness-contrast',
    '-4x-18',
    '-rotate',
    '-1.2',
    targetPath,
  ]);
}

async function main(): Promise<void> {
  const workDir = await mkdtemp(
    path.join(tmpdir(), 'ai-ready-unmaskable-scan-')
  );
  const sourcePath = path.join(workDir, 'synthetic-unmaskable-pii-source.pdf');

  try {
    await writeSourcePdf(sourcePath);
    await rasterizeDamagedScan(sourcePath, outputPath);
    console.log(`Generated W5b synthetic unmaskable scan fixture: ${outputPath}`);
  } finally {
    await rm(workDir, { force: true, recursive: true });
  }
}

await main();

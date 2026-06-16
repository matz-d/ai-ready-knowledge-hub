#!/usr/bin/env tsx
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../../..');
const outputDir = path.join(
  repoRoot,
  'sample-data/document-conversion/official-doc-pdf'
);
const outputPath = path.join(
  outputDir,
  'synthetic-official-doc-table-assist-golden.pdf'
);

async function main(): Promise<void> {
  await mkdir(outputDir, { recursive: true });

  const doc = new PDFDocument({
    size: 'A4',
    margin: 54,
    info: {
      Title: 'Synthetic Official Document Table Assist Golden',
      Author: 'AI-Ready Knowledge Hub',
      Subject: 'PII-free table-assist evaluation fixture',
    },
  });
  const stream = createWriteStream(outputPath);
  doc.pipe(stream);

  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .text('Work Policy Summary', { align: 'left' });

  doc
    .moveDown(0.8)
    .font('Helvetica')
    .fontSize(10)
    .text(
      'Synthetic PII-free fixture. The aligned rows below are intended to be readable as text while requiring table-assist extraction to preserve row-level table structure.',
      { width: 480 }
    );

  doc.moveDown(1.4).font('Courier-Bold').fontSize(10);
  doc.text('Item                         Limit        Review cadence');
  doc.moveDown(0.35).font('Courier').fontSize(10);
  doc.text('Monthly overtime cap         45 hours     Manager review');
  doc.text('Annual overtime cap          360 hours    HR review');
  doc.text('Remote work allowance        12000 yen    Monthly payroll');

  doc
    .moveDown(1.4)
    .font('Helvetica')
    .fontSize(10)
    .text(
      'The values are synthetic and contain no customer data, credentials, personal names, contact details, or identifiers.'
    );

  doc.end();
  await once(stream, 'finish');
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

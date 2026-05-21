#!/usr/bin/env tsx
// Generates the synthetic PII invoice PDF that is printed before the scan-pdf
// fixture is created by a human scan workflow.
import { createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import PDFDocument from 'pdfkit';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(scriptDir, 'synthetic-invoice-with-pii.pdf');
const syntheticMyNumberLikeValue = '123456789012';

const invoiceItems = [
  { description: '月次顧問契約料（2026年5月分）', amount: 385_000 },
  { description: '決算書類作成・申告準備', amount: 440_000 },
  { description: '年末調整資料レビュー', amount: 125_000 },
  { description: '給与支払報告書整理支援', amount: 80_000 },
] as const;

function pickJapaneseFont(): string {
  const candidates = [
    process.env.SYNTHETIC_INVOICE_FONT_PATH,
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    '/Library/Fonts/Arial Unicode.ttf',
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansJP-Regular.ttf',
  ].filter((candidate): candidate is string => Boolean(candidate));

  const fontPath = candidates.find((candidate) => existsSync(candidate));
  if (!fontPath) {
    throw new Error(
      'No Japanese-capable font found. Set SYNTHETIC_INVOICE_FONT_PATH.'
    );
  }
  return fontPath;
}

function formatYen(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`;
}

function myNumberCheckDigit(firstElevenDigits: string): number {
  if (!/^\d{11}$/.test(firstElevenDigits)) {
    throw new Error('My Number check digit input must be 11 digits.');
  }

  const weightedRemainder =
    firstElevenDigits
      .split('')
      .reverse()
      .reduce((sum, digit, index) => {
        const position = index + 1;
        const weight = position <= 6 ? position + 1 : position - 5;
        return sum + Number(digit) * weight;
      }, 0) % 11;
  const candidate = 11 - weightedRemainder;
  return candidate >= 10 ? 0 : candidate;
}

function assertInvalidMyNumberLikeValue(value: string): void {
  if (!/^\d{12}$/.test(value)) {
    throw new Error('Synthetic My Number-like value must be 12 digits.');
  }

  const checkDigit = myNumberCheckDigit(value.slice(0, 11));
  if (Number(value[11]) === checkDigit) {
    throw new Error(
      'Synthetic My Number-like value unexpectedly has a valid check digit.'
    );
  }
}

function drawRule(doc: PDFKit.PDFDocument, y: number): void {
  doc
    .save()
    .strokeColor('#4a5568')
    .lineWidth(0.7)
    .moveTo(46, y)
    .lineTo(549, y)
    .stroke()
    .restore();
}

function drawLabelValue(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  x: number,
  y: number,
  valueWidth = 230
): void {
  doc
    .fillColor('#374151')
    .fontSize(9)
    .text(label, x, y, { width: 88 })
    .fillColor('#111827')
    .fontSize(10)
    .text(value, x + 88, y - 1, { width: valueWidth });
}

function drawItemTable(
  doc: PDFKit.PDFDocument,
  startY: number,
  subtotal: number
): number {
  const left = 46;
  const tableWidth = 503;
  const descriptionWidth = 365;
  const rowHeight = 31;
  const tax = Math.round(subtotal * 0.1);
  const total = subtotal + tax;

  doc
    .save()
    .fillColor('#e5e7eb')
    .rect(left, startY, tableWidth, rowHeight)
    .fill()
    .restore();
  doc
    .strokeColor('#6b7280')
    .lineWidth(0.7)
    .rect(left, startY, tableWidth, rowHeight * (invoiceItems.length + 1))
    .stroke()
    .moveTo(left + descriptionWidth, startY)
    .lineTo(left + descriptionWidth, startY + rowHeight * (invoiceItems.length + 1))
    .stroke();

  for (let row = 1; row <= invoiceItems.length; row += 1) {
    const y = startY + rowHeight * row;
    doc.moveTo(left, y).lineTo(left + tableWidth, y).stroke();
  }

  doc
    .fillColor('#111827')
    .fontSize(10)
    .text('請求項目', left + 12, startY + 9, { width: descriptionWidth - 24 })
    .text('金額', left + descriptionWidth + 12, startY + 9, {
      width: tableWidth - descriptionWidth - 24,
      align: 'right',
    });

  invoiceItems.forEach((item, index) => {
    const y = startY + rowHeight * (index + 1) + 9;
    doc
      .text(item.description, left + 12, y, { width: descriptionWidth - 24 })
      .text(formatYen(item.amount), left + descriptionWidth + 12, y, {
        width: tableWidth - descriptionWidth - 24,
        align: 'right',
      });
  });

  const summaryY = startY + rowHeight * (invoiceItems.length + 1) + 18;
  drawLabelValue(doc, '小計', formatYen(subtotal), 339, summaryY, 122);
  drawLabelValue(doc, '消費税 10%', formatYen(tax), 339, summaryY + 22, 122);
  doc
    .save()
    .fillColor('#111827')
    .fontSize(13)
    .text('請求合計', 339, summaryY + 52, { width: 88 })
    .fontSize(16)
    .text(formatYen(total), 427, summaryY + 48, {
      width: 122,
      align: 'right',
    })
    .restore();

  return summaryY + 94;
}

async function generateInvoice(): Promise<void> {
  assertInvalidMyNumberLikeValue(syntheticMyNumberLikeValue);

  const doc = new PDFDocument({
    size: 'A4',
    margin: 46,
    info: {
      Title: 'Synthetic invoice with PII-like fields',
      Author: 'AI-Ready Knowledge Hub',
      Subject: 'Print source for a synthetic scan-pdf fixture',
    },
  });
  const stream = createWriteStream(outputPath);
  doc.pipe(stream);
  doc.font(pickJapaneseFont());

  const subtotal = invoiceItems.reduce((sum, item) => sum + item.amount, 0);

  doc
    .fillColor('#111827')
    .fontSize(25)
    .text('請 求 書', 46, 48)
    .fontSize(9)
    .fillColor('#9b1c1c')
    .text('SYNTHETIC FIXTURE / EVALUATION ONLY / NO REAL CUSTOMER DATA', 46, 85);
  doc
    .fillColor('#374151')
    .fontSize(10)
    .text('請求番号: SYN-INV-2026-0501', 378, 54, { width: 171 })
    .text('発行日: 2026年5月21日', 378, 72, { width: 171 });
  drawRule(doc, 109);

  doc
    .fillColor('#111827')
    .fontSize(14)
    .text('株式会社サンプル製作所 御中', 46, 130)
    .fontSize(10)
    .text('経理担当: 青柳 試花', 46, 159)
    .text('住所: 東京都千代田区サンプル町1-2-3 サンプルビル4F', 46, 177, {
      width: 286,
    })
    .text('電話: 03-XXXX-XXXX', 46, 207);

  doc
    .save()
    .fillColor('#f3f4f6')
    .roundedRect(354, 122, 195, 118, 4)
    .fill()
    .restore();
  doc
    .fillColor('#111827')
    .fontSize(12)
    .text('合成税理士法人', 370, 139)
    .fontSize(10)
    .text('担当税理士: 橘 試司', 370, 164)
    .text('東京都千代田区サンプル町9-8-7', 370, 184, { width: 160 })
    .text('合成会計タワー6F', 370, 201)
    .text('電話: 0120-XXX-XXXX', 370, 219);

  doc
    .fillColor('#111827')
    .fontSize(11)
    .text('下記のとおりご請求申し上げます。', 46, 262);
  const nextY = drawItemTable(doc, 290, subtotal);

  drawRule(doc, nextY);
  doc
    .fillColor('#111827')
    .fontSize(11)
    .text('振込先', 46, nextY + 18)
    .fontSize(10)
    .text('合成銀行 サンプル町支店　普通　7654321', 46, nextY + 41, {
      width: 278,
    })
    .text('口座名義: ゴウセイゼイリシホウジン', 46, nextY + 60, {
      width: 278,
    });

  doc
    .save()
    .fillColor('#fff7ed')
    .roundedRect(340, nextY + 14, 209, 72, 4)
    .fill()
    .restore();
  doc
    .fillColor('#111827')
    .fontSize(10)
    .text('確認用マイナンバー風値', 354, nextY + 30)
    .fontSize(13)
    .text(syntheticMyNumberLikeValue, 354, nextY + 50)
    .fontSize(8)
    .fillColor('#9b1c1c')
    .text('12桁 / チェックデジット不適合の合成値', 354, nextY + 70, {
      width: 170,
    });

  doc
    .fillColor('#374151')
    .fontSize(8)
    .text(
      'この PDF は scan-pdf 評価用に生成した印刷元です。氏名、住所、電話、口座、番号値はすべて合成です。',
      46,
      776,
      { width: 503 }
    );

  doc.end();
  await once(stream, 'finish');
  console.log(`Wrote ${outputPath}`);
}

await generateInvoice();

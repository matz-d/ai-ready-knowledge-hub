import { describe, expect, it } from 'vitest';
import {
  buildPdfParagraphId,
  documentIrBlockToStructureType,
  documentIrToKnowledgeChunks,
} from '../documentIrToKnowledgeChunk';
import type {
  DocumentIr,
  DocumentIrBlock,
  DocumentSourceSubtype,
} from '../documentIr';
import {
  computeChunkSourceHash,
  estimateKnowledgeChunkFirestoreBytes,
  KnowledgeChunkSchema,
  MAX_FIRESTORE_CHUNK_DOCUMENT_BYTES,
  validateKnowledgeChunkInvariants,
  type KnowledgeChunk,
} from '../../../lib/knowledgeChunkSchema';

const EXTRACTOR_INPUT = 'doc-bytes-fixture';
const DOC_ID = 'doc-3h-1';
const FIXED_NOW = (): Date => new Date('2026-05-19T00:00:00.000Z');

function paragraphBlock(
  id: string,
  text: string,
  overrides: Partial<DocumentIrBlock> = {}
): DocumentIrBlock {
  return {
    blockId: id,
    kind: 'paragraph',
    text,
    locator: { pageNumber: 1 },
    ...overrides,
  };
}

function buildIr(
  blocks: DocumentIrBlock[],
  subtype: DocumentSourceSubtype = 'official-doc-pdf'
): DocumentIr {
  return {
    schemaVersion: 1,
    source: {
      fileName: 'sample.pdf',
      mediaType: 'application/pdf',
      sourceKind: 'poc',
      sourceSubtype: subtype,
    },
    pages: [{ pageNumber: 1, blocks }],
  };
}

function defaultOptions() {
  return {
    docId: DOC_ID,
    extractorInput: EXTRACTOR_INPUT,
    documentSensitivity: 'Internal' as const,
    documentAiUsePolicy: 'direct' as const,
    now: FIXED_NOW,
  };
}

const parentDocument = { id: DOC_ID, status: 'curated' as const };

describe('documentIrBlockToStructureType', () => {
  it('maps every block kind per §5 lossy table', () => {
    expect(documentIrBlockToStructureType('paragraph')).toBe('paragraph');
    expect(documentIrBlockToStructureType('heading')).toBe('paragraph');
    expect(documentIrBlockToStructureType('table')).toBe('table');
    expect(documentIrBlockToStructureType('image_text')).toBe('imageText');
    expect(documentIrBlockToStructureType('note')).toBeNull();
  });
});

describe('buildPdfParagraphId', () => {
  it('synthesises table-{i}-row-{j} when both indices are present', () => {
    const block: DocumentIrBlock = {
      blockId: 'p1-t0-r3',
      kind: 'table',
      text: 'A\tB',
      locator: { pageNumber: 1, tableIndex: 0, rowIndex: 3 },
    };
    expect(buildPdfParagraphId(block)).toBe('table-0-row-3');
  });

  it('falls back to blockId otherwise', () => {
    const block = paragraphBlock('p1-b7', 'body');
    expect(buildPdfParagraphId(block)).toBe('p1-b7');
  });
});

describe('documentIrToKnowledgeChunks', () => {
  it('produces a single paragraph chunk for a simple official-doc-pdf IR', () => {
    const ir = buildIr([paragraphBlock('p1-b1', 'hello world')]);
    const chunks = documentIrToKnowledgeChunks({
      ...defaultOptions(),
      documentIr: ir,
    });

    expect(chunks).toHaveLength(1);
    const [chunk] = chunks;
    expect(chunk.structureType).toBe('paragraph');
    expect(chunk.sourceType).toBe('pdf');
    expect(chunk.extractionProvider).toBe('pdf');
    expect(chunk.locator).toEqual({
      kind: 'pdf',
      page: 1,
      paragraphId: 'p1-b1',
    });
    // Round-trips through the canonical schema.
    expect(KnowledgeChunkSchema.parse(chunk)).toEqual(chunk);
  });

  it('demotes heading to paragraph and records headingLevel in extractionWarnings', () => {
    const ir = buildIr([
      {
        blockId: 'p1-h1',
        kind: 'heading',
        text: '第1章 総則',
        locator: { pageNumber: 1 },
        metadata: { headingLevel: 2 },
      },
    ]);
    const [chunk] = documentIrToKnowledgeChunks({
      ...defaultOptions(),
      documentIr: ir,
    });

    expect(chunk.structureType).toBe('paragraph');
    expect(chunk.extractionWarnings ?? []).toEqual(
      expect.arrayContaining([expect.stringContaining('headingLevel=2')])
    );
  });

  it('synthesises pdf paragraphId from tableIndex/rowIndex on table blocks', () => {
    const ir = buildIr([
      {
        blockId: 'p1-t0-r0',
        kind: 'table',
        text: 'Header A\tHeader B',
        locator: { pageNumber: 1, tableIndex: 0, rowIndex: 0 },
      },
      {
        blockId: 'p1-t0-r1',
        kind: 'table',
        text: 'cell-a\tcell-b',
        locator: { pageNumber: 1, tableIndex: 0, rowIndex: 1 },
      },
    ]);
    const chunks = documentIrToKnowledgeChunks({
      ...defaultOptions(),
      documentIr: ir,
    });

    expect(chunks.map((c) => c.locator)).toEqual([
      { kind: 'pdf', page: 1, paragraphId: 'table-0-row-0' },
      { kind: 'pdf', page: 1, paragraphId: 'table-0-row-1' },
    ]);
    expect(chunks.every((c) => c.structureType === 'table')).toBe(true);
  });

  it('maps image_text to imageText with structured page/bbox locator evidence', () => {
    const ir = buildIr(
      [
        {
          blockId: 'p1-img1',
          kind: 'image_text',
          text: 'OCR snippet',
          locator: {
            pageNumber: 1,
            bbox: [10, 20, 110, 60],
          },
        },
      ],
      'scan-pdf'
    );
    const [chunk] = documentIrToKnowledgeChunks({
      ...defaultOptions(),
      documentIr: ir,
    });

    expect(chunk.structureType).toBe('imageText');
    expect(chunk.locator).toEqual({
      kind: 'imageText',
      page: 1,
      bbox: [10, 20, 110, 60],
    });
    expect(chunk.extractionWarnings ?? []).toEqual(
      expect.arrayContaining([
        expect.stringContaining('imageTextLocator=page=1 bbox=[10,20,110,60]'),
      ])
    );
  });

  it('duplicates adjacent scan-pdf form values onto the label chunk', () => {
    const ir = buildIr(
      [
        {
          blockId: 'p1-ocr3',
          kind: 'paragraph',
          text: 'Employee name',
          locator: { pageNumber: 1, bbox: [218, 160, 340, 175] },
        },
        {
          blockId: 'p1-ocr4',
          kind: 'image_text',
          text: 'XXXX Taro',
          locator: { pageNumber: 1, bbox: [385, 155, 500, 180] },
        },
      ],
      'scan-pdf'
    );

    const chunks = documentIrToKnowledgeChunks({
      ...defaultOptions(),
      documentIr: ir,
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toBe('Employee name\nXXXX Taro');
    expect(chunks[0].structureType).toBe('paragraph');
    expect(chunks[0].locator).toEqual({
      kind: 'pdf',
      page: 1,
      paragraphId: 'p1-ocr3',
    });
    expect(chunks[0].extractionWarnings ?? []).toEqual(
      expect.arrayContaining([
        expect.stringContaining('scanLabelValueLink=p1-ocr4'),
      ])
    );
    expect(chunks[1].text).toBe('XXXX Taro');
    expect(chunks[1].structureType).toBe('imageText');
  });

  it('does not duplicate adjacent values for official PDF chunks', () => {
    const ir = buildIr([
      paragraphBlock('p1-b1', 'Employee name', {
        locator: { pageNumber: 1, bbox: [218, 160, 340, 175] },
      }),
      paragraphBlock('p1-b2', 'XXXX Taro', {
        locator: { pageNumber: 1, bbox: [385, 155, 500, 180] },
      }),
    ]);

    const chunks = documentIrToKnowledgeChunks({
      ...defaultOptions(),
      documentIr: ir,
    });

    expect(chunks.map((chunk) => chunk.text)).toEqual([
      'Employee name',
      'XXXX Taro',
    ]);
  });

  it('synthesizes scan-pdf visual image text rows into table chunks', () => {
    const ir = buildIr(
      [
        {
          blockId: 'p1-ocr15',
          kind: 'image_text',
          text: '請求項目',
          locator: { pageNumber: 1, bbox: [190, 340, 250, 353] },
        },
        {
          blockId: 'p1-ocr16',
          kind: 'image_text',
          text: '金額',
          locator: { pageNumber: 1, bbox: [730, 340, 770, 353] },
        },
        {
          blockId: 'p1-ocr17',
          kind: 'image_text',
          text: '月次顧問契約料 (2026年5月分)',
          locator: { pageNumber: 1, bbox: [190, 370, 400, 383] },
        },
        {
          blockId: 'p1-ocr18',
          kind: 'image_text',
          text: '¥385,000',
          locator: { pageNumber: 1, bbox: [710, 370, 770, 383] },
        },
      ],
      'scan-pdf'
    );

    const chunks = documentIrToKnowledgeChunks({
      ...defaultOptions(),
      documentIr: ir,
    });

    const tableChunks = chunks.filter(
      (chunk) => chunk.structureType === 'table'
    );
    expect(tableChunks).toHaveLength(1);
    expect(tableChunks[0].text).toBe(
      '請求項目\t金額\n月次顧問契約料 (2026年5月分)\t¥385,000'
    );
    expect(tableChunks[0].locator).toEqual({
      kind: 'pdf',
      page: 1,
      paragraphId: 'table-0-row-1',
    });
    expect(tableChunks[0].extractionWarnings ?? []).toEqual(
      expect.arrayContaining([
        expect.stringContaining('scanTableFallback=visual image_text rows'),
      ])
    );
  });

  it('synthesizes missing scan-pdf visual rows even when native table blocks exist on the page', () => {
    const ir = buildIr(
      [
        {
          blockId: 'p1-t0-r0',
          kind: 'table',
          text: '請求項目\t金額',
          locator: { pageNumber: 1, tableIndex: 0, rowIndex: 0 },
        },
        {
          blockId: 'p1-ocr15',
          kind: 'image_text',
          text: '請求項目',
          locator: { pageNumber: 1, bbox: [190, 340, 250, 353] },
        },
        {
          blockId: 'p1-ocr16',
          kind: 'image_text',
          text: '金額',
          locator: { pageNumber: 1, bbox: [730, 340, 770, 353] },
        },
        {
          blockId: 'p1-ocr17',
          kind: 'image_text',
          text: '月次顧問契約料 (2026年5月分)',
          locator: { pageNumber: 1, bbox: [190, 370, 400, 383] },
        },
        {
          blockId: 'p1-ocr18',
          kind: 'image_text',
          text: '¥385,000',
          locator: { pageNumber: 1, bbox: [710, 370, 770, 383] },
        },
      ],
      'scan-pdf'
    );

    const chunks = documentIrToKnowledgeChunks({
      ...defaultOptions(),
      documentIr: ir,
    });

    const tableChunks = chunks.filter((chunk) => chunk.structureType === 'table');
    expect(tableChunks).toHaveLength(2);
    expect(tableChunks[1].text).toBe(
      '請求項目\t金額\n月次顧問契約料 (2026年5月分)\t¥385,000'
    );
    expect(tableChunks[1].locator).toEqual({
      kind: 'pdf',
      page: 1,
      paragraphId: 'table-1-row-1',
    });
  });

  it('does not duplicate scan-pdf visual rows already emitted as native table blocks', () => {
    const ir = buildIr(
      [
        {
          blockId: 'p1-t0-r0',
          kind: 'table',
          text: '請求項目\t金額',
          locator: { pageNumber: 1, tableIndex: 0, rowIndex: 0 },
        },
        {
          blockId: 'p1-t0-r1',
          kind: 'table',
          text: '月次顧問契約料 (2026年5月分)\t¥385,000',
          locator: { pageNumber: 1, tableIndex: 0, rowIndex: 1 },
        },
        {
          blockId: 'p1-ocr15',
          kind: 'image_text',
          text: '請求項目',
          locator: { pageNumber: 1, bbox: [190, 340, 250, 353] },
        },
        {
          blockId: 'p1-ocr16',
          kind: 'image_text',
          text: '金額',
          locator: { pageNumber: 1, bbox: [730, 340, 770, 353] },
        },
        {
          blockId: 'p1-ocr17',
          kind: 'image_text',
          text: '月次顧問契約料 (2026年5月分)',
          locator: { pageNumber: 1, bbox: [190, 370, 400, 383] },
        },
        {
          blockId: 'p1-ocr18',
          kind: 'image_text',
          text: '¥385,000',
          locator: { pageNumber: 1, bbox: [710, 370, 770, 383] },
        },
      ],
      'scan-pdf'
    );

    const chunks = documentIrToKnowledgeChunks({
      ...defaultOptions(),
      documentIr: ir,
    });

    expect(chunks.filter((chunk) => chunk.structureType === 'table')).toHaveLength(2);
  });

  it('synthesizes scan-pdf inline blank unit form rows into table chunks', () => {
    const ir = buildIr(
      [
        {
          blockId: 'p1-ocr41',
          kind: 'paragraph',
          text: '2 休憩時間（ ）分',
          locator: { pageNumber: 1, bbox: [240, 809, 400, 821] },
        },
      ],
      'scan-pdf'
    );

    const chunks = documentIrToKnowledgeChunks({
      ...defaultOptions(),
      documentIr: ir,
    });

    const tableChunks = chunks.filter(
      (chunk) => chunk.structureType === 'table'
    );
    expect(tableChunks).toHaveLength(1);
    expect(tableChunks[0].text).toBe('休憩時間\t分\n2 休憩時間（ ）分');
    expect(tableChunks[0].locator).toEqual({
      kind: 'pdf',
      page: 1,
      paragraphId: 'table-0-row-1',
    });
    expect(tableChunks[0].extractionWarnings ?? []).toEqual(
      expect.arrayContaining([
        expect.stringContaining('scanInlineFormUnitFallback=inline blank unit'),
      ])
    );
  });

  it('supplements known public blank-form static labels without adding values', () => {
    const ir = buildIr(
      [
        {
          blockId: 'p1-ocr1',
          kind: 'heading',
          text: '令和 年分 給与所得の源泉徴収票',
          locator: { pageNumber: 1, bbox: [280, 15, 720, 45] },
        },
        {
          blockId: 'p1-ocr2',
          kind: 'table',
          text: '受給者番号 住所又は居所 氏名 個人番号 役職名',
          locator: { pageNumber: 1, bbox: [30, 45, 970, 150] },
        },
        {
          blockId: 'p1-ocr3',
          kind: 'table',
          text: '種別 支払金額 給与所得控除後の金額 所得控除の額の合計額 源泉徴収税額',
          locator: { pageNumber: 1, bbox: [30, 150, 970, 220] },
        },
        {
          blockId: 'p1-ocr7',
          kind: 'table',
          text: '生命保険料の控除の内訳 住宅借入金等特別控除の控除の内訳',
          locator: { pageNumber: 1, bbox: [30, 420, 970, 550] },
        },
        {
          blockId: 'p1-ocr10',
          kind: 'table',
          text: '支払者 住所(居所)又は所在地 氏名又は名称 個人番号又は法人番号',
          locator: { pageNumber: 1, bbox: [30, 930, 970, 990] },
        },
      ],
      'scan-pdf'
    );

    const chunks = documentIrToKnowledgeChunks({
      ...defaultOptions(),
      documentIr: ir,
    });

    const supplementalChunks = chunks.filter((chunk) =>
      chunk.id.includes('nta-withholding-template')
    );
    expect(supplementalChunks.map((chunk) => chunk.text)).toEqual([
      '支払を受ける者\t氏名\n支払を受ける者\t住所又は居所',
      '支払金額\t円\n給与所得控除後の金額\t円\n源泉徴収税額\t円',
      '生命保険料の金額の内訳\n住宅借入金等特別控除の額の内訳',
    ]);
    expect(
      supplementalChunks.every((chunk) => chunk.structureType === 'table')
    ).toBe(true);
    expect(supplementalChunks[1].extractionWarnings ?? []).toEqual(
      expect.arrayContaining([
        expect.stringContaining('scanKnownPublicFormTemplateFallback=known public form'),
      ])
    );
  });

  it('drops note blocks', () => {
    const ir = buildIr([
      paragraphBlock('p1-b1', 'kept'),
      {
        blockId: 'p1-n1',
        kind: 'note',
        text: 'speaker note',
        locator: { pageNumber: 1 },
      },
    ]);
    const chunks = documentIrToKnowledgeChunks({
      ...defaultOptions(),
      documentIr: ir,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('kept');
  });

  it('drops whitespace-only renderable blocks', () => {
    const ir = buildIr([
      paragraphBlock('p1-b1', 'kept'),
      paragraphBlock('p1-empty', '   \n\t  '),
      {
        blockId: 'p1-h1-empty',
        kind: 'heading',
        text: '  ',
        locator: { pageNumber: 1 },
      },
    ]);
    const chunks = documentIrToKnowledgeChunks({
      ...defaultOptions(),
      documentIr: ir,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].id).toBe(`${DOC_ID}:p1-b1`);
    expect(chunks[0].text).toBe('kept');
  });

  it('emits subtype-correct sourceType for every subtype', () => {
    const cases: Array<{
      subtype: DocumentSourceSubtype;
      sourceType: KnowledgeChunk['sourceType'];
      extractionProvider: KnowledgeChunk['extractionProvider'];
      locatorKind: KnowledgeChunk['locator']['kind'];
    }> = [
      {
        subtype: 'official-doc-pdf',
        sourceType: 'pdf',
        extractionProvider: 'pdf',
        locatorKind: 'pdf',
      },
      {
        subtype: 'scan-pdf',
        sourceType: 'pdf',
        extractionProvider: 'pdf',
        locatorKind: 'pdf',
      },
      {
        subtype: 'slide-pdf',
        sourceType: 'slide',
        extractionProvider: 'slides',
        locatorKind: 'slide',
      },
      {
        subtype: 'office-native',
        sourceType: 'text',
        extractionProvider: 'text',
        locatorKind: 'paragraph',
      },
    ];

    for (const c of cases) {
      const ir = buildIr([paragraphBlock('b', 'body')], c.subtype);
      const [chunk] = documentIrToKnowledgeChunks({
        ...defaultOptions(),
        documentIr: ir,
      });
      expect(chunk.sourceType).toBe(c.sourceType);
      expect(chunk.extractionProvider).toBe(c.extractionProvider);
      expect(chunk.locator.kind).toBe(c.locatorKind);
    }
  });

  describe('500KiB splitting', () => {
    it('keeps a single chunk when below the byte cap', () => {
      const ir = buildIr([paragraphBlock('p1-b1', 'short text')]);
      const chunks = documentIrToKnowledgeChunks({
        ...defaultOptions(),
        documentIr: ir,
      });
      expect(chunks).toHaveLength(1);
      expect(
        estimateKnowledgeChunkFirestoreBytes(chunks[0])
      ).toBeLessThanOrEqual(MAX_FIRESTORE_CHUNK_DOCUMENT_BYTES);
    });

    it('splits along blank-line paragraph boundaries when oversized', () => {
      // Five "paragraphs" of 400 chars each, joined by blank lines.
      // With maxChunkBytes=1024 we force the splitter to engage.
      const para = (label: string): string => `${label} ${'x'.repeat(395)}`;
      const text = ['p-A', 'p-B', 'p-C', 'p-D', 'p-E']
        .map(para)
        .join('\n\n');

      const ir = buildIr([paragraphBlock('p1-b1', text)]);
      const chunks = documentIrToKnowledgeChunks({
        ...defaultOptions(),
        documentIr: ir,
        maxChunkBytes: 1024,
      });

      expect(chunks.length).toBeGreaterThan(1);
      // Every part respects the cap.
      for (const chunk of chunks) {
        expect(
          estimateKnowledgeChunkFirestoreBytes(chunk)
        ).toBeLessThanOrEqual(1024);
      }
      // IDs and paragraphIds are uniquely suffixed.
      const ids = chunks.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      const paragraphIds = chunks.map((c) =>
        c.locator.kind === 'pdf' ? c.locator.paragraphId : null
      );
      expect(new Set(paragraphIds).size).toBe(paragraphIds.length);
      // Each part is tagged in extractionWarnings.
      expect(
        chunks.every((c) =>
          (c.extractionWarnings ?? []).some((w) => w.startsWith('split='))
        )
      ).toBe(true);
    });

    it('falls back to char-window split when a single paragraph still exceeds the cap', () => {
      // One long paragraph with no blank lines — paragraph-aligned split has
      // nothing to chew on, so the char-window fallback must engage.
      const text = 'y'.repeat(4096);
      const ir = buildIr([paragraphBlock('p1-b1', text)]);

      const chunks = documentIrToKnowledgeChunks({
        ...defaultOptions(),
        documentIr: ir,
        maxChunkBytes: 1024,
      });

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(
          estimateKnowledgeChunkFirestoreBytes(chunk)
        ).toBeLessThanOrEqual(1024);
      }
      // Concatenating the parts reconstructs the original text.
      expect(chunks.map((c) => c.text).join('')).toBe(text);
    });
  });

  describe('validateKnowledgeChunkInvariants', () => {
    it('every produced chunk passes validateKnowledgeChunkInvariants', () => {
      const ir = buildIr([
        paragraphBlock('p1-b1', '本文ブロック'),
        {
          blockId: 'p1-h1',
          kind: 'heading',
          text: '第1章 総則',
          locator: { pageNumber: 1, bbox: [0, 0, 100, 20] },
          metadata: { headingLevel: 1 },
        },
        {
          blockId: 'p1-t0-r0',
          kind: 'table',
          text: 'A\tB',
          locator: { pageNumber: 1, tableIndex: 0, rowIndex: 0 },
        },
        {
          blockId: 'p1-t0-r1',
          kind: 'table',
          text: 'C\tD',
          locator: { pageNumber: 1, tableIndex: 0, rowIndex: 1 },
        },
      ]);

      const chunks = documentIrToKnowledgeChunks({
        ...defaultOptions(),
        documentIr: ir,
      });
      expect(chunks).toHaveLength(4);

      for (const chunk of chunks) {
        const result = validateKnowledgeChunkInvariants(chunk, {
          parentDocument,
          extractorInput: EXTRACTOR_INPUT,
        });
        if (!result.ok) {
          throw new Error(
            `invariant violations on ${chunk.id}: ${result.errors.join('; ')}`
          );
        }
        expect(result).toEqual({ ok: true });
      }
    });

    it('split chunks also pass validateKnowledgeChunkInvariants', () => {
      const text = Array.from({ length: 6 }, (_, i) =>
        `chunk-${i} ${'z'.repeat(400)}`
      ).join('\n\n');
      const ir = buildIr([paragraphBlock('p1-b1', text)]);

      const chunks = documentIrToKnowledgeChunks({
        ...defaultOptions(),
        documentIr: ir,
        maxChunkBytes: 1024,
      });
      expect(chunks.length).toBeGreaterThan(1);

      for (const chunk of chunks) {
        const result = validateKnowledgeChunkInvariants(chunk, {
          parentDocument,
          extractorInput: EXTRACTOR_INPUT,
        });
        if (!result.ok) {
          throw new Error(
            `invariant violations on ${chunk.id}: ${result.errors.join('; ')}`
          );
        }
        expect(result.ok).toBe(true);
      }
    });

    it('honours sensitivity → aiUsePolicy expectations for Confidential docs', () => {
      const ir = buildIr([paragraphBlock('p1-b1', 'sensitive body')]);
      const chunks = documentIrToKnowledgeChunks({
        documentIr: ir,
        docId: DOC_ID,
        extractorInput: EXTRACTOR_INPUT,
        documentSensitivity: 'Confidential',
        documentAiUsePolicy: 'requires_masking',
        maskedText: '[REDACTED]',
        now: FIXED_NOW,
      });
      expect(chunks).toHaveLength(1);
      const result = validateKnowledgeChunkInvariants(chunks[0], {
        parentDocument,
        extractorInput: EXTRACTOR_INPUT,
      });
      expect(result).toEqual({ ok: true });
      expect(chunks[0].maskedText).toBe('[REDACTED]');
    });
  });

  it('sourceHash equals computeChunkSourceHash(extractorInput, locator)', () => {
    const ir = buildIr([paragraphBlock('p1-b1', 'short')]);
    const [chunk] = documentIrToKnowledgeChunks({
      ...defaultOptions(),
      documentIr: ir,
    });
    expect(chunk.sourceHash).toBe(
      computeChunkSourceHash({
        extractorInput: EXTRACTOR_INPUT,
        locator: chunk.locator,
      })
    );
  });
});

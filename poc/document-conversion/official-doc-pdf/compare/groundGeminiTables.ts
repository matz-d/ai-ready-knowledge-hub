import { normalizeForSubstringMatch } from '../../../../src/eval/conversion/golden';
import type {
  DocumentIr,
  DocumentIrBlock,
  DocumentIrPage,
} from '../../shared/documentIr';
import type { GeminiTableGroundingObservation } from './renderCompareReport';

const MIN_GROUNDED_CELLS_PER_ROW = 2;
const SUBSTANTIVE_CELL_MIN_CHARS = 2;

function cellsFromTableBlock(block: DocumentIrBlock): string[] {
  return block.text
    .split(/[\t\n]/u)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}

function groundCellsInPageText(
  block: DocumentIrBlock,
  pageText: string
): string[] {
  const normalizedPage = normalizeForSubstringMatch(pageText);
  if (normalizedPage.length === 0) return [];

  const groundedCells: string[] = [];
  let hasSubstantiveCell = false;
  for (const cell of cellsFromTableBlock(block)) {
    const normalizedCell = normalizeForSubstringMatch(cell);
    if (normalizedCell.length === 0) continue;
    if (!normalizedPage.includes(normalizedCell)) continue;
    groundedCells.push(cell);
    if (normalizedCell.length >= SUBSTANTIVE_CELL_MIN_CHARS) {
      hasSubstantiveCell = true;
    }
  }

  if (
    groundedCells.length < MIN_GROUNDED_CELLS_PER_ROW ||
    !hasSubstantiveCell
  ) {
    return [];
  }
  return groundedCells;
}

export function mergePdfParseWithGeminiTables(options: {
  pdfParseDocumentIr: DocumentIr;
  geminiTableDocumentIr: DocumentIr;
}): {
  documentIr: DocumentIr;
  grounding: GeminiTableGroundingObservation;
} {
  const pdfParseTextByPage = new Map(
    options.pdfParseDocumentIr.pages.map((page) => [
      page.pageNumber,
      page.blocks.map((block) => block.text).join('\n'),
    ])
  );
  const geminiTablesByPage = new Map<number, DocumentIrBlock[]>();
  let rawTableRows = 0;
  let groundedTableRows = 0;
  const rejectedExamples: GeminiTableGroundingObservation['rejectedExamples'] = [];

  for (const page of options.geminiTableDocumentIr.pages) {
    const pdfParsePageText = pdfParseTextByPage.get(page.pageNumber) ?? '';
    const sourceTableBlocks = page.blocks.filter(
      (block) => block.kind === 'table' && block.text.trim().length > 0
    );
    rawTableRows += sourceTableBlocks.length;

    const tableBlocks: DocumentIrBlock[] = [];
    for (const [index, block] of sourceTableBlocks.entries()) {
      const groundedCells = groundCellsInPageText(block, pdfParsePageText);
      if (groundedCells.length < MIN_GROUNDED_CELLS_PER_ROW) {
        if (rejectedExamples.length < 5) {
          rejectedExamples.push({
            pageNumber: page.pageNumber,
            text: block.text.slice(0, 240),
            reason: 'fewer than 2 same-page-grounded cells',
          });
        }
        continue;
      }

      groundedTableRows += 1;
      tableBlocks.push({
        ...block,
        blockId: `gemini-table-assist-${page.pageNumber}-${index + 1}`,
        text: groundedCells.join('\t'),
        metadata: {
          ...block.metadata,
          columnCount: groundedCells.length,
          extractionProvider: 'gemini-table-assist',
          mergedInto: 'pdf-parse',
        },
      });
    }

    if (tableBlocks.length > 0) {
      geminiTablesByPage.set(page.pageNumber, tableBlocks);
    }
  }

  const pageNumbers = new Set<number>([
    ...options.pdfParseDocumentIr.pages.map((page) => page.pageNumber),
    ...geminiTablesByPage.keys(),
  ]);
  const pages: DocumentIrPage[] = Array.from(pageNumbers)
    .sort((left, right) => left - right)
    .map((pageNumber) => {
      const pdfParsePage = options.pdfParseDocumentIr.pages.find(
        (page) => page.pageNumber === pageNumber
      );
      return {
        pageNumber,
        blocks: [
          ...(pdfParsePage?.blocks ?? []),
          ...(geminiTablesByPage.get(pageNumber) ?? []),
        ],
      };
    });

  return {
    documentIr: {
      ...options.pdfParseDocumentIr,
      pages,
    },
    grounding: {
      rawTableRows,
      groundedTableRows,
      rejectedTableRows: rawTableRows - groundedTableRows,
      rejectedExamples,
    },
  };
}

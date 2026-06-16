import type { DocumentIrBlock } from '../../../eval/conversion/documentIr';

export function isTableAssistBlock(block: DocumentIrBlock): boolean {
  return (
    block.metadata?.tableAssist === true ||
    block.metadata?.extractionProvider === 'gemini-table-assist'
  );
}

export function withoutTableAssistBlocks(
  blocks: readonly DocumentIrBlock[]
): DocumentIrBlock[] {
  return blocks.filter((block) => !isTableAssistBlock(block));
}

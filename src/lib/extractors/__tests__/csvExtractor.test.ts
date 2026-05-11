import { describe, expect, it } from 'vitest';
import { extractCsv } from '../csvExtractor';

const baseInput = {
  docId: 'doc-csv-1',
  fileName: 'sample.csv',
  documentSensitivity: 'Internal' as const,
  documentAiUsePolicy: 'direct' as const,
};

describe('extractCsv', () => {
  it('promotes chunk to Confidential / requires_masking / columnRule when a header matches 顧客名', () => {
    const content = '顧客名,数量\nAcme,10\n';
    const { chunks } = extractCsv({ ...baseInput, content });

    expect(chunks).toHaveLength(1);
    const chunk = chunks[0];
    expect(chunk.sensitivity).toBe('Confidential');
    expect(chunk.aiUsePolicy).toBe('requires_masking');
    expect(chunk.sensitivitySource).toBe('columnRule');
    expect(chunk.sensitivityReason).toBeTruthy();
    expect(chunk.structureType).toBe('table');
    expect(chunk.sourceType).toBe('spreadsheet');
    expect(chunk.extractionProvider).toBe('csv');
    expect(chunk.locator).toEqual({
      kind: 'spreadsheet',
      sheetName: 'Sheet1',
      range: 'A1:B2',
    });
  });

  it('keeps inherited sensitivity when no column header matches rules', () => {
    const content = '部署,人数\n営業,3\n';
    const { chunks } = extractCsv({ ...baseInput, content });

    expect(chunks).toHaveLength(1);
    const chunk = chunks[0];
    expect(chunk.sensitivity).toBe('Internal');
    expect(chunk.aiUsePolicy).toBe('direct');
    expect(chunk.sensitivitySource).toBe('inherited');
    expect(chunk.sensitivityReason).toBeUndefined();
  });

  it('is idempotent for sourceHash on repeated extraction with the same bytes', () => {
    const content = 'A,B\n1,2\n';
    const first = extractCsv({ ...baseInput, content });
    const second = extractCsv({ ...baseInput, content });

    expect(first.chunks[0].sourceHash).toBe(second.chunks[0].sourceHash);
  });

  it('aligns normalizedMarkdown with concatenated chunk texts (D-P2-6)', () => {
    const content = '列1,列2\nx,y\n';
    const { normalizedMarkdown, chunks } = extractCsv({
      ...baseInput,
      content,
    });

    const joined = chunks.map((c) => c.text).join('');
    expect(joined).toBe(normalizedMarkdown);
    expect(normalizedMarkdown.length).toBeGreaterThan(0);
  });
});

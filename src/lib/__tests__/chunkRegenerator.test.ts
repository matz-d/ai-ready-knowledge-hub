import { describe, expect, it } from 'vitest';
import { extractChunks } from '../chunkRegenerator';
import { KnowledgeChunkSchema } from '../knowledgeChunkSchema';

const DOC_ID = '00000000-0000-4000-8000-000000000001';

describe('extractChunks', () => {
  it('creates one paragraph chunk for .txt with inherited sensitivity and aiUsePolicy', async () => {
    const body = 'Hello from plain text.';
    const result = await extractChunks({
      docId: DOC_ID,
      fileName: 'notes.txt',
      content: Buffer.from(body, 'utf8'),
      documentSensitivity: 'Internal',
      documentAiUsePolicy: 'direct',
    });

    expect(result.extractorName).toBe('text');
    expect(result.extractorInput).toBe(body);
    expect(result.chunks).toHaveLength(1);

    const chunk = KnowledgeChunkSchema.parse(result.chunks[0]);
    expect(chunk.text).toBe(body);
    expect(chunk.sourceType).toBe('text');
    expect(chunk.structureType).toBe('paragraph');
    expect(chunk.locator).toEqual({ kind: 'paragraph' });
    expect(chunk.extractionProvider).toBe('text');
    expect(chunk.sensitivity).toBe('Internal');
    expect(chunk.aiUsePolicy).toBe('direct');
  });

  it('creates one paragraph chunk for .md (raw text, no markdown parse)', async () => {
    const body = '# Title\n\nBody line.';
    const result = await extractChunks({
      docId: DOC_ID,
      fileName: 'readme.md',
      content: Buffer.from(body, 'utf8'),
      documentSensitivity: 'Confidential',
      documentAiUsePolicy: 'requires_masking',
    });

    expect(result.extractorName).toBe('text');
    expect(result.chunks).toHaveLength(1);

    const chunk = KnowledgeChunkSchema.parse(result.chunks[0]);
    expect(chunk.text).toBe(body);
    expect(chunk.sensitivity).toBe('Confidential');
    expect(chunk.aiUsePolicy).toBe('requires_masking');
  });

  it('returns zero chunks for whitespace-only .txt without throwing', async () => {
    const result = await extractChunks({
      docId: DOC_ID,
      fileName: 'empty.txt',
      content: Buffer.from('  \n\t  ', 'utf8'),
      documentSensitivity: 'Public',
      documentAiUsePolicy: 'direct',
    });

    expect(result.extractorName).toBe('text');
    expect(result.chunks).toHaveLength(0);
  });

  it('returns zero chunks for empty buffer .md without throwing', async () => {
    const result = await extractChunks({
      docId: DOC_ID,
      fileName: 'blank.md',
      content: Buffer.alloc(0),
      documentSensitivity: 'Public',
      documentAiUsePolicy: 'direct',
    });

    expect(result.extractorName).toBe('text');
    expect(result.chunks).toHaveLength(0);
  });
});

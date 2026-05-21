import { beforeEach, describe, expect, it, vi } from 'vitest';

let _response: { output?: unknown; text?: string } = {};
let _lastGenerateOptions: {
  system?: string;
  prompt?: Array<{ text?: string }>;
} | null = null;

vi.mock('../../../agents/_shared/genkitClient', () => ({
  ai: {
    generate: async (options: typeof _lastGenerateOptions) => {
      _lastGenerateOptions = options;
      return _response;
    },
  },
  modelRef: () => 'mock-model-ref',
  modelId: 'gemini-test-model',
}));

import {
  SCAN_PDF_GEMINI_OCR_PROMPT,
  SCAN_PDF_GEMINI_OCR_SYSTEM_PROMPT,
  ScanPdfGeminiOcrError,
  generateScanPdfGeminiOcr,
} from '../scanPdfGeminiOcr';

const BUFFER = Buffer.from('scan bytes');

beforeEach(() => {
  _lastGenerateOptions = null;
  _response = {
    output: {
      pages: [
        {
          pageNumber: 1,
          blocks: [{ kind: 'image_text', text: 'fragmented scan text' }],
        },
      ],
      piiFindings: [
        {
          pageNumber: 1,
          category: 'phone',
          evidenceSnippet: '03-12',
          maskability: 'unmaskable',
          reason: 'fragmented digits',
        },
      ],
    },
  };
});

describe('generateScanPdfGeminiOcr', () => {
  it('uses the shared scan prompt and preserves PII maskability', async () => {
    const result = await generateScanPdfGeminiOcr({ buffer: BUFFER });

    expect(_lastGenerateOptions?.system).toBe(SCAN_PDF_GEMINI_OCR_SYSTEM_PROMPT);
    expect(_lastGenerateOptions?.prompt?.[0]?.text).toBe(
      SCAN_PDF_GEMINI_OCR_PROMPT
    );
    expect(result.output.piiFindings[0]?.maskability).toBe('unmaskable');
    expect(result.model).toBe('gemini-test-model');
  });

  it('falls back to JSON in response.text after invalid structured output', async () => {
    _response = {
      output: { invalid: true },
      text: JSON.stringify({
        pages: [
          {
            pageNumber: 1,
            blocks: [{ kind: 'paragraph', text: 'from text' }],
          },
        ],
        piiFindings: [],
      }),
    };

    const result = await generateScanPdfGeminiOcr({ buffer: BUFFER });

    expect(result.output.pages[0]?.blocks[0]?.text).toBe('from text');
  });

  it('rejects output with pages but no visible text', async () => {
    _response = {
      output: {
        pages: [{ pageNumber: 1, blocks: [{ kind: 'image_text', text: ' ' }] }],
        piiFindings: [],
      },
    };

    await expect(generateScanPdfGeminiOcr({ buffer: BUFFER })).rejects.toEqual(
      expect.objectContaining<Partial<ScanPdfGeminiOcrError>>({
        kind: 'gemini-output-empty',
      })
    );
  });
});

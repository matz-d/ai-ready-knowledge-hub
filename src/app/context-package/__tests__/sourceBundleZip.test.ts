import { describe, expect, it } from 'vitest';
import {
  createSourceBundleZipBlob,
  sourceBundleZipFileName,
} from '../sourceBundleZip';

function signatureAt(bytes: Uint8Array, offset: number): string {
  return Array.from(bytes.slice(offset, offset + 4))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

describe('sourceBundleZip', () => {
  it('creates a standard zip containing the guide and included source files', async () => {
    const blob = createSourceBundleZipBlob({
      files: [
        {
          fileName: '00-CONTEXT-PACKAGE-GUIDE.md',
          content: '# Guide\n\nUse separate sources.',
          contentType: 'text/markdown',
          role: 'guide',
        },
        {
          fileName: 'payroll-checklist.csv',
          originalFileName: 'payroll-checklist.csv',
          content: 'item,description\nsalary,calculate monthly payroll',
          contentType: 'text/csv',
          role: 'included-source',
        },
      ],
    });

    expect(blob.type).toBe('application/zip');

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const decoded = new TextDecoder().decode(bytes);

    expect(signatureAt(bytes, 0)).toBe('504b0304');
    expect(decoded).toContain('00-CONTEXT-PACKAGE-GUIDE.md');
    expect(decoded).toContain('payroll-checklist.csv');
    expect(decoded).toContain('calculate monthly payroll');
    expect(decoded).toContain('PK\x01\x02');
    expect(decoded).toContain('PK\x05\x06');
  });

  it('uses a purpose-based zip filename', () => {
    expect(sourceBundleZipFileName('給与計算 AI / NotebookLM')).toBe(
      'context-package_sources_給与計算_AI___NotebookLM.zip',
    );
  });
});

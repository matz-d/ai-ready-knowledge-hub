import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  extractTextFromDocumentIR,
  isOverRestrictedForPublicDoc,
  PUBLIC_DOC_GOLDEN,
  type DocumentIR,
} from '../publicDocClassificationGolden';

describe('extractTextFromDocumentIR', () => {
  it('concatenates non-empty block text across pages in order', () => {
    const ir: DocumentIR = {
      pages: [
        { blocks: [{ text: 'A' }, { text: '  ' }, { text: 'B' }] },
        { blocks: [{ text: 'C' }] },
      ],
    };
    expect(extractTextFromDocumentIR(ir)).toBe('A\nB\nC');
  });

  it('handles missing pages/blocks/text safely', () => {
    expect(extractTextFromDocumentIR({})).toBe('');
    expect(extractTextFromDocumentIR({ pages: [{}] })).toBe('');
    expect(extractTextFromDocumentIR({ pages: [{ blocks: [{}] }] })).toBe('');
  });
});

describe('isOverRestrictedForPublicDoc', () => {
  it('accepts Public/Internal with direct', () => {
    expect(
      isOverRestrictedForPublicDoc({ sensitivity: 'Public', aiUsePolicy: 'direct' })
    ).toBe(false);
    expect(
      isOverRestrictedForPublicDoc({ sensitivity: 'Internal', aiUsePolicy: 'direct' })
    ).toBe(false);
  });

  it('flags Confidential/Restricted as over-restriction', () => {
    expect(
      isOverRestrictedForPublicDoc({
        sensitivity: 'Confidential',
        aiUsePolicy: 'requires_masking',
      })
    ).toBe(true);
    expect(
      isOverRestrictedForPublicDoc({
        sensitivity: 'Restricted',
        aiUsePolicy: 'blocked',
      })
    ).toBe(true);
  });

  it('flags a non-direct aiUsePolicy even if sensitivity is allowed', () => {
    expect(
      isOverRestrictedForPublicDoc({
        sensitivity: 'Internal',
        aiUsePolicy: 'requires_masking',
      })
    ).toBe(true);
  });
});

describe('PUBLIC_DOC_GOLDEN', () => {
  it('points at IR fixtures that exist on disk', () => {
    expect(PUBLIC_DOC_GOLDEN.length).toBeGreaterThan(0);
    for (const fixture of PUBLIC_DOC_GOLDEN) {
      expect(fixture.irPath.endsWith('.document-ir.json')).toBe(true);
      expect(existsSync(join(process.cwd(), fixture.irPath))).toBe(true);
    }
  });

  it('has unique fixture ids', () => {
    const ids = PUBLIC_DOC_GOLDEN.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

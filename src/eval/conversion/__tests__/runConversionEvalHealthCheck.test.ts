import { describe, expect, it } from 'vitest';
import { MAX_FIRESTORE_CHUNK_DOCUMENT_BYTES } from '../../../lib/knowledgeChunkSchema';
import {
  HEALTH_CHECK_SUPPORTED_SUBTYPE,
  runConversionEvalHealthCheck,
} from '../runConversionEvalHealthCheck';

describe('runConversionEvalHealthCheck', () => {
  it('evaluates schema_validity and chunk counters for subtype 1', () => {
    const result = runConversionEvalHealthCheck({
      sourceSubtype: HEALTH_CHECK_SUPPORTED_SUBTYPE,
      chunkDrafts: [{ text: 'alpha' }],
      schemaValidity: { passed: true },
    });

    expect(result.schemaValidity).toEqual({ passed: true, errors: [] });
    expect(result.contextPackageReadiness.chunkCount).toBe(1);
    expect(result.contextPackageReadiness.emptyChunks).toBe(0);
    expect(result.contextPackageReadiness.oversizedChunks).toBe(0);
    expect(result.safetyReadiness.unmaskablePiiFindings).toBe(0);
    expect(result.safetyReadiness.maskableChunkRate).toBe(1);
    expect(result.overall).toEqual({ status: 'pass', reasons: [] });
  });

  it('downgrades non-blocker context-package fail to overall warn (案B)', () => {
    const oversizedText = 'x'.repeat(MAX_FIRESTORE_CHUNK_DOCUMENT_BYTES + 1024);
    const result = runConversionEvalHealthCheck({
      sourceSubtype: HEALTH_CHECK_SUPPORTED_SUBTYPE,
      chunkDrafts: [{ text: '  ' }, { text: oversizedText }],
      schemaValidity: { passed: true },
    });

    expect(result.contextPackageReadiness.chunkCount).toBe(2);
    expect(result.contextPackageReadiness.emptyChunks).toBe(1);
    expect(result.contextPackageReadiness.oversizedChunks).toBe(1);
    expect(result.overall.status).toBe('warn');
    expect(result.overall.reasons).toContain(
      'context_package_readiness: fail (downgraded to warn)'
    );
  });

  it('fails when blocker axis schema_validity fails', () => {
    const result = runConversionEvalHealthCheck({
      sourceSubtype: HEALTH_CHECK_SUPPORTED_SUBTYPE,
      chunkDrafts: [{ text: 'alpha' }],
      schemaValidity: {
        passed: false,
        errors: ['schema error'],
      },
    });

    expect(result.overall.status).toBe('fail');
    expect(result.overall.reasons).toContain('schema_validity: fail');
  });

  it('accepts scan-pdf subtype for OCR PoC health checks', () => {
    const result = runConversionEvalHealthCheck({
      sourceSubtype: 'scan-pdf',
      chunkDrafts: [{ text: 'scanned line' }],
      schemaValidity: { passed: true },
    });

    expect(result.contextPackageReadiness.chunkCount).toBe(1);
    expect(result.overall.status).toBe('pass');
  });

  it('accepts slide-pdf subtype for subtype 2 health checks', () => {
    const result = runConversionEvalHealthCheck({
      sourceSubtype: 'slide-pdf',
      chunkDrafts: [{ text: 'slide line' }],
      schemaValidity: { passed: true },
    });

    expect(result.contextPackageReadiness.chunkCount).toBe(1);
    expect(result.overall.status).toBe('pass');
  });

  it('rejects unsupported subtypes', () => {
    expect(() =>
      runConversionEvalHealthCheck({
        sourceSubtype: 'office-native',
        chunkDrafts: [{ text: 'alpha' }],
        schemaValidity: { passed: true },
      })
    ).toThrow(/official-doc-pdf, slide-pdf, scan-pdf/);
  });
});

import { describe, expect, it } from 'vitest';
import type { CuratorOutputResult } from '../../agents/curator/schema';
import { documentUploadSuccessBodyFromOrchestrate } from '../documentUploadResponseMapper';
import type { OrchestrateResult } from '../uploadOrchestrator';

const curator: CuratorOutputResult = {
  documentType: 'メモ',
  businessDomain: '社内手順',
  sensitivity: 'Internal' as const,
  freshness: 'current' as const,
  isAuthoritativeCandidate: true,
  aiUsePolicy: 'direct' as const,
  rationale: 'ok',
};

describe('documentUploadSuccessBodyFromOrchestrate', () => {
  it('maps curated orchestrate result to API success body', () => {
    const result: OrchestrateResult = {
      kind: 'curated',
      docId: 'd1',
      storagePath: 'raw/d1/a.txt',
      curator,
      curatorCompletedAt: new Date('2026-05-08T00:00:00.000Z'),
    };
    const body = documentUploadSuccessBodyFromOrchestrate({
      displayName: 'a.txt',
      contentType: 'text/plain',
      byteSize: 5,
      modelId: 'm1',
      result,
      ingestMeta: { kind: 'created' },
    });
    expect(body).toEqual({
      docId: 'd1',
      fileName: 'a.txt',
      contentType: 'text/plain',
      byteSize: 5,
      storagePath: 'raw/d1/a.txt',
      status: 'curated',
      kind: 'created',
      curator: {
        documentType: 'メモ',
        businessDomain: '社内手順',
        sensitivity: 'Internal',
        freshness: 'current',
        isAuthoritativeCandidate: true,
        aiUsePolicy: 'direct',
        rationale: 'ok',
        completedAt: '2026-05-08T00:00:00.000Z',
        modelId: 'm1',
      },
    });
    expect(body).not.toHaveProperty('masker');
    expect(body).not.toHaveProperty('skipped');
    expect(body).not.toHaveProperty('aiSafeStoragePath');
  });

  it('maps ai_safe result including masker and aiSafeStoragePath', () => {
    const maskingCurator = { ...curator, aiUsePolicy: 'requires_masking' as const };
    const result: OrchestrateResult = {
      kind: 'ai_safe',
      docId: 'd2',
      storagePath: 'raw/d2/a.txt',
      aiSafeStoragePath: 'masked/d2/a.txt',
      curator: maskingCurator,
      curatorCompletedAt: new Date('2026-05-08T01:00:00.000Z'),
      masker: {
        decision: 'ai_safe_ready',
        provider: 'simple-rule',
        maskedSpansCount: 1,
        ruleHits: {},
        residualRisk: { detected: false, reasons: [] },
        rationale: 'x',
        recommendedSensitivity: 'Confidential',
        completedAt: new Date('2026-05-08T01:00:01.000Z'),
        modelId: 'm1',
      },
    };
    const body = documentUploadSuccessBodyFromOrchestrate({
      displayName: 'a.txt',
      contentType: 'text/plain',
      byteSize: 3,
      modelId: 'm1',
      result,
      ingestMeta: { kind: 'overwritten', skipped: true },
    });
    expect(body.status).toBe('ai_safe');
    expect(body.kind).toBe('overwritten');
    expect(body.skipped).toBe(true);
    expect(body.aiSafeStoragePath).toBe('masked/d2/a.txt');
    expect(body.masker?.decision).toBe('ai_safe_ready');
  });
});

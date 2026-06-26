import { describe, expect, it } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import type { CuratorOutputResult } from '../../agents/curator/schema';
import {
  documentUploadSuccessBodyFromFirestoreDocument,
  documentUploadSuccessBodyFromOrchestrate,
} from '../documentUploadResponseMapper';
import {
  FIRESTORE_DOCUMENT_SCHEMA_VERSION,
  type FirestoreDocument,
} from '../firestoreSchema';
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

function timestamp(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso));
}

function firestoreDoc(overrides: Partial<FirestoreDocument> = {}): FirestoreDocument {
  return {
    id: 'doc-firestore',
    schemaVersion: FIRESTORE_DOCUMENT_SCHEMA_VERSION,
    fileName: 'sample.txt',
    contentType: 'text/plain',
    byteSize: 12,
    contentSha256: 'hash-1',
    sourceKind: 'upload',
    externalSource: null,
    storagePath: 'raw/doc-firestore/sample.txt',
    aiSafeStoragePath: null,
    status: 'curated',
    createdAt: timestamp('2026-05-08T00:00:00.000Z'),
    updatedAt: timestamp('2026-05-08T00:30:00.000Z'),
    documentType: 'メモ',
    businessDomain: '社内手順',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    aiUsePolicy: 'direct',
    sensitivitySource: 'curator',
    originalCuratorSensitivity: null,
    sensitivityReason: null,
    curator: {
      ...curator,
      completedAt: timestamp('2026-05-08T00:01:00.000Z'),
      modelId: 'm-firestore',
    },
    curatorError: null,
    masker: null,
    maskerError: null,
    ...overrides,
  };
}

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

describe('documentUploadSuccessBodyFromFirestoreDocument', () => {
  it('maps an existing ai_safe Firestore document to the upload result shape', () => {
    const body = documentUploadSuccessBodyFromFirestoreDocument({
      doc: firestoreDoc({
        status: 'ai_safe',
        sensitivity: 'Confidential',
        aiUsePolicy: 'requires_masking',
        aiSafeStoragePath: 'masked/doc-firestore/sample.txt',
        curator: {
          ...curator,
          sensitivity: 'Confidential',
          aiUsePolicy: 'requires_masking',
          completedAt: timestamp('2026-05-08T00:01:00.000Z'),
          modelId: 'm-firestore',
        },
        masker: {
          decision: 'ai_safe_ready',
          provider: 'simple-rule',
          maskedSpansCount: 2,
          ruleHits: { phone_like: 1 },
          residualRisk: { detected: false, reasons: [] },
          rationale: 'masked',
          recommendedSensitivity: 'Confidential',
          sourceContentHash: 'hash-1',
          aiSafeSchemaVersion: 1,
          completedAt: timestamp('2026-05-08T00:02:00.000Z'),
          modelId: 'masker-model',
        },
      }),
      ingestMeta: { kind: 'overwritten' },
    });

    expect(body).toEqual(
      expect.objectContaining({
        docId: 'doc-firestore',
        status: 'ai_safe',
        kind: 'overwritten',
        aiSafeStoragePath: 'masked/doc-firestore/sample.txt',
        curator: expect.objectContaining({
          aiUsePolicy: 'requires_masking',
          completedAt: '2026-05-08T00:01:00.000Z',
        }),
        masker: expect.objectContaining({
          decision: 'ai_safe_ready',
          completedAt: '2026-05-08T00:02:00.000Z',
        }),
      })
    );
  });

  it('returns null for non-terminal Firestore documents', () => {
    const body = documentUploadSuccessBodyFromFirestoreDocument({
      doc: firestoreDoc({ status: 'uploaded', curator: null }),
      ingestMeta: { kind: 'created' },
    });

    expect(body).toBeNull();
  });
});

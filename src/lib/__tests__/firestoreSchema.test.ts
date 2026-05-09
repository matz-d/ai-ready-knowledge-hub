import type { Timestamp } from '@google-cloud/firestore';
import { describe, expect, it } from 'vitest';
import {
  assertFirestoreInvariants,
  type FirestoreCuratorBlock,
  type FirestoreMaskerBlock,
  validateFirestoreDocumentInvariants,
} from '../firestoreSchema';

type InvariantInput = Parameters<typeof validateFirestoreDocumentInvariants>[0];

const timestampStub = {} as Timestamp;

const baseCurator: FirestoreCuratorBlock = {
  documentType: 'メモ',
  businessDomain: '顧客対応',
  sensitivity: 'Confidential',
  freshness: 'current',
  isAuthoritativeCandidate: true,
  aiUsePolicy: 'requires_masking',
  rationale: 'requires masking',
  completedAt: timestampStub,
  modelId: 'test-model',
};

const baseAiSafeMasker: FirestoreMaskerBlock = {
  decision: 'ai_safe_ready',
  provider: 'simple-rule',
  maskedSpansCount: 1,
  ruleHits: { email: 1 },
  residualRisk: { detected: false, reasons: [] },
  rationale: 'safe',
  recommendedSensitivity: 'Confidential',
  sourceContentHash: 'hash-1',
  aiSafeSchemaVersion: 1,
  completedAt: timestampStub,
  modelId: 'test-model',
};

const baseRestrictedMasker: FirestoreMaskerBlock = {
  ...baseAiSafeMasker,
  decision: 'restricted_promoted',
  recommendedSensitivity: 'Restricted',
  residualRisk: { detected: true, reasons: ['re-identification risk remains'] },
  rationale: 'restricted required',
};

function buildAiSafeDoc(overrides: Partial<InvariantInput> = {}): InvariantInput {
  return {
    status: 'ai_safe',
    contentSha256: 'hash-1',
    aiSafeStoragePath: 'masked/doc-1/sample.txt',
    sensitivity: 'Confidential',
    aiUsePolicy: 'requires_masking',
    sensitivitySource: 'curator',
    originalCuratorSensitivity: null,
    sensitivityReason: null,
    curator: baseCurator,
    masker: baseAiSafeMasker,
    ...overrides,
  };
}

function buildRestrictedDoc(
  overrides: Partial<InvariantInput> = {}
): InvariantInput {
  return {
    status: 'restricted',
    contentSha256: 'hash-1',
    aiSafeStoragePath: null,
    sensitivity: 'Restricted',
    aiUsePolicy: 'blocked',
    sensitivitySource: 'masker',
    originalCuratorSensitivity: 'Confidential',
    sensitivityReason: 'residual risk remains after masking',
    curator: baseCurator,
    masker: baseRestrictedMasker,
    ...overrides,
  };
}

function expectInvariantViolation(
  doc: InvariantInput,
  expectedPath: string
): void {
  const violations = validateFirestoreDocumentInvariants(doc);
  expect(violations.some((v) => v.path === expectedPath)).toBe(true);
  expect(() => assertFirestoreInvariants(doc)).toThrow(
    'Firestore document invariant violations:'
  );
}

describe('validateFirestoreDocumentInvariants', () => {
  it('accepts valid ai_safe terminal shape with aligned path and masker decision', () => {
    const doc = buildAiSafeDoc();
    expect(validateFirestoreDocumentInvariants(doc)).toEqual([]);
    expect(() => assertFirestoreInvariants(doc)).not.toThrow();
  });

  it('accepts valid restricted terminal shape with masker provenance and reason', () => {
    const doc = buildRestrictedDoc();
    expect(validateFirestoreDocumentInvariants(doc)).toEqual([]);
    expect(() => assertFirestoreInvariants(doc)).not.toThrow();
  });

  it('rejects ai_safe status when aiSafeStoragePath is missing', () => {
    expectInvariantViolation(buildAiSafeDoc({ aiSafeStoragePath: null }), 'aiSafeStoragePath');
  });

  it('rejects restricted status when sensitivityReason is missing', () => {
    expectInvariantViolation(buildRestrictedDoc({ sensitivityReason: null }), 'sensitivityReason');
  });

  it('rejects masker-sourced sensitivity when originalCuratorSensitivity is missing', () => {
    expectInvariantViolation(
      buildRestrictedDoc({ originalCuratorSensitivity: null }),
      'sensitivitySource'
    );
  });

  it('rejects ai_safe/restricted status when masker block is missing', () => {
    expectInvariantViolation(buildAiSafeDoc({ masker: null }), 'masker');
  });

  it('rejects terminal status when curator block is missing', () => {
    expectInvariantViolation(buildRestrictedDoc({ curator: null }), 'curator');
  });
});

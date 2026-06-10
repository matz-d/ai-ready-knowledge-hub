import { describe, expect, it } from 'vitest';
import {
  PIPELINE_STATUSES,
  aggregatePipelineDocumentCounts,
  aggregatePipelineStatusCounts,
  aiReadyDocumentCount,
  emptyPipelineStatusCounts,
  inFlightDocumentCount,
  protectedDocumentCount,
  totalDocumentCount,
} from '../pipelineStatusCounts';

describe('aggregatePipelineStatusCounts', () => {
  it('counts each known status', () => {
    const counts = aggregatePipelineStatusCounts([
      'uploaded',
      'curating',
      'curating',
      'masking',
      'curated',
      'ai_safe',
      'restricted',
      'blocked',
      'failed',
    ]);
    expect(counts).toEqual({
      uploaded: 1,
      curating: 2,
      masking: 1,
      curated: 1,
      ai_safe: 1,
      restricted: 1,
      blocked: 1,
      failed: 1,
      directCurated: 0,
    });
  });

  it('silently ignores unknown or non-string statuses (same policy as inventory skip)', () => {
    const counts = aggregatePipelineStatusCounts([
      'curated',
      'not_a_status',
      undefined,
      null,
      42,
    ]);
    expect(totalDocumentCount(counts)).toBe(1);
    expect(counts.curated).toBe(1);
  });

  it('returns all-zero counts for empty input', () => {
    expect(aggregatePipelineStatusCounts([])).toEqual(emptyPipelineStatusCounts());
  });
});

describe('derived counts', () => {
  const counts = aggregatePipelineDocumentCounts([
    { status: 'uploaded' },
    { status: 'curating' },
    { status: 'masking' },
    { status: 'curated', aiUsePolicy: 'direct' },
    { status: 'curated', aiUsePolicy: 'requires_masking', maskingPending: true },
    { status: 'ai_safe', aiUsePolicy: 'requires_masking' },
    { status: 'ai_safe', aiUsePolicy: 'requires_masking' },
    { status: 'restricted', aiUsePolicy: 'blocked' },
    { status: 'blocked', aiUsePolicy: 'blocked' },
    { status: 'failed' },
  ]);

  it('inFlight = uploaded + curating + masking', () => {
    expect(inFlightDocumentCount(counts)).toBe(3);
  });

  it('aiReady = direct curated + ai_safe, excluding masking-pending curated docs', () => {
    expect(aiReadyDocumentCount(counts)).toBe(3);
  });

  it('protected = restricted + blocked', () => {
    expect(protectedDocumentCount(counts)).toBe(2);
  });

  it('total sums every lifecycle status including failed', () => {
    expect(totalDocumentCount(counts)).toBe(10);
  });

  it('PIPELINE_STATUSES covers every lifecycle status key of the counts record', () => {
    expect([...PIPELINE_STATUSES].sort()).toEqual(
      Object.keys(emptyPipelineStatusCounts())
        .filter((key) => key !== 'directCurated')
        .sort()
    );
  });
});

describe('aggregatePipelineStatusCounts', () => {
  it('cannot infer direct curated readiness from status-only inputs', () => {
    const counts = aggregatePipelineStatusCounts([
      'curated',
      'ai_safe',
    ]);

    expect(counts.curated).toBe(1);
    expect(counts.directCurated).toBe(0);
    expect(aiReadyDocumentCount(counts)).toBe(1);
  });
});

describe('aggregatePipelineDocumentCounts', () => {
  it('counts direct curated rows separately from masking-pending curated rows', () => {
    const counts = aggregatePipelineDocumentCounts([
      { status: 'curated', aiUsePolicy: 'direct' },
      { status: 'curated', aiUsePolicy: 'requires_masking', maskingPending: true },
      { status: 'curated', aiUsePolicy: 'direct', maskingPending: true },
      { status: 'ai_safe', aiUsePolicy: 'requires_masking' },
      { status: 'not_a_status', aiUsePolicy: 'direct' },
    ]);

    expect(counts.curated).toBe(3);
    expect(counts.directCurated).toBe(1);
    expect(aiReadyDocumentCount(counts)).toBe(2);
  });
});

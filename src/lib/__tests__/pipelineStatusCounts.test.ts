import { describe, expect, it } from 'vitest';
import {
  PIPELINE_STATUSES,
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
  const counts = aggregatePipelineStatusCounts([
    'uploaded',
    'curating',
    'masking',
    'curated',
    'ai_safe',
    'ai_safe',
    'restricted',
    'blocked',
    'failed',
  ]);

  it('inFlight = uploaded + curating + masking', () => {
    expect(inFlightDocumentCount(counts)).toBe(3);
  });

  it('aiReady = curated + ai_safe', () => {
    expect(aiReadyDocumentCount(counts)).toBe(3);
  });

  it('protected = restricted + blocked', () => {
    expect(protectedDocumentCount(counts)).toBe(2);
  });

  it('total sums every lifecycle status including failed', () => {
    expect(totalDocumentCount(counts)).toBe(9);
  });

  it('PIPELINE_STATUSES covers every key of the counts record', () => {
    expect([...PIPELINE_STATUSES].sort()).toEqual(
      Object.keys(emptyPipelineStatusCounts()).sort()
    );
  });
});

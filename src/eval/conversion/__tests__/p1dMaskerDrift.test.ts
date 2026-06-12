import { describe, expect, it } from 'vitest';
import {
  buildP1dMaskerDriftReport,
  countPiiLeaks,
  measureMaskedValueRetention,
} from '../p1dMaskerDrift';

describe('countPiiLeaks', () => {
  it('detects known PII substrings in masked output', () => {
    const result = countPiiLeaks('担当: 山田 太郎 / 電話 03-1234-5678', [
      '山田 太郎',
      '03-1234-5678',
      '存在しないPII',
    ]);

    expect(result.piiLeakCount).toBe(2);
    expect(result.leaks).toEqual(['山田 太郎', '03-1234-5678']);
  });

  it('normalizes whitespace before matching', () => {
    const result = countPiiLeaks('電話:03-1234-5678', ['03 - 1234 - 5678']);
    expect(result.piiLeakCount).toBe(1);
  });
});

describe('measureMaskedValueRetention', () => {
  it('counts missing non-PII business values as liveFalseMaskedTokenCount', () => {
    const result = measureMaskedValueRetention(
      '請求書番号: SYN-INV-2026-0501\n合計: [REDACTED:AMOUNT]',
      [
        { field: 'invoice number', value: 'SYN-INV-2026-0501' },
        { field: 'invoice total', value: '¥1,133,000' },
      ]
    );

    expect(result.measured).toBe(true);
    expect(result.retainedCount).toBe(1);
    expect(result.liveFalseMaskedTokenCount).toBe(1);
    expect(result.missing).toEqual(['invoice total: ¥1,133,000']);
    expect(result.rate).toBe(0.5);
  });

  it('returns unmeasured when no retention targets exist', () => {
    const result = measureMaskedValueRetention('masked text', []);
    expect(result.measured).toBe(false);
    expect(result.rate).toBeNull();
  });
});

describe('buildP1dMaskerDriftReport', () => {
  it('aggregates fixture-level leak and retention metrics', () => {
    const report = buildP1dMaskerDriftReport(
      [
        {
          documentId: 'fixture-a',
          fileName: 'fixture-a.pdf',
          sourceTextLength: 100,
          maskedSpansCount: 2,
          ruleHits: { 'dlp:PHONE_NUMBER': 1 },
          piiLeakCount: 0,
          piiLeaks: [],
          liveFalseMaskedTokenCount: 1,
          maskedValueRetention: {
            measured: true,
            expectedCount: 2,
            retainedCount: 1,
            rate: 0.5,
            liveFalseMaskedTokenCount: 1,
            missing: ['total: ¥100'],
          },
        },
        {
          documentId: 'fixture-b',
          fileName: 'fixture-b.pdf',
          sourceTextLength: 80,
          maskedSpansCount: 1,
          ruleHits: {},
          piiLeakCount: 1,
          piiLeaks: ['XXXX Taro'],
          liveFalseMaskedTokenCount: 0,
          maskedValueRetention: {
            measured: true,
            expectedCount: 1,
            retainedCount: 1,
            rate: 1,
            liveFalseMaskedTokenCount: 0,
            missing: [],
          },
        },
      ],
      {
        executedAt: '2026-06-12T00:00:00.000Z',
        googleCloudProject: 'demo-project',
        googleCloudLocation: 'global',
      }
    );

    expect(report.summary.fixtureCount).toBe(2);
    expect(report.summary.piiLeakCount).toBe(1);
    expect(report.summary.liveFalseMaskedTokenCount).toBe(1);
    expect(report.summary.maskedValueRetentionAverage).toBe(0.75);
    expect(report.dlpRuleSetVersion).toMatch(/^dlp-ruleset-/);
  });
});

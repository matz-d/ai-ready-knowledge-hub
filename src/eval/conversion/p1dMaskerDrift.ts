import { CLOUD_DLP_RULE_SET_VERSION } from '../../agents/masker/cloudDlpMasker';
import { extractTextFromDocumentIR } from '../curator/publicDocClassificationGolden';
import { normalizeForSubstringMatch } from './golden';

export const P1D_MASKER_DRIFT_REPORT_SCHEMA_VERSION = 1 as const;

export type P1dMaskerDriftRetentionValue = {
  field: string;
  value: string;
};

export type P1dMaskerDriftGoldenFixture = {
  id: string;
  fileName: string;
  irPath: string;
  expectedPath: string;
  /** Synthetic PII literals that must not survive Cloud DLP masking. */
  knownPiiStrings: readonly string[];
  /** Non-PII business values that should remain after masking (over-mask signal). */
  nonPiiRetentionValues: readonly P1dMaskerDriftRetentionValue[];
  note: string;
};

/**
 * Synthetic PII fixtures with committed DocumentIR sidecars.
 * Known PII and non-PII retention targets are source-document intent,
 * not inferred from extraction recall expectations.
 */
export const P1D_MASKER_DRIFT_FIXTURES: readonly P1dMaskerDriftGoldenFixture[] =
  [
    {
      id: 'synthetic-employment-context-with-pii',
      fileName: 'synthetic-employment-context-with-pii.pdf',
      irPath:
        'sample-data/document-conversion/official-doc-pdf/synthetic-employment-context-with-pii.document-ir.json',
      expectedPath:
        'sample-data/document-conversion/official-doc-pdf/synthetic-employment-context-with-pii.expected.json',
      knownPiiStrings: [
        '山田 太郎',
        '03-1234-5678',
        '東京都千代田区サンプル町1-2-3',
      ],
      nonPiiRetentionValues: [
        {
          field: 'document title',
          value: '雇用契約コンテキスト（合成データ）',
        },
        {
          field: 'synthetic disclaimer',
          value: '本資料は学習目的のための合成データである',
        },
        {
          field: 'synthetic disclaimer',
          value: '氏名・住所・電話番号は架空である',
        },
      ],
      note: 'Official-doc synthetic employment fixture. PII must be removed; document framing text should survive masking.',
    },
    {
      id: 'synthetic-employment-form-scan',
      fileName: 'synthetic-employment-form-scan.pdf',
      irPath:
        'sample-data/document-conversion/scan-pdf/synthetic-employment-form-scan.document-ir.json',
      expectedPath:
        'sample-data/document-conversion/scan-pdf/synthetic-employment-form-scan.expected.json',
      knownPiiStrings: [
        'XXXX Taro',
        '090-1234-5678',
        'taro.xxxx@example.test',
        '1-2-3 XXXX-cho, Shibuya-ku, Tokyo',
        'Mizuho Bank 0001 / 1234567',
        '1234-5678-9012',
      ],
      nonPiiRetentionValues: [
        {
          field: 'form title',
          value: 'Synthetic Employment Information Form',
        },
        {
          field: 'employee id',
          value: 'EMP-XXXX-042',
        },
        {
          field: 'start date',
          value: '2026-04-01',
        },
      ],
      note: 'Scan-pdf employment form. Employee identifiers and start date are business context; contact and account-like values are PII.',
    },
    {
      id: 'synthetic-invoice-with-pii-scan',
      fileName: 'synthetic-invoice-with-pii-scan.pdf',
      irPath:
        'sample-data/document-conversion/scan-pdf/synthetic-invoice-with-pii-scan.document-ir.json',
      expectedPath:
        'sample-data/document-conversion/scan-pdf/synthetic-invoice-with-pii-scan.expected.json',
      knownPiiStrings: [
        '齋藤 試花',
        '東京都千代田区サンプル町1-2-3 サンプルビル4F',
        '123456789012',
      ],
      nonPiiRetentionValues: [
        {
          field: 'invoice number',
          value: 'SYN-INV-2026-0501',
        },
        {
          field: 'issue date',
          value: '2026年5月21日',
        },
        {
          field: 'invoice total',
          value: '¥1,133,000',
        },
        {
          field: 'line item amount',
          value: '¥385,000',
        },
        {
          field: 'line item amount',
          value: '¥440,000',
        },
        {
          field: 'customer company',
          value: '株式会社サンプル製作所 御中',
        },
      ],
      note: 'Scan-pdf invoice. Contact and account-like values must be masked; invoice numbers and amounts should survive.',
    },
  ] as const;

export const P1D_MASKER_DLP_INFO_TYPES = [
  'EMAIL_ADDRESS',
  'PHONE_NUMBER',
  'PERSON_NAME',
  'LOCATION',
  'STREET_ADDRESS',
  'DATE_OF_BIRTH',
  'CREDIT_CARD_NUMBER',
  'JAPAN_INDIVIDUAL_NUMBER',
  'JAPAN_BANK_ACCOUNT',
  'AIKH_SYNTHETIC_MASKED_PERSON_NAME',
  'AIKH_JP_MYNUMBER_LIKE',
] as const;

export type P1dMaskerDriftLeakResult = {
  piiLeakCount: number;
  leaks: string[];
};

export type P1dMaskerDriftRetentionResult = {
  measured: boolean;
  expectedCount: number;
  retainedCount: number;
  rate: number | null;
  liveFalseMaskedTokenCount: number;
  missing: string[];
};

export type P1dMaskerDriftFixtureResult = {
  documentId: string;
  fileName: string;
  sourceTextLength: number;
  maskedSpansCount: number;
  ruleHits: Record<string, number>;
  piiLeakCount: number;
  piiLeaks: string[];
  liveFalseMaskedTokenCount: number;
  maskedValueRetention: P1dMaskerDriftRetentionResult;
};

export type P1dMaskerDriftReport = {
  schemaVersion: typeof P1D_MASKER_DRIFT_REPORT_SCHEMA_VERSION;
  mode: 'live';
  executedAt: string;
  maskingProvider: 'cloud-dlp';
  dlpRuleSetVersion: string;
  dlpInfoTypes: readonly string[];
  googleCloudProject: string | null;
  googleCloudLocation: string | null;
  summary: {
    fixtureCount: number;
    piiLeakCount: number;
    liveFalseMaskedTokenCount: number;
    maskedValueRetentionAverage: number | null;
    nonPiiRetentionMeasuredCount: number;
  };
  fixtures: P1dMaskerDriftFixtureResult[];
  notes: string[];
};

function normalizedCorpus(text: string): string {
  return normalizeForSubstringMatch(text);
}

function isPresentInCorpus(normalizedNeedle: string, corpus: string): boolean {
  if (normalizedNeedle.length === 0) return true;
  return corpus.includes(normalizedNeedle);
}

export function countPiiLeaks(
  maskedContent: string,
  knownPiiStrings: readonly string[]
): P1dMaskerDriftLeakResult {
  const corpus = normalizedCorpus(maskedContent);
  const leaks: string[] = [];

  for (const pii of knownPiiStrings) {
    const normalized = normalizedCorpus(pii);
    if (isPresentInCorpus(normalized, corpus)) {
      leaks.push(pii);
    }
  }

  return {
    piiLeakCount: leaks.length,
    leaks,
  };
}

export function measureMaskedValueRetention(
  maskedContent: string,
  nonPiiValues: readonly P1dMaskerDriftRetentionValue[]
): P1dMaskerDriftRetentionResult {
  if (nonPiiValues.length === 0) {
    return {
      measured: false,
      expectedCount: 0,
      retainedCount: 0,
      rate: null,
      liveFalseMaskedTokenCount: 0,
      missing: [],
    };
  }

  const corpus = normalizedCorpus(maskedContent);
  const missing: string[] = [];

  for (const expected of nonPiiValues) {
    const normalizedValue = normalizedCorpus(expected.value);
    if (!isPresentInCorpus(normalizedValue, corpus)) {
      missing.push(`${expected.field}: ${expected.value}`);
    }
  }

  const retainedCount = nonPiiValues.length - missing.length;
  return {
    measured: true,
    expectedCount: nonPiiValues.length,
    retainedCount,
    rate: retainedCount / nonPiiValues.length,
    liveFalseMaskedTokenCount: missing.length,
    missing,
  };
}

export function extractMaskerInputTextFromDocumentIrJson(
  raw: unknown
): string {
  return extractTextFromDocumentIR(raw as Parameters<typeof extractTextFromDocumentIR>[0]);
}

export function buildP1dMaskerDriftReport(
  fixtureResults: readonly P1dMaskerDriftFixtureResult[],
  options: {
    executedAt?: string;
    googleCloudProject?: string | null;
    googleCloudLocation?: string | null;
  } = {}
): P1dMaskerDriftReport {
  const measuredRetention = fixtureResults
    .map((fixture) => fixture.maskedValueRetention)
    .filter((result) => result.measured && result.rate !== null);

  const maskedValueRetentionAverage =
    measuredRetention.length === 0
      ? null
      : measuredRetention.reduce((sum, result) => sum + (result.rate ?? 0), 0) /
        measuredRetention.length;

  return {
    schemaVersion: P1D_MASKER_DRIFT_REPORT_SCHEMA_VERSION,
    mode: 'live',
    executedAt: options.executedAt ?? new Date().toISOString(),
    maskingProvider: 'cloud-dlp',
    dlpRuleSetVersion: CLOUD_DLP_RULE_SET_VERSION,
    dlpInfoTypes: [...P1D_MASKER_DLP_INFO_TYPES],
    googleCloudProject: options.googleCloudProject ?? null,
    googleCloudLocation: options.googleCloudLocation ?? null,
    summary: {
      fixtureCount: fixtureResults.length,
      piiLeakCount: fixtureResults.reduce(
        (sum, fixture) => sum + fixture.piiLeakCount,
        0
      ),
      liveFalseMaskedTokenCount: fixtureResults.reduce(
        (sum, fixture) => sum + fixture.liveFalseMaskedTokenCount,
        0
      ),
      maskedValueRetentionAverage,
      nonPiiRetentionMeasuredCount: measuredRetention.length,
    },
    fixtures: [...fixtureResults],
    notes: [
      'live masker drift check uses Cloud DLP only; no committed masker-output sidecars are created',
      'piiLeakCount is a hard-fail safety signal; liveFalseMaskedTokenCount and maskedValueRetention are report-only over-mask signals',
      'stable falseMaskedTokenCount in p1dQualityGate remains a public sidecar redaction-marker tripwire',
    ],
  };
}

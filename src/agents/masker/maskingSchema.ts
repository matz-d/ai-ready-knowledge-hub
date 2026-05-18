import { z } from 'zod';
import {
  AiUsePolicyEnum,
  BusinessDomainEnum,
  SensitivityEnum,
} from '../curator/schema';

/**
 * ルールベース SimpleMasker の入出力スキーマ。
 * Cloud DLP 等へ差し替える際も入力・MaskedSpan 単位は維持しやすい形にする。
 */

export const MaskingCuratorContext = z.object({
  sensitivity: SensitivityEnum,
  aiUsePolicy: AiUsePolicyEnum,
  businessDomain: BusinessDomainEnum,
});

export type MaskingCuratorContext = z.infer<typeof MaskingCuratorContext>;

export const MaskingInput = z.object({
  fileName: z.string(),
  content: z.string(),
  curatorContext: MaskingCuratorContext,
});

export type MaskingInput = z.infer<typeof MaskingInput>;

export const MaskedSpanTypeEnum = z.enum([
  'EMAIL',
  'PHONE',
  'PERSON_NAME',
  'LOCATION',
  'STREET_ADDRESS',
  'DATE_OF_BIRTH',
  'CREDIT_CARD_NUMBER',
  'POSTAL_CODE',
  'JP_MYNUMBER',
  'BANK_ACCOUNT',
  'AMOUNT_JPY',
  'PERSON_NAME_HINT',
  'COMPANY_NAME_HINT',
  'CUSTOM_RULE',
]);

export type MaskedSpanType = z.infer<typeof MaskedSpanTypeEnum>;

export const MaskedSpan = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  type: MaskedSpanTypeEnum,
  ruleId: z.string(),
});

export type MaskedSpan = z.infer<typeof MaskedSpan>;

export const MaskingProviderEnum = z.enum(['simple-rule', 'cloud-dlp']);
export type MaskingProvider = z.infer<typeof MaskingProviderEnum>;

export const MaskingResult = z.object({
  provider: MaskingProviderEnum,
  maskedContent: z.string(),
  maskedSpans: z.array(MaskedSpan),
  ruleHits: z.record(z.string(), z.number()),
  ruleSetVersion: z.string().optional(),
});

export type MaskingResult = z.infer<typeof MaskingResult>;

export const ResidualRiskSnapshot = z.object({
  detected: z.boolean(),
  reasons: z.array(z.string()),
});

export const AiSafeVersion = z.object({
  fileName: z.string(),
  provider: z.string(),
  maskedContent: z.string(),
  maskedSpans: z.array(MaskedSpan),
  generatedAt: z.string().datetime(),
  sourceContentHash: z.string(),
  residualRisk: ResidualRiskSnapshot,
  schemaVersion: z.literal(1),
});

export type AiSafeVersion = z.infer<typeof AiSafeVersion>;

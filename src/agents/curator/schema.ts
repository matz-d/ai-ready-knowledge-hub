import { z } from 'zod';

/**
 * Curator 分類スキーマ。
 *
 * R5 で確定した 6 分類項目 + rationale (`docs/open-questions.md` R5)。
 * このファイルは PoC w1 から移植された「正本」であり、UI 表示・eval・移行スクリプト
 * すべてここを参照する。enum の表記揺れを増やしてはいけない。
 */

/** PoC 確定 enum (PLAN_w1.md R5 / docs/open-questions.md R5) */
export const DocumentTypeEnum = z.enum([
  '契約書',
  'テンプレート',
  '案内文',
  'メモ',
  'チェックリスト',
  '表',
  '規程',
  'その他',
]);

export const BusinessDomainEnum = z.enum([
  '顧問契約管理',
  '給与計算',
  '年末調整',
  '就業規則',
  '助成金相談',
  '顧客対応',
  '法改正対応',
  '社内手順',
  '教育・研修',
  '料金管理',
  'その他',
]);

export const SensitivityEnum = z.enum([
  'Public',
  'Internal',
  'Confidential',
  'Restricted',
]);

export const FreshnessEnum = z.enum(['current', 'superseded_candidate']);

export const AiUsePolicyEnum = z.enum([
  'direct',
  'requires_masking',
  'blocked',
]);

export type DocumentType = z.infer<typeof DocumentTypeEnum>;
export type BusinessDomain = z.infer<typeof BusinessDomainEnum>;
export type Sensitivity = z.infer<typeof SensitivityEnum>;
export type Freshness = z.infer<typeof FreshnessEnum>;
export type AiUsePolicy = z.infer<typeof AiUsePolicyEnum>;

export function expectedAiUsePolicy(sensitivity: Sensitivity): AiUsePolicy {
  switch (sensitivity) {
    case 'Public':
    case 'Internal':
      return 'direct';
    case 'Confidential':
      return 'requires_masking';
    case 'Restricted':
      return 'blocked';
  }
}

/**
 * Vertex の structured output / responseJsonSchema 用。
 * `.refine` / `.superRefine` は API に載せない（最終検証は {@link CuratorOutput}）。
 */
export const CuratorOutputCore = z.object({
  documentType: DocumentTypeEnum.describe(
    '文書の種類（列挙値のいずれかを完全一致で返す）'
  ),
  businessDomain: BusinessDomainEnum.describe(
    '業務ドメイン（列挙値のいずれかを完全一致で返す）'
  ),
  sensitivity: SensitivityEnum.describe(
    '情報の機密度。Public / Internal / Confidential / Restricted のいずれか'
  ),
  freshness: FreshnessEnum.describe(
    '情報の鮮度。current = 現在有効、superseded_candidate = 古い／代替候補の可能性'
  ),
  isAuthoritativeCandidate: z
    .boolean()
    .describe(
      '社内の正式な根拠として採用しうる候補か（規程・マスタ・公式案内などは true になりやすい）'
    ),
  aiUsePolicy: AiUsePolicyEnum.describe(
    'AI への投入方針。direct / requires_masking / blocked のいずれか。sensitivity に整合させること'
  ),
  rationale: z
    .string()
    .describe(
      '分類・機密度・AI 利用方針の根拠を日本語で 1〜3 文（評価・デバッグ用）'
    ),
});

export type CuratorOutputCore = z.infer<typeof CuratorOutputCore>;

/**
 * 機密度と AI 利用ポリシーの整合を Zod で検証（レスポンススキーマには含めない）。
 */
export const CuratorOutput = CuratorOutputCore.superRefine((data, ctx) => {
  const expected = expectedAiUsePolicy(data.sensitivity);
  if (data.aiUsePolicy !== expected) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['aiUsePolicy'],
      message: `sensitivity が ${data.sensitivity} のとき aiUsePolicy は ${expected} である必要があります（実際: ${data.aiUsePolicy}）`,
    });
  }
});

/** refine 込みの Curator 出力型 */
export type CuratorOutputResult = z.infer<typeof CuratorOutput>;

export const CuratorInput = z.object({
  fileName: z.string().describe('元ファイル名または表示用ラベル'),
  content: z.string().describe('文書本文'),
});

export type CuratorInput = z.infer<typeof CuratorInput>;

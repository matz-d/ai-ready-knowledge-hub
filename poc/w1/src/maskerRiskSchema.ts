import { z } from 'zod';

export const ResidualRiskInput = z.object({
  fileName: z.string().describe('元ファイル名または表示用ラベル'),
  maskedContent: z.string().describe('マスキング後の文書本文'),
});

export type ResidualRiskInput = z.infer<typeof ResidualRiskInput>;

export const RecommendedSensitivityEnum = z.enum([
  'Confidential',
  'Restricted',
]);

export type RecommendedSensitivity = z.infer<
  typeof RecommendedSensitivityEnum
>;

export const ResidualRiskOutputCore = z.object({
  residualRisk: z
    .object({
      detected: z
        .boolean()
        .describe(
          'マスク後も特定企業・特定取引・特定個人を再識別できるリスクが残るか'
        ),
      reasons: z
        .array(z.string())
        .min(1)
        .max(5)
        .describe('残存リスクまたは安全と判断した理由'),
    })
    .describe('マスキング後テキストに残る再識別リスクの判定'),
  recommendedSensitivity: RecommendedSensitivityEnum.describe(
    '残存リスクがある場合は Restricted、AI参照版として扱える場合は Confidential'
  ),
  rationale: z
    .string()
    .describe('判定理由を日本語で 1〜3 文（評価・デバッグ用）'),
});

export type ResidualRiskOutputCore = z.infer<typeof ResidualRiskOutputCore>;

export const ResidualRiskOutput = ResidualRiskOutputCore.superRefine(
  (data, ctx) => {
    const expected = data.residualRisk.detected
      ? 'Restricted'
      : 'Confidential';
    if (data.recommendedSensitivity !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recommendedSensitivity'],
        message: `residualRisk.detected が ${data.residualRisk.detected} のとき recommendedSensitivity は ${expected} である必要があります（実際: ${data.recommendedSensitivity}）`,
      });
    }
  }
);

export type ResidualRiskOutputResult = z.infer<typeof ResidualRiskOutput>;

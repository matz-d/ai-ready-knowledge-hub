import { z } from 'zod';
import {
  HumanReviewQuestionSchema,
  MissingInfoSchema,
  type HumanReviewQuestion,
  type MissingInfo,
} from './schema';
import { ai, generateValidated } from '../_shared/genkitClient';

const IncludedSummarySchema = z.object({
  docId: z.string().min(1),
  fileName: z.string().min(1),
  chunkId: z.string().min(1),
  rationale: z.string().min(1).max(400),
});

export const StrategistReduceInputSchema = z.object({
  purpose: z.string().min(1).max(2000),
  includedSummary: z.array(IncludedSummarySchema),
  missingCandidates: z.array(MissingInfoSchema),
  humanReviewQuestionCandidates: z.array(HumanReviewQuestionSchema),
  allowedChunkIds: z.array(z.string().min(1)),
});

export const StrategistReduceOutputCoreSchema = z.object({
  missing: z.array(MissingInfoSchema),
  humanReviewQuestions: z.array(HumanReviewQuestionSchema),
});

export const StrategistReduceOutputSchema =
  StrategistReduceOutputCoreSchema.superRefine((value, ctx) => {
    const missingTopics = new Set<string>();
    value.missing.forEach((item, index) => {
      const key = item.topic.trim().toLowerCase();
      if (missingTopics.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['missing', index, 'topic'],
          message: 'duplicate missing topic',
        });
      }
      missingTopics.add(key);
    });

    const questions = new Set<string>();
    value.humanReviewQuestions.forEach((item, index) => {
      const key = item.question.trim().toLowerCase();
      if (questions.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['humanReviewQuestions', index, 'question'],
          message: 'duplicate human review question',
        });
      }
      questions.add(key);
    });
  });

export type StrategistReduceInput = z.infer<typeof StrategistReduceInputSchema>;
export type StrategistReduceOutput = {
  missing: MissingInfo[];
  humanReviewQuestions: HumanReviewQuestion[];
};

const STRATEGIST_REDUCE_SYSTEM_PROMPT = `あなたは士業事務所向け AI 活用基盤の Strategist reducer です。
複数バッチで生成された Missing Knowledge と Human Review Questions を、全体として整合する1つのリストに統合します。

## 重要ルール
- 応答は JSON オブジェクト1つだけ。説明文、マークダウン、コードフェンスは禁止。
- includedSummary は「すでに Context Package に含めると判断された根拠」の一覧です。本文はありません。
- includedSummary に存在する topic を missing として残してはいけません。
- missingCandidates / humanReviewQuestionCandidates に存在しない新規 topic や質問を発明してはいけません。
- 重複・言い換えを統合し、代表表現だけを残してください。
- relatedChunkIds を返す場合は allowedChunkIds に含まれる chunk id だけにしてください。

## 出力スキーマ
{
  "missing": MissingInfo[],
  "humanReviewQuestions": HumanReviewQuestion[]
}`;

function buildReducePrompt(input: StrategistReduceInput): string {
  return `## Purpose
${input.purpose}

## Included Summary（本文なし）
${JSON.stringify(input.includedSummary)}

## Missing Candidates（この中から統合・削除のみ）
${JSON.stringify(input.missingCandidates)}

## Human Review Question Candidates（この中から統合・削除のみ）
${JSON.stringify(input.humanReviewQuestionCandidates)}

## allowedChunkIds
${JSON.stringify(input.allowedChunkIds)}

上記を全体整合させ、指定スキーマの JSON を1つだけ返してください。`;
}

function normalizeCandidateKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function reduceOutputValidationMessage(
  input: StrategistReduceInput,
  output: StrategistReduceOutput,
): string | undefined {
  const allowedMissingTopics = new Set(
    input.missingCandidates.map((item) => normalizeCandidateKey(item.topic)),
  );
  for (let index = 0; index < output.missing.length; index += 1) {
    const topic = normalizeCandidateKey(output.missing[index]!.topic);
    if (!allowedMissingTopics.has(topic)) {
      return `missing[${index}].topic was not present in missingCandidates`;
    }
  }

  const allowedQuestions = new Set(
    input.humanReviewQuestionCandidates.map((item) =>
      normalizeCandidateKey(item.question),
    ),
  );
  const allowedChunkIds = new Set(input.allowedChunkIds);
  for (let index = 0; index < output.humanReviewQuestions.length; index += 1) {
    const question = output.humanReviewQuestions[index]!;
    if (!allowedQuestions.has(normalizeCandidateKey(question.question))) {
      return `humanReviewQuestions[${index}].question was not present in candidates`;
    }
    for (const chunkId of question.relatedChunkIds ?? []) {
      if (!allowedChunkIds.has(chunkId)) {
        return `humanReviewQuestions[${index}].relatedChunkIds contains unknown chunk id: ${chunkId}`;
      }
    }
  }

  if (output.missing.length > input.missingCandidates.length) {
    return 'missing output must not be longer than missingCandidates';
  }
  if (
    output.humanReviewQuestions.length >
    input.humanReviewQuestionCandidates.length
  ) {
    return 'humanReviewQuestions output must not be longer than candidates';
  }
  return undefined;
}

export const strategistReduceFlow = ai.defineFlow(
  {
    name: 'strategistReduceFlow',
    inputSchema: StrategistReduceInputSchema,
    outputSchema: StrategistReduceOutputSchema,
  },
  async (input): Promise<StrategistReduceOutput> =>
    generateValidated<StrategistReduceOutput>({
      label: 'Strategist reducer',
      system: STRATEGIST_REDUCE_SYSTEM_PROMPT,
      prompt: buildReducePrompt(input),
      coreSchema: StrategistReduceOutputCoreSchema,
      validate: (output) => {
        const parsed = StrategistReduceOutputSchema.safeParse(output);
        if (!parsed.success) {
          return { success: false, error: { message: parsed.error.message } };
        }
        const message = reduceOutputValidationMessage(input, parsed.data);
        if (message !== undefined) {
          return { success: false, error: { message } };
        }
        return { success: true, data: parsed.data };
      },
      includeBareJsonFallback: true,
    }),
);

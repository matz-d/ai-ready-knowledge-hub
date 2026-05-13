import { z } from 'zod';
import {
  BusinessDomainEnum,
  DocumentTypeEnum,
  FreshnessEnum,
} from '../curator/schema';
import { KnowledgeChunkSchema } from '../../lib/knowledgeChunkSchema';

/**
 * Strategist 出力スキーマ（Phase 3-C-1 正本）。
 *
 * パイプライン全体像:
 *
 *   KnowledgeChunk
 *      ↓
 *   deterministic safety gate    ← LLM ではなくルールで切る
 *      - Sensitivity === 'Restricted'
 *      - AiUsePolicy === 'blocked'
 *      - AiUsePolicy === 'requires_masking' だが maskedText なし
 *      - clientScope の不一致 (他顧客の機密)
 *      ↓
 *   Strategist (Gemini)          ← 安全な chunk + 親 Inventory メタのみ受け取る
 *      - purpose match
 *      - freshness / superseded
 *      - relevance / evidence quality
 *      - missing info
 *      - human review questions
 *      ↓
 *   StrategistOutput (このスキーマ)
 *      - excluded には safety_gate と strategist の両方の理由が混在
 *      - prompt 側で「safety_gate が除外した chunk は Strategist が覆してはいけない」
 *        と明記する
 *
 * 出力4ブロック (CLAUDE.md の製品コンセプトに対応):
 *   1. included            — このPurposeに「使える」chunk
 *   2. excluded            — このPurposeでは「除外すべき」chunk + 理由(分類)
 *   3. missing             — Purpose達成に「足りない情報」
 *   4. humanReviewQuestions— 人間に確認すべき質問
 *
 * このファイルは prompt / UI / eval / AuditEvent の単一情報源。
 * enum の表記揺れを増やしてはいけない。
 */

// ---------------------------------------------------------------------------
// ExclusionReasonEnum — 除外理由の正本 taxonomy
// ---------------------------------------------------------------------------
//
// 7項目の stable ID (machine-readable 英語)。AuditEvent / UI集計 / 多言語化 を
// 考えて表示ラベルは ExclusionReasonLabels に分離する。
//
// 生産元の2系統 (ExclusionReasonOrigin で明示):
//   (A) deterministic safety gate — Strategist より前で決定論的にゲートする
//       - restricted_sensitivity
//       - masking_required_unavailable
//       - cross_customer_confidentiality
//   (B) Strategist (LLM判断)      — 安全な chunk について目的整合性を判定する
//       - superseded_or_stale
//       - purpose_mismatch
//       - insufficient_evidence_quality
//       - human_confirmation_required
//
// 設計判断ログ:
//   - 「個人情報を含む」を単独理由にしない。個人情報はマスクで使えるケースがあり
//      Masker の存在意義と矛盾する。restricted_sensitivity または
//      masking_required_unavailable に寄せる。
//   - cross_customer_confidentiality は士業SME特有の「A社向け判断がB社のAI活用に
//      混入する危険」を表現する差別化軸。単純なPII検知では捉えられない。
export const ExclusionReasonEnum = z.enum([
  'restricted_sensitivity',
  'masking_required_unavailable',
  'cross_customer_confidentiality',
  'superseded_or_stale',
  'purpose_mismatch',
  'insufficient_evidence_quality',
  'human_confirmation_required',
]);

/** 表示ラベル（UI / Markdown export 用、UI言語切替時に差し替え可能） */
export const ExclusionReasonLabels = {
  restricted_sensitivity: 'Restricted 情報',
  masking_required_unavailable: 'マスク済み版なし',
  cross_customer_confidentiality: '他顧客・第三者の機密',
  superseded_or_stale: '古い／上書き候補',
  purpose_mismatch: '目的不一致',
  insufficient_evidence_quality: '根拠品質不足',
  human_confirmation_required: '人間確認が必要',
} as const satisfies Record<z.infer<typeof ExclusionReasonEnum>, string>;

/**
 * 除外理由の生産元。
 * Strategist の出力検証で「LLM が safety_gate 系の理由を返してはいけない」を
 * 強制するために使う。AuditEvent でも origin を分けて集計する。
 */
export const ExclusionReasonOrigin = {
  restricted_sensitivity: 'safety_gate',
  masking_required_unavailable: 'safety_gate',
  cross_customer_confidentiality: 'safety_gate',
  superseded_or_stale: 'strategist',
  purpose_mismatch: 'strategist',
  insufficient_evidence_quality: 'strategist',
  human_confirmation_required: 'strategist',
} as const satisfies Record<z.infer<typeof ExclusionReasonEnum>, 'safety_gate' | 'strategist'>;

export type ExclusionReasonOriginType = 'safety_gate' | 'strategist';

/** Strategist (LLM) が出力してよい除外理由のサブセット */
export const StrategistAllowedExclusionReasons = (
  Object.entries(ExclusionReasonOrigin) as [
    z.infer<typeof ExclusionReasonEnum>,
    ExclusionReasonOriginType,
  ][]
)
  .filter(([, origin]) => origin === 'strategist')
  .map(([reason]) => reason);

// ---------------------------------------------------------------------------
// 以下は contracts (これは私が固定で書きます)
// ---------------------------------------------------------------------------

/** 個別 chunk への参照（include/exclude 共通） */
const ChunkRefBaseSchema = z.object({
  docId: z.string().min(1),
  chunkId: z.string().min(1),
  /** AIの判断根拠（自由記述、prompt が必ず埋める） */
  rationale: z.string().min(1).max(400),
});

/** 採用された chunk */
export const IncludedChunkRefSchema = ChunkRefBaseSchema.extend({
  /** 0.0〜1.0: AIが「このPurposeに本当に使えるか」の自信度 */
  confidence: z.number().min(0).max(1),
});

/** 除外された chunk */
export const ExcludedChunkRefSchema = ChunkRefBaseSchema.extend({
  reason: ExclusionReasonEnum,
});

/** 足りない情報の項目 */
export const MissingInfoSchema = z.object({
  /** 何が足りないかの短いラベル（例:「直近12ヶ月の助成金支給実績」） */
  topic: z.string().min(1).max(120),
  /** なぜそれが必要か（Purpose との関係） */
  whyNeeded: z.string().min(1).max(400),
  /** 探す場所のヒント（任意） */
  whereToLookHint: z.string().max(200).optional(),
});

/** 人間への確認質問 */
export const HumanReviewQuestionSchema = z.object({
  question: z.string().min(1).max(400),
  /** どの chunk についての質問か（任意、全体への質問の場合は省略） */
  relatedChunkIds: z.array(z.string()).optional(),
});

/**
 * Prompt / LLM 専用: 親 Knowledge Inventory（Firestore document）から Strategist が
 * 鮮度・上書き候補・領域整合を判断するために必要な最小メタデータ。
 * orchestrator は chunk.docId に対応する Inventory 行から埋める。
 */
export const StrategistParentInventoryMetadataSchema = z.object({
  /** chunk.docId と一致させること（{@link StrategistChunkInputSchema} で検証） */
  docId: z.string().min(1),
  fileName: z.string().min(1),
  documentType: DocumentTypeEnum.nullable(),
  businessDomain: BusinessDomainEnum.nullable(),
  freshness: FreshnessEnum.nullable(),
  isAuthoritativeCandidate: z.boolean().nullable(),
  /** 親ドキュメントの更新時刻（ISO 8601）。Inventory の updatedAt を文字列化して渡す */
  updatedAt: z.string().min(1),
});

/**
 * 1 chunk とその親メタの組。`superseded_or_stale` 等の判断材料を入力に含めるための正本。
 */
export const StrategistChunkInputSchema = z
  .object({
    chunk: KnowledgeChunkSchema,
    parent: StrategistParentInventoryMetadataSchema,
  })
  .superRefine((value, ctx) => {
    if (value.parent.docId !== value.chunk.docId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parent', 'docId'],
        message: 'parent.docId must equal chunk.docId',
      });
    }
  });

/**
 * Strategist 入力。
 * `chunkInputs` は **safety gate 通過後** の chunk のみ。Strategist は安全性判定をしない。
 */
export const StrategistInputSchema = z.object({
  purpose: z.string().min(1).max(2000),
  chunkInputs: z.array(StrategistChunkInputSchema).min(1),
  /** safety gate が落とした件数。Strategist の判断には影響しないが prompt の文脈に使う */
  safetyExcludedCount: z.number().int().nonnegative().default(0),
});

/** Strategist 出力全体 */
export const StrategistOutputSchema = z
  .object({
    included: z.array(IncludedChunkRefSchema),
    excluded: z.array(ExcludedChunkRefSchema),
    missing: z.array(MissingInfoSchema),
    humanReviewQuestions: z.array(HumanReviewQuestionSchema),
  })
  /**
   * Strategist (LLM) は safety_gate 由来の除外理由を出力してはいけない。
   * prompt で禁止したうえで、ここでも schema レベルで二重に縛る。
   * safety_gate の除外結果は orchestrator が後段でマージする。
   */
  .superRefine((value, ctx) => {
    const chunkRefKey = (docId: string, chunkId: string) => `${docId}\u0000${chunkId}`;

    const reportDup = (
      side: 'included' | 'excluded',
      index: number,
      message: string,
    ) => {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [side, index, 'chunkId'],
        message,
      });
    };

    const seenIncluded = new Map<string, number>();
    value.included.forEach((row, index) => {
      const key = chunkRefKey(row.docId, row.chunkId);
      const first = seenIncluded.get(key);
      if (first !== undefined) {
        reportDup(
          'included',
          index,
          `duplicate chunk ref (docId + chunkId) also at included[${first}]`,
        );
      } else {
        seenIncluded.set(key, index);
      }
    });

    const seenExcluded = new Map<string, number>();
    value.excluded.forEach((row, index) => {
      const key = chunkRefKey(row.docId, row.chunkId);
      const first = seenExcluded.get(key);
      if (first !== undefined) {
        reportDup(
          'excluded',
          index,
          `duplicate chunk ref (docId + chunkId) also at excluded[${first}]`,
        );
      } else {
        seenExcluded.set(key, index);
      }
      if (seenIncluded.has(key)) {
        reportDup(
          'excluded',
          index,
          'chunk ref must not appear in both included and excluded',
        );
      }
    });

    value.excluded.forEach((excluded, index) => {
      if (ExclusionReasonOrigin[excluded.reason] !== 'strategist') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['excluded', index, 'reason'],
          message: `Strategist must not emit safety_gate-origin reason: ${excluded.reason}`,
        });
      }
    });
  });

// ---------------------------------------------------------------------------
// 型エクスポート
// ---------------------------------------------------------------------------

export type ExclusionReason = z.infer<typeof ExclusionReasonEnum>;
export type ExclusionReasonLabel = (typeof ExclusionReasonLabels)[ExclusionReason];
export type IncludedChunkRef = z.infer<typeof IncludedChunkRefSchema>;
export type ExcludedChunkRef = z.infer<typeof ExcludedChunkRefSchema>;
export type MissingInfo = z.infer<typeof MissingInfoSchema>;
export type HumanReviewQuestion = z.infer<typeof HumanReviewQuestionSchema>;
export type StrategistParentInventoryMetadata = z.infer<
  typeof StrategistParentInventoryMetadataSchema
>;
export type StrategistChunkInput = z.infer<typeof StrategistChunkInputSchema>;
export type StrategistInput = z.infer<typeof StrategistInputSchema>;
export type StrategistOutput = z.infer<typeof StrategistOutputSchema>;

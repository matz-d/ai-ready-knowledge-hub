/**
 * `context_package_jobs` — Context Package 生成の非同期 job（R10）
 *
 * `POST /api/context-package` が同期で返しきれない重い入力に対して、job を
 * Firestore に永続化し Cloud Tasks 経由で worker が実行する。状態遷移は
 * `queued → running → succeeded | failed`（+ `cancelled`）の一方向のみ。
 *
 * 設計の正本: docs/open-questions.md R10。
 */
import { z } from 'zod';

export const CONTEXT_PACKAGE_JOBS_COLLECTION = 'context_package_jobs';

/** 一方向の状態遷移。worker のリトライで二重実行されても壊れないよう、
 *  `running` への昇格は「現状 `queued` のときだけ」に限定する（firestoreAdapter 側で担保）。 */
export type ContextPackageJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

/** caller 由来のリクエスト。tenant / actor は同期経路と同じ `auditActorFromRequest` から取る。 */
export type ContextPackageJobRequest = {
  purpose: string;
  limit: number;
  docIds?: string[];
  tenantId: string;
  actor: {
    userId: string;
    ipAddress: string;
    userAgent: string;
  };
};

/** 実行中・完了時の観測用メタデータ（UI のポーリング表示に使う）。 */
export type ContextPackageJobProgress = {
  sourceDocumentsReviewed?: number;
  safeChunks?: number;
  budgetDroppedChunks?: number;
};

/** 失敗時の機械可読コード。再実行可否の判定材料にする。 */
export type ContextPackageJobErrorCode =
  | 'no_inventory_documents'
  | 'no_knowledge_chunks'
  | 'unknown_doc_ids'
  | 'non_terminal_doc_ids'
  | 'result_too_large'
  | 'enqueue_failed'
  | 'upstream_failure';

export type ContextPackageJobError = {
  code: ContextPackageJobErrorCode;
  message: string;
  /** docId 解決失敗など、UI に出すための追加コンテキスト（任意）。 */
  details?: unknown;
};

/**
 * 完了 job が保持する Context Package payload。
 *
 * 同期経路 `POST /api/context-package` のレスポンス本文と同型（`markdown` と
 * projection 済み chunk view のみ。raw chunk.text は含めない）。Firestore の
 * 1MB doc 上限に収めるため、runner 側でサイズガードする。
 */
export type ContextPackageJobResult = Record<string, unknown>;

export type ContextPackageJob = {
  jobId: string;
  status: ContextPackageJobStatus;
  request: ContextPackageJobRequest;
  progress?: ContextPackageJobProgress;
  result?: ContextPackageJobResult;
  error?: ContextPackageJobError;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  /**
   * `running` job の lease 期限（ISO）。worker が claim した時点で `now + lease` を
   * 書き込む。worker がクラッシュ / 予期せぬ例外で lease を解放しないまま落ちても、
   * 期限切れ後は別の Cloud Tasks 試行が再 claim できる（{@link ContextPackageJob} の
   * status を running のまま放置しない安全弁）。
   */
  leaseExpiresAt?: string;
};

/** worker が claim 時に確保する lease の長さ（ms）。20 秒ゲート無しの非同期生成が
 *  現実的に収まる余裕を見て 15 分。期限切れ running は再 claim 可能になる。 */
export const CONTEXT_PACKAGE_JOB_LEASE_MS = 15 * 60 * 1000;

/**
 * Firestore 読み出し後の最小バリデーション。Timestamp は adapter 側で ISO 文字列へ
 * 直してから渡す前提なので、ここでは構造だけを軽く検証する。
 */
export const ContextPackageJobActorSchema = z.object({
  userId: z.string(),
  ipAddress: z.string(),
  userAgent: z.string(),
});

export const ContextPackageJobRequestSchema = z.object({
  purpose: z.string().min(1).max(2000),
  limit: z.number().int().min(1).max(100),
  docIds: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  tenantId: z.string().min(1),
  actor: ContextPackageJobActorSchema,
});

export const CONTEXT_PACKAGE_JOB_STATUSES: ContextPackageJobStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
];

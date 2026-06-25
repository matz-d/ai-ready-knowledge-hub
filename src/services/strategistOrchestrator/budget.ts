import type { KnowledgeChunk } from '../../lib/knowledgeChunkSchema';
import type { StrategistOrchestratorParent } from './types';

/**
 * Pre-LLM input budget for the Strategist orchestrator (Phase 3-M follow-up).
 *
 * Why this exists:
 *   `/api/context-package` 経由で広い候補セットを投げると、safety gate を通った
 *   chunk すべてが Strategist prompt に載り、Vertex Gemini の入力上限
 *   (131,072 tokens) を超えて `INVALID_ARGUMENT` で失敗していた。
 *   `limit` は「Inventory から読む document 数」であり、LLM 投入上限とは別物。
 *   この budget は safety gate の **後**・Strategist 呼び出しの **前** に、
 *   決定論的 (LLM 非依存) に入力サイズを安全側へ絞り込む実 guard。
 *
 * 設計原則:
 *   - 文字数 / 件数ベースの決定論的 budget をまず満たす（token 推定は補助情報）。
 *   - Purpose との関連度で事前選別し、落とすなら関連度の低いものから落とす。
 *   - `requires_masking` chunk は scoring でも raw `text` を読まない（maskedText のみ）。
 *   - 落とした件数は呼び出し側から観測できる形で返す（{@link StrategistInputBudgetReport}）。
 */

export type StrategistInputBudgetConfig = {
  /** Strategist へ渡してよい distinct document 数の上限 */
  maxDocuments: number;
  /** Strategist へ渡してよい chunk 総数の上限 */
  maxChunks: number;
  /** prompt 本体に載る推定文字数の総量上限（安全側） */
  maxTotalPromptChars: number;
  /** 1 chunk 本文の prompt 投入文字数上限（prompt.ts の truncate と一致させる） */
  maxCharsPerChunk: number;
};

/**
 * 既定 budget。`maxCharsPerChunk` は `prompt.ts#formatChunkInputForPrompt` の
 * 1200 文字 truncate と一致させること（ここを変える場合は両方そろえる）。
 * `maxTotalPromptChars` は sync target (20s) を満たすための主 guard として調整する。
 *
 * `maxDocuments` は ingest 側の一括アップロード上限（最大 20 件）に合わせている。
 * これにより 20 件まとめて投入した corpus が 1 回の同期 Context Package に
 * 全件出現し得る。prompt の実サイズは `maxTotalPromptChars` / `maxChunks` で
 * 別途上限がかかるため、この値を上げても 1 回のプロンプト長やレイテンシは増えない
 * （広さは増えるが、件数が増えるほど 1 文書あたりの chunk は薄くなる）。
 */
export const DEFAULT_STRATEGIST_INPUT_BUDGET: StrategistInputBudgetConfig = {
  maxDocuments: 20,
  maxChunks: 80,
  maxTotalPromptChars: 45_000,
  maxCharsPerChunk: 1_200,
};

/** 1 chunk あたりの親メタ・フィールド行など本文以外の prompt オーバーヘッド推定 */
const PROMPT_CHUNK_OVERHEAD_CHARS = 512;

/**
 * 文字数からの token 推定（補助情報）。
 * 日本語/英語混在では tokenizer により 1 char ≒ 0.5〜1 token。
 * guard 自体は文字数ベースなので、ここは安全側（やや多め）に見積もる。
 */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 2);
}

export type BudgetCandidate = {
  chunk: KnowledgeChunk;
  parent: StrategistOrchestratorParent;
};

export type StrategistInputBudgetReport = {
  config: StrategistInputBudgetConfig;
  /** budget 適用前の safe chunk 総数 */
  totalCandidates: number;
  /** budget を通過し Strategist へ渡す chunk 数 */
  keptChunks: number;
  /** budget で落とした chunk 数（観測用: `budgetDroppedCount`） */
  droppedChunks: number;
  /** 通過 chunk が属する distinct document 数 */
  keptDocuments: number;
  /** 通過 chunk の推定 prompt 文字数合計 */
  estimatedPromptChars: number;
  /** 通過 chunk の推定 prompt token 合計（補助情報） */
  estimatedPromptTokens: number;
};

/**
 * budget で落とした safe chunk の文書別内訳。
 * downstream（result / markdown / UI）に truncation を明示するために返す。
 */
export type BudgetDroppedDocument = {
  docId: string;
  fileName: string;
  /** その文書で落とした chunk 数 */
  droppedChunks: number;
};

export type StrategistInputBudgetResult = {
  /** Strategist へ渡す chunk（入力順を保持） */
  kept: KnowledgeChunk[];
  report: StrategistInputBudgetReport;
  /**
   * budget で落とした chunk の文書別内訳（入力順。空なら truncation なし）。
   * 「全件レビュー済み」と誤認させないため、落とした事実を構造化して残す。
   */
  droppedDocuments: BudgetDroppedDocument[];
};

/**
 * scoring / 文字量推定に使ってよいテキスト。
 *
 * 防御の第4層: `requires_masking` の chunk は **絶対に** raw `text` を読まない。
 * safety gate が maskedText 無しの requires_masking を落とすので通常は maskedText が
 * 存在するが、万一欠落していても raw text にフォールバックせず空文字を返す。
 */
export function scoringTextForChunk(chunk: KnowledgeChunk): string {
  if (chunk.aiUsePolicy === 'requires_masking') {
    return chunk.maskedText ?? '';
  }
  return chunk.maskedText ?? chunk.text;
}

const CJK_RUN_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu;
const MAX_PURPOSE_TERMS = 128;

function cjkSubterms(term: string): string[] {
  const subterms: string[] = [];
  const cjkRuns = term.match(CJK_RUN_PATTERN) ?? [];
  for (const run of cjkRuns) {
    for (let start = 0; start < run.length; start += 1) {
      for (let length = 2; length <= 6 && start + length <= run.length; length += 1) {
        subterms.push(run.slice(start, start + length));
      }
    }
  }
  return subterms;
}

/**
 * Purpose を簡易トークンに分解する（決定論的）。
 * 空白・句読点・記号で分割した語に加え、日本語の連続語は短い n-gram に展開する。
 * これにより「月次の給与計算業務...」から `給与計算` などを拾い、budget 選別で
 * 関連文書が後回しにならないようにする。
 */
export function purposeTerms(purpose: string): string[] {
  const raw = purpose
    .toLowerCase()
    .split(/[\s、。,.\/・:;：；（）()「」『』\[\]{}<>"'`!?！？\-_=+|~@#$%^&*]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
  return Array.from(new Set(raw.flatMap((term) => [term, ...cjkSubterms(term)]))).slice(
    0,
    MAX_PURPOSE_TERMS,
  );
}

/** 指定テキスト内に出現する purpose term の数（重複 term はカウントしない） */
function termHitCount(text: string | null | undefined, terms: string[]): number {
  if (!text) {
    return 0;
  }
  const haystack = text.toLowerCase();
  let hits = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      hits += 1;
    }
  }
  return hits;
}

/**
 * Purpose との事前関連度スコア（高いほど優先して残す）。
 *
 * 入力に使ってよいフィールド:
 *   - chunk 本文: {@link scoringTextForChunk}（requires_masking は maskedText のみ）
 *   - chunk.title
 *   - parent.businessDomain / parent.documentType
 *   - parent.freshness === 'current'
 *   - parent.isAuthoritativeCandidate === true
 *   - parent.updatedAt（新しいほど僅かに加点）
 *
 * NOTE(weights): ここの重み付けは「どの根拠を優先して LLM に渡すか」という
 * プロダクト判断。下の {@link RELEVANCE_WEIGHTS} を調整すると挙動が変わる。
 */
export const RELEVANCE_WEIGHTS = {
  /** 本文に purpose term が出るごとの加点 */
  bodyTermHit: 3,
  /** title に purpose term が出るごとの加点（本文より強い意図表明） */
  titleTermHit: 4,
  /** businessDomain に purpose term が出るごとの加点 */
  businessDomainTermHit: 2,
  /** documentType に purpose term が出るごとの加点 */
  documentTypeTermHit: 2,
  /** freshness === 'current' の加点 */
  freshnessCurrent: 3,
  /** isAuthoritativeCandidate === true の加点 */
  authoritative: 2,
  /** updatedAt の新しさによる最大加点（0〜この値の範囲でスケール） */
  recencyMax: 2,
} as const;

/** recency 加点の基準窓（これより新しいと満点、古いほど 0 に近づく） */
const RECENCY_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

function recencyScore(updatedAt: string | undefined, now: number): number {
  if (!updatedAt) {
    return 0;
  }
  const ts = Date.parse(updatedAt);
  if (Number.isNaN(ts)) {
    return 0;
  }
  const ageMs = Math.max(0, now - ts);
  const freshnessRatio = Math.max(0, 1 - ageMs / RECENCY_WINDOW_MS);
  return freshnessRatio * RELEVANCE_WEIGHTS.recencyMax;
}

export function scoreCandidateForPurpose(
  candidate: BudgetCandidate,
  terms: string[],
  now: number = Date.now(),
): number {
  const { chunk, parent } = candidate;
  let score = 0;

  score += termHitCount(scoringTextForChunk(chunk), terms) * RELEVANCE_WEIGHTS.bodyTermHit;
  score += termHitCount(chunk.title, terms) * RELEVANCE_WEIGHTS.titleTermHit;
  score +=
    termHitCount(parent.businessDomain, terms) * RELEVANCE_WEIGHTS.businessDomainTermHit;
  score +=
    termHitCount(parent.documentType, terms) * RELEVANCE_WEIGHTS.documentTypeTermHit;

  if (parent.freshness === 'current') {
    score += RELEVANCE_WEIGHTS.freshnessCurrent;
  }
  if (parent.isAuthoritativeCandidate === true) {
    score += RELEVANCE_WEIGHTS.authoritative;
  }
  score += recencyScore(parent.updatedAt, now);

  return score;
}

/** prompt に載る 1 chunk あたりの推定文字数（本文 truncate + メタ行オーバーヘッド） */
export function estimatePromptCharsForChunk(
  chunk: KnowledgeChunk,
  maxCharsPerChunk: number,
): number {
  const body = scoringTextForChunk(chunk);
  const bodyChars = Math.min(body.length, maxCharsPerChunk);
  return bodyChars + PROMPT_CHUNK_OVERHEAD_CHARS;
}

/**
 * Strategist input budget の admission 判定に使う累積状態。
 * sync budget (`applyStrategistInputBudget`) と async batch (`partitionStrategistBatches`)
 * が同じ契約を共有するための共通 shape。
 */
export type BudgetAdmissionAccumulator = {
  chunkCount: number;
  docIds: Set<string>;
  totalChars: number;
};

export function emptyBudgetAdmissionAccumulator(): BudgetAdmissionAccumulator {
  return { chunkCount: 0, docIds: new Set(), totalChars: 0 };
}

export type BudgetAdmissionOptions = {
  /**
   * true（既定）: accumulator が空のとき 1 chunk 目は maxTotalPromptChars を超えても通す。
   * false: 文書丸ごと fit 判定など、厳密な総量上限を使う。
   */
  allowFirstChunkCharOverflow?: boolean;
};

/**
 * 1 chunk を既存 accumulator に追加してよいか（決定論的 admission predicate）。
 *
 * - maxChunks / maxDocuments / maxTotalPromptChars を解釈する単一の正本。
 * - 既定では最初の 1 chunk は maxTotalPromptChars を超えても通す（巨大 chunk 1 件の特例）。
 */
export function chunkAdmitsToBudget(
  accumulator: BudgetAdmissionAccumulator,
  candidate: BudgetCandidate,
  config: StrategistInputBudgetConfig,
  options: BudgetAdmissionOptions = {},
): boolean {
  const allowFirstChunkCharOverflow = options.allowFirstChunkCharOverflow ?? true;
  if (accumulator.chunkCount >= config.maxChunks) {
    return false;
  }
  const docId = candidate.chunk.docId;
  const isNewDocument = !accumulator.docIds.has(docId);
  if (isNewDocument && accumulator.docIds.size >= config.maxDocuments) {
    return false;
  }
  const chunkChars = estimatePromptCharsForChunk(
    candidate.chunk,
    config.maxCharsPerChunk,
  );
  const exceedsCharBudget =
    accumulator.totalChars + chunkChars > config.maxTotalPromptChars;
  if (
    exceedsCharBudget &&
    !(allowFirstChunkCharOverflow && accumulator.chunkCount === 0)
  ) {
    return false;
  }
  return true;
}

/** {@link chunkAdmitsToBudget} を通過した chunk を accumulator に反映する。 */
export function admitChunkToBudget(
  accumulator: BudgetAdmissionAccumulator,
  candidate: BudgetCandidate,
  config: StrategistInputBudgetConfig,
): void {
  const chunkChars = estimatePromptCharsForChunk(
    candidate.chunk,
    config.maxCharsPerChunk,
  );
  accumulator.chunkCount += 1;
  accumulator.docIds.add(candidate.chunk.docId);
  accumulator.totalChars += chunkChars;
}

/**
 * 連続する chunk 群をまとめて accumulator に載せられるか。
 * batching の文書単位 fit 判定で使う。
 */
export function chunksAdmitToBudget(
  accumulator: BudgetAdmissionAccumulator,
  candidates: readonly BudgetCandidate[],
  config: StrategistInputBudgetConfig,
  options: BudgetAdmissionOptions = {},
): boolean {
  const simulated: BudgetAdmissionAccumulator = {
    chunkCount: accumulator.chunkCount,
    docIds: new Set(accumulator.docIds),
    totalChars: accumulator.totalChars,
  };
  for (const candidate of candidates) {
    if (!chunkAdmitsToBudget(simulated, candidate, config, options)) {
      return false;
    }
    admitChunkToBudget(simulated, candidate, config);
  }
  return true;
}

/**
 * candidate 列が budget 契約を満たすか（テスト・検証用の shared contract）。
 * 空 batch は常に true。
 */
export function batchSatisfiesBudgetContract(
  candidates: readonly BudgetCandidate[],
  config: StrategistInputBudgetConfig,
): boolean {
  const accumulator = emptyBudgetAdmissionAccumulator();
  for (const candidate of candidates) {
    if (!chunkAdmitsToBudget(accumulator, candidate, config)) {
      return false;
    }
    admitChunkToBudget(accumulator, candidate, config);
  }
  return true;
}

/**
 * safety gate 通過済みの候補に pre-LLM budget を適用する。
 *
 * 手順:
 *   1. Purpose 関連度でスコアリングし、降順に並べる（同点は元の順序を保つ stable sort）。
 *   2. 上から greedy に採用しつつ、maxChunks / maxDocuments / maxTotalPromptChars を超えない。
 *   3. 採用した chunk を **入力順** に並べ直して返す（既存の出力順序を壊さない）。
 *
 * 採用は関連度順で判定するが、返却は入力順。これにより「何を残すか」は関連度で、
 * 「どう並べるか」は決定論的な入力順で安定する。
 */
export function applyStrategistInputBudget(
  candidates: BudgetCandidate[],
  purpose: string,
  config: StrategistInputBudgetConfig = DEFAULT_STRATEGIST_INPUT_BUDGET,
): StrategistInputBudgetResult {
  const terms = purposeTerms(purpose);
  const now = Date.now();

  // 元の順序を保持しつつ score を付与
  const ranked = candidates.map((candidate, index) => ({
    candidate,
    index,
    score: scoreCandidateForPurpose(candidate, terms, now),
  }));

  // score 降順、同点は元順序（index 昇順）で安定ソート
  ranked.sort((a, b) => (b.score - a.score) || (a.index - b.index));

  const acceptedIndices = new Set<number>();
  const accumulator = emptyBudgetAdmissionAccumulator();

  for (const row of ranked) {
    if (acceptedIndices.size >= config.maxChunks) {
      break;
    }
    if (!chunkAdmitsToBudget(accumulator, row.candidate, config)) {
      continue;
    }
    acceptedIndices.add(row.index);
    admitChunkToBudget(accumulator, row.candidate, config);
  }

  // 入力順に並べ直して返す
  const kept = candidates
    .filter((_, index) => acceptedIndices.has(index))
    .map((candidate) => candidate.chunk);

  // 落とした chunk を文書別に集計（入力順を保持）。truncation の可視化に使う。
  const droppedByDoc = new Map<string, BudgetDroppedDocument>();
  candidates.forEach((candidate, index) => {
    if (acceptedIndices.has(index)) {
      return;
    }
    const { docId } = candidate.chunk;
    const existing = droppedByDoc.get(docId);
    if (existing) {
      existing.droppedChunks += 1;
    } else {
      droppedByDoc.set(docId, {
        docId,
        fileName: candidate.parent.fileName,
        droppedChunks: 1,
      });
    }
  });

  return {
    kept,
    droppedDocuments: Array.from(droppedByDoc.values()),
    report: {
      config,
      totalCandidates: candidates.length,
      keptChunks: kept.length,
      droppedChunks: candidates.length - kept.length,
      keptDocuments: accumulator.docIds.size,
      estimatedPromptChars: accumulator.totalChars,
      estimatedPromptTokens: estimateTokensFromChars(accumulator.totalChars),
    },
  };
}

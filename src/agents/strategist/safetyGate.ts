import type { KnowledgeChunk } from '../../lib/knowledgeChunkSchema';
import {
  ExclusionReasonOrigin,
  type ExcludedChunkRef,
  type ExclusionReason,
} from './schema';

/**
 * Strategist の前段に置く決定論的 safety gate。
 *
 * 設計原則:
 *   - LLM ではなくルールで判定する。prompt の調子に依存しない。
 *   - safety_gate の責務は「危険なものを Strategist に渡さない」だけ。
 *     目的整合性・鮮度・品質の判定は Strategist 側。
 *   - 出力する除外理由は ExclusionReasonOrigin が 'safety_gate' のものに限る。
 *
 * 判定ルール (順序が大事: 重い理由から先に判定):
 *   1. sensitivity === 'Restricted'                          → restricted_sensitivity
 *   2. aiUsePolicy === 'blocked'                             → restricted_sensitivity
 *      (Curator の AiUsePolicy 仕様では Restricted ⇔ blocked が連動するが
 *       両方を独立にチェックして二重防御にする)
 *   3. aiUsePolicy === 'requires_masking' かつ 実質的な maskedText なし（未設定・空・空白のみ） → masking_required_unavailable
 *      (Confidential はマスク済み版でのみ Strategist に渡せる)
 *   4. crossCustomerDetector(chunk, ctx) が true               → cross_customer_confidentiality
 *      (Phase 3-C-1 時点では Inventory に clientScope 概念がないため、
 *       拡張ポイントとして注入可能にし、デフォルトは no-op)
 */

export interface SafetyGateContext {
  /** Purpose 文字列。将来 detector が purpose の clientScope を参照できるよう渡す */
  purpose: string;
}

export interface SafetyGateResult {
  /** Strategist に渡してよい chunk */
  safe: KnowledgeChunk[];
  /** safety gate が除外した chunk + 理由 */
  excluded: ExcludedChunkRef[];
}

/**
 * 他顧客機密の検出ロジック。Inventory に clientScope が入った Phase 3-C-x で実装する。
 * デフォルトは常に false（拡張点として注入する）。
 */
export type CrossCustomerDetector = (
  chunk: KnowledgeChunk,
  ctx: SafetyGateContext,
) => boolean;

const defaultCrossCustomerDetector: CrossCustomerDetector = () => false;

export interface SafetyGateOptions {
  crossCustomerDetector?: CrossCustomerDetector;
}

export function runSafetyGate(
  chunks: readonly KnowledgeChunk[],
  ctx: SafetyGateContext,
  options: SafetyGateOptions = {},
): SafetyGateResult {
  const detector = options.crossCustomerDetector ?? defaultCrossCustomerDetector;

  const safe: KnowledgeChunk[] = [];
  const excluded: ExcludedChunkRef[] = [];

  for (const chunk of chunks) {
    const reason = decideExclusionReason(chunk, ctx, detector);
    if (reason === null) {
      safe.push(chunk);
      continue;
    }
    excluded.push({
      docId: chunk.docId,
      chunkId: chunk.id,
      rationale: buildRationale(reason, chunk),
      reason,
    });
  }

  // 内部整合性: safety gate は safety_gate 由来の理由しか出力してはいけない。
  // バグで他の reason が混入したら起動時に落とす。
  for (const entry of excluded) {
    if (ExclusionReasonOrigin[entry.reason] !== 'safety_gate') {
      throw new Error(
        `safetyGate emitted non-safety_gate-origin reason: ${entry.reason}`,
      );
    }
  }

  return { safe, excluded };
}

function decideExclusionReason(
  chunk: KnowledgeChunk,
  ctx: SafetyGateContext,
  detector: CrossCustomerDetector,
): ExclusionReason | null {
  if (chunk.sensitivity === 'Restricted') {
    return 'restricted_sensitivity';
  }
  if (chunk.aiUsePolicy === 'blocked') {
    return 'restricted_sensitivity';
  }
  if (chunk.aiUsePolicy === 'requires_masking' && !chunk.maskedText?.trim()) {
    return 'masking_required_unavailable';
  }
  if (detector(chunk, ctx)) {
    return 'cross_customer_confidentiality';
  }
  return null;
}

function buildRationale(reason: ExclusionReason, chunk: KnowledgeChunk): string {
  switch (reason) {
    case 'restricted_sensitivity':
      return `safety gate: sensitivity=${chunk.sensitivity}, aiUsePolicy=${chunk.aiUsePolicy}`;
    case 'masking_required_unavailable':
      return `safety gate: aiUsePolicy=requires_masking だが maskedText が未生成`;
    case 'cross_customer_confidentiality':
      return `safety gate: 他顧客スコープの機密と判定`;
    default:
      // safety_gate origin の reason が増えた時はここに case を追加する。
      // 呼び出し側の整合性チェックでこの分岐に来る前に throw されるが、
      // 念のため明示的に落とす。
      throw new Error(`unhandled safety_gate reason in buildRationale: ${reason}`);
  }
}

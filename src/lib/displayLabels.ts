import type { AiUsePolicy, Sensitivity } from '../agents/curator/schema';
import type { FirestoreDocumentStatus } from './firestoreSchema';

/**
 * 内部 enum 値の画面表示ラベル辞書。
 *
 * Firestore / schema 上の値（CSS class の分岐キー含む）は変えず、
 * 利用者に見える文言だけここで日本語へ変換する。`Record` の網羅性で
 * enum 追加時にラベル漏れをコンパイルエラーにする。
 *
 * 文言の意図: restricted / blocked は「失敗」ではなく、製品が機密を
 * AI 利用から守った結果として表現する（除外は断言）。
 */
export const SENSITIVITY_LABELS: Record<Sensitivity, string> = {
  Public: '公開',
  Internal: '社内限定',
  Confidential: '機密',
  Restricted: '厳重管理',
};

export const AI_USE_POLICY_LABELS: Record<AiUsePolicy, string> = {
  direct: 'そのまま利用可',
  requires_masking: 'マスキングして利用',
  blocked: 'AI利用不可',
};

export const DOCUMENT_STATUS_LABELS: Record<FirestoreDocumentStatus, string> = {
  uploaded: '分類待ち',
  curating: '分類中',
  masking: 'マスキング中',
  curated: '分類済み',
  ai_safe: 'AI利用可',
  restricted: '保護中',
  blocked: 'AI利用不可',
  failed: '処理失敗',
};

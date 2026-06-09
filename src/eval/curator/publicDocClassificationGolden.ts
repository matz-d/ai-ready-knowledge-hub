/**
 * Curator 分類精度 eval（第1トラック: マスキング/分類精度）。
 *
 * 目的: 公開文書（公的機関の様式・モデル等）が curator によって
 * over-restriction（Public のはずが Confidential/Restricted、direct のはずが
 * requires_masking/blocked）されないことを測定する。
 *
 * 背景: 本番 corpus で `mhlw-labor-conditions-notice-general.pdf`（空欄様式）が
 * Public と Restricted の両方に分類される variance が観測された。curator prompt は
 * 「未記入の公開様式は原則 Public/direct」と既に指示済みのため、これは指示欠落では
 * なく LLM の非決定性。本 eval はそのばらつきを数値化し、回帰ゲート化する。
 *
 * 安全性: 対象は公開文書のみ（実 PII を含まない）。Safety Invariant 準拠。
 */
import type { AiUsePolicy, Sensitivity } from '../../agents/curator/schema';

export type DocumentIRBlock = { text?: string };
export type DocumentIRPage = { blocks?: DocumentIRBlock[] };
export type DocumentIR = { pages?: DocumentIRPage[] };

/** DocumentIR の全 block.text を連結して curator 入力テキストを作る。 */
export function extractTextFromDocumentIR(ir: DocumentIR): string {
  return (ir.pages ?? [])
    .flatMap((page) => page.blocks ?? [])
    .map((block) => block.text?.trim() ?? '')
    .filter((text) => text.length > 0)
    .join('\n');
}

/** 公開文書として許容する sensitivity。これ以外は over-restriction。 */
export const PUBLIC_ALLOWED_SENSITIVITIES: readonly Sensitivity[] = [
  'Public',
  'Internal',
];

export type CuratorClassificationResult = {
  sensitivity: Sensitivity;
  aiUsePolicy: AiUsePolicy;
};

/**
 * 公開文書に対する curator 出力が「過剰に締め出された」かを判定する。
 * - sensitivity が Public/Internal 以外（Confidential/Restricted）
 * - または aiUsePolicy が direct 以外（requires_masking/blocked）
 */
export function isOverRestrictedForPublicDoc(
  result: CuratorClassificationResult
): boolean {
  return (
    !PUBLIC_ALLOWED_SENSITIVITIES.includes(result.sensitivity) ||
    result.aiUsePolicy !== 'direct'
  );
}

export type PublicDocGoldenFixture = {
  id: string;
  fileName: string;
  /** repo ルートからの相対パス（DocumentIR JSON）。 */
  irPath: string;
  note: string;
};

/** IR 付きの公開文書 fixture。すべて Public/direct が期待値。 */
export const PUBLIC_DOC_GOLDEN: readonly PublicDocGoldenFixture[] = [
  {
    id: 'mhlw-labor-conditions-notice-general',
    fileName: 'mhlw-labor-conditions-notice-general.pdf',
    irPath:
      'sample-data/document-conversion/official-doc-pdf/mhlw-labor-conditions-notice-general.document-ir.json',
    note: '厚労省 労働条件通知書モデル様式（空欄）。本番で Restricted 誤分類を観測した実例',
  },
  {
    id: 'mhlw-r07-model-work-rules',
    fileName: 'mhlw-r07-model-work-rules.pdf',
    irPath:
      'sample-data/document-conversion/official-doc-pdf/mhlw-r07-model-work-rules.document-ir.json',
    note: '厚労省 モデル就業規則（令和7年版）。公開テンプレート',
  },
  {
    id: 'mhlw-overtime-limit-guide',
    fileName: 'mhlw-overtime-limit-guide.pdf',
    irPath:
      'sample-data/document-conversion/official-doc-pdf/mhlw-overtime-limit-guide.document-ir.json',
    note: '厚労省 時間外労働の上限規制 解説。一般公開の案内文',
  },
  {
    id: 'nta-withholding-form-blank-scan',
    fileName: 'nta-withholding-form-blank-scan.pdf',
    irPath:
      'sample-data/document-conversion/scan-pdf/nta-withholding-form-blank-scan.document-ir.json',
    note: '国税庁 源泉徴収票ブランク様式（空欄スキャン）',
  },
];

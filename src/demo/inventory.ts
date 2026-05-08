import type {
  BusinessDomain,
  CuratorOutputResult,
  Sensitivity,
} from '../agents/curator/schema';
import type { ResidualRiskOutputResult } from '../agents/masker/schema';
import {
  BusinessDomainEnum,
  SensitivityEnum,
} from '../agents/curator/schema';

/**
 * Knowledge Inventory のデモ用 snapshot。
 *
 * 値は **すべて R5 確定 enum** (`src/agents/curator/schema.ts`) に準拠する。
 * このファイルを直接書き換えるよりも、`npm run inventory:snapshot` で
 * 実 `curatorFlow` の出力から再生成することを推奨する。
 *
 * UI 表示用の日本語ラベルは `src/app/page.tsx` のラベル関数が責務を持ち、
 * このファイルでは「Curator が返したそのままの値」を保持する。
 */
export type InventorySnapshotEntry = CuratorOutputResult & {
  /** 元ファイル名（snapshot 生成元） */
  fileName: string;
  /** sample-data からの相対パス（再現用） */
  sourcePath: string;
  /**
   * Masker residual risk (A8) の評価結果。
   * 評価対象だった文書のみ存在し、`recommendedSensitivity === 'Restricted'`
   * の場合はインベントリ表示で `Restricted` 格上げとして扱う。
   */
  maskerEvaluation?: ResidualRiskOutputResult;
};

/**
 * Curator 判定の effective sensitivity を返す。
 * Masker が `Restricted` を推奨している場合は格上げ後の値を返す。
 */
export function effectiveSensitivity(
  entry: InventorySnapshotEntry
): Sensitivity {
  if (entry.maskerEvaluation?.recommendedSensitivity === 'Restricted') {
    return 'Restricted';
  }
  return entry.sensitivity;
}

/**
 * インベントリ snapshot.
 *
 * **暫定**: PoC w1 (2026-05-08) で `runCuratorAll` を回した出力から
 * 手で構成した近似スナップショット。`npm run inventory:snapshot`
 * を回すと実 LLM 出力で上書きされる。
 *
 * Curator schema に従っているため、enum 値は表記揺れ禁止。
 */
export const accountingOfficeInventory: InventorySnapshotEntry[] = [
  {
    fileName: '顧問契約書テンプレ.md',
    sourcePath: 'sample-data/accounting-office/顧問契約書テンプレ.md',
    documentType: 'テンプレート',
    businessDomain: '顧問契約管理',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    aiUsePolicy: 'direct',
    rationale:
      '雛形のみで固有情報を含まない契約テンプレート。AI参照に直接利用できる。',
  },
  {
    fileName: '顧問契約書_実案件サンプル.txt',
    sourcePath: 'sample-data/accounting-office/顧問契約書_実案件サンプル.txt',
    documentType: '契約書',
    businessDomain: '顧問契約管理',
    sensitivity: 'Confidential',
    freshness: 'current',
    isAuthoritativeCandidate: false,
    aiUsePolicy: 'requires_masking',
    rationale:
      '実案件の契約書。会社名・住所・担当者・顧問料・口座情報など機微情報が複数含まれる。',
    maskerEvaluation: {
      residualRisk: {
        detected: true,
        reasons: [
          'マスク後も契約期間と顧問料が個別案件として再構成可能',
          '担当者役職と所在地の組み合わせで企業を推測可能',
        ],
      },
      recommendedSensitivity: 'Restricted',
      rationale:
        'Masker でマスキングしても契約条件と所在情報の組み合わせから再識別リスクが残るため Restricted に格上げ。',
    },
  },
  {
    fileName: '顧客対応メモ_書式.md',
    sourcePath: 'sample-data/accounting-office/顧客対応メモ_書式.md',
    documentType: 'テンプレート',
    businessDomain: '顧客対応',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    aiUsePolicy: 'direct',
    rationale: '顧客対応の記録書式。固有情報未入力のためそのままAI参照可能。',
  },
  {
    fileName: '顧客対応メモ_匿名化.txt',
    sourcePath: 'sample-data/accounting-office/顧客対応メモ_匿名化.txt',
    documentType: 'メモ',
    businessDomain: '顧客対応',
    sensitivity: 'Confidential',
    freshness: 'current',
    isAuthoritativeCandidate: false,
    aiUsePolicy: 'requires_masking',
    rationale:
      '匿名化済みの相談例。プレースホルダーのみで固有情報が除去されているため AI参照版として保持可能。',
    maskerEvaluation: {
      residualRisk: {
        detected: false,
        reasons: ['具体的な企業名・氏名・金額がプレースホルダー化されている'],
      },
      recommendedSensitivity: 'Confidential',
      rationale:
        '十分にマスクされており、AI参照版として保持できる。Curator 判定 (Confidential) を維持。',
    },
  },
  {
    fileName: '給与計算チェックリスト.md',
    sourcePath: 'sample-data/accounting-office/給与計算チェックリスト.md',
    documentType: 'チェックリスト',
    businessDomain: '給与計算',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    aiUsePolicy: 'direct',
    rationale: '月次給与計算の基本手順。現行版で固有情報を含まない。',
  },
  {
    fileName: '給与計算_例外対応メモ.txt',
    sourcePath: 'sample-data/accounting-office/給与計算_例外対応メモ.txt',
    documentType: 'メモ',
    businessDomain: '給与計算',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: false,
    aiUsePolicy: 'direct',
    rationale:
      '例外対応の論点をまとめた社内メモ。最新料率や顧問先別ルールは別途確認が必要。',
  },
  {
    fileName: '就業規則テンプレート.md',
    sourcePath: 'sample-data/accounting-office/就業規則テンプレート.md',
    documentType: '規程',
    businessDomain: '就業規則',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    aiUsePolicy: 'direct',
    rationale: '汎用就業規則テンプレート。会社固有事情を入れる前の参照資料。',
  },
  {
    fileName: '年末調整_案内文.txt',
    sourcePath: 'sample-data/accounting-office/年末調整_案内文.txt',
    documentType: '案内文',
    businessDomain: '年末調整',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    aiUsePolicy: 'direct',
    rationale: '顧客向け年末調整案内文。現行年度の提出物と期限を含む。',
  },
  {
    fileName: '料金表_2026.csv',
    sourcePath: 'sample-data/accounting-office/料金表_2026.csv',
    documentType: '表',
    businessDomain: '料金管理',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    aiUsePolicy: 'direct',
    rationale: '現行の料金表。旧版との差分判定で正本となる。',
  },
  {
    fileName: '古い料金表_2023.csv',
    sourcePath: 'sample-data/accounting-office/古い料金表_2023.csv',
    documentType: '表',
    businessDomain: '料金管理',
    sensitivity: 'Internal',
    freshness: 'superseded_candidate',
    isAuthoritativeCandidate: false,
    aiUsePolicy: 'direct',
    rationale: '2023年版の旧料金表。現行価格の根拠としては利用しない。',
  },
];

/** ヒートマップ用の業務領域順 (UI 表示順を固定) */
export const inventoryDomains: BusinessDomain[] = [
  '給与計算',
  '顧客対応',
  '顧問契約管理',
  '就業規則',
  '年末調整',
  '料金管理',
];

/** ヒートマップ列順 */
export const inventorySensitivityLevels: Sensitivity[] =
  SensitivityEnum.options.slice();

/** R5 enum と UI ラベル定数の同期チェック (ビルド時に弾けるよう型のみで担保) */
const _businessDomainGuard: BusinessDomain = BusinessDomainEnum.options[0];
void _businessDomainGuard;

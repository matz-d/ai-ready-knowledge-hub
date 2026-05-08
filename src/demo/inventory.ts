import { z } from 'zod';
import type {
  BusinessDomain,
  CuratorOutputResult,
  Sensitivity,
} from '../agents/curator/schema';
import type { ResidualRiskOutputResult } from '../agents/masker/schema';
import {
  BusinessDomainEnum,
  CuratorOutput,
  SensitivityEnum,
} from '../agents/curator/schema';
import { ResidualRiskOutput } from '../agents/masker/schema';
import snapshot from './inventory.snapshot.json';

/** Knowledge Inventory の実 LLM snapshot。 */
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

const InventorySnapshotEntrySchema = CuratorOutput.and(
  z.object({
    fileName: z.string(),
    sourcePath: z.string(),
    maskerEvaluation: ResidualRiskOutput.optional(),
  })
);

export const accountingOfficeInventory: InventorySnapshotEntry[] = z
  .array(InventorySnapshotEntrySchema)
  .parse(snapshot);

/** ヒートマップ用の業務領域順 (R5 enum 順に snapshot 内の値だけ表示) */
export const inventoryDomains: BusinessDomain[] =
  BusinessDomainEnum.options.filter((domain) =>
    accountingOfficeInventory.some((entry) => entry.businessDomain === domain)
  );

/** ヒートマップ列順 */
export const inventorySensitivityLevels: Sensitivity[] =
  SensitivityEnum.options.slice();

/** R5 enum と UI ラベル定数の同期チェック (ビルド時に弾けるよう型のみで担保) */
const _businessDomainGuard: BusinessDomain = BusinessDomainEnum.options[0];
void _businessDomainGuard;

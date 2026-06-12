/**
 * E2E delivery 検証用の Context Package `.md` をローカル生成する（offline fallback）。
 *
 * 目的: 実アプリ（IAP/GCP）が立たなくても、`docs/operate-deliver-readiness.md` §E の
 * E2E delivery 検証を NotebookLM/Gemini で実施できる「忠実な .md」を1枚作る。
 *
 * 設計上の注意:
 * - 検証対象は「とどける」= 出力フォーマッタ `exportContextPackageMarkdown` の .md と
 *   下流 AI（NotebookLM/Gemini）の挙動。strategist の purpose/freshness 選定の再現では「ない」。
 * - そのため `contextPackageInput.ts` の builder（安全/status のみで判定し excludedDocuments は
 *   常に空）は使わず、included/excluded を判別力が出るように直接組んで実フォーマッタへ渡す。
 * - included の本文は sample-data/accounting-office の synthetic 実体を埋め込む（料金は実数字を
 *   載せないと「33,000 vs 30,000」の判別テストが成立しない）。
 * - 投入は synthetic / masked fixture のみ（Safety Invariant）。
 *
 * 実行: pnpm tsx scripts/oneoff/buildDeliveryE2ePackage.ts
 * 出力: docs/delivery-e2e/2026-06-09-accounting-office.md
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  exportContextPackageMarkdown,
  exportContextPackageSourceBundle,
  type ContextPackageExportInput,
  type IncludedContextDocument,
} from '../../src/lib/exportContextPackage';

const SAMPLE_DIR = join(process.cwd(), 'sample-data/accounting-office');
const OUTPUT_PATH = join(
  process.cwd(),
  'docs/delivery-e2e/2026-06-09-accounting-office.md'
);
// source 分割 bundle の出力先（日付ケース単位）。NotebookLM にこのフォルダの
// 全ファイルを source として投入する。
const BUNDLE_DIR = join(
  process.cwd(),
  'docs/delivery-e2e/sources/2026-06-09-accounting-office'
);

function body(fileName: string): string {
  return readFileSync(join(SAMPLE_DIR, fileName), 'utf-8').trim();
}

/**
 * 「料金・手続き問い合わせアシスタント」purpose を想定した included 群。
 * - 現行料金（2026）を full body で同梱 → included のグラウンドトゥルース。
 * - 顧客対応メモ_匿名化 は Masker で AI-safe 化済みの例として `aiSafeViaMasking: true`。
 */
const included: IncludedContextDocument[] = [
  {
    fileName: '料金表_2026.csv',
    reason: '現行料金表（current）。料金問い合わせの権威ソース',
    sourceType: '表',
    sensitivity: 'Internal',
    aiSafeContent: body('料金表_2026.csv'),
  },
  {
    fileName: '給与計算チェックリスト.md',
    reason: '一般情報。給与計算手続きの参照可ドキュメント',
    sourceType: 'チェックリスト',
    sensitivity: 'Internal',
    aiSafeContent: body('給与計算チェックリスト.md'),
  },
  {
    fileName: '就業規則テンプレート.md',
    reason: '汎用テンプレ。就業規則の一般説明に参照可',
    sourceType: 'テンプレート',
    sensitivity: 'Internal',
    aiSafeContent: body('就業規則テンプレート.md'),
  },
  {
    fileName: '年末調整_案内文.txt',
    reason: '年末調整手続きの一般案内。AI 参照可',
    sourceType: '案内文',
    sensitivity: 'Internal',
    aiSafeContent: body('年末調整_案内文.txt'),
  },
  {
    fileName: '顧客対応メモ_匿名化.txt',
    reason: 'Confidential だが Masker で placeholder 化済みの AI-safe 版',
    sourceType: 'メモ',
    sensitivity: 'Confidential',
    aiSafeViaMasking: true,
    aiSafeContent: body('顧客対応メモ_匿名化.txt'),
  },
];

const input: ContextPackageExportInput = {
  purpose: '顧問先からの料金・手続き問い合わせに即答する社内アシスタント',
  generatedAt: new Date('2026-06-09T00:00:00.000Z'),
  // 棚卸し対象 = sample-data/accounting-office の全文書（included + excluded + humanReview + その他）
  sourceDocumentsReviewed: 10,
  includedDocuments: included,
  // 除外は「断言」: 本文は同梱しない。名前と理由のみ（古い料金は判別テストの肝）。
  excludedDocuments: [
    {
      fileName: '古い料金表_2023.csv',
      reason:
        '旧版料金表（superseded）。現行 料金表_2026.csv に置き換え済みのため除外',
      status: 'Superseded / excluded',
    },
  ],
  // Restricted / masking 待ちは human review に隔離（AI には渡さない）。
  humanReviewDocuments: [
    {
      fileName: '顧問契約書_実案件サンプル.txt',
      reason: 'Restricted（実案件の契約書）。Masker でも残留リスクあり、下流 AI 不可',
      status: 'Restricted / human review only',
    },
    {
      fileName: '顧客対応メモ_書式.md',
      reason: 'Confidential かつ masking 待ち。AI-safe 版が未生成',
      status: 'Pending masking review',
    },
  ],
  // 「足りない」: 社内に存在しない/未整備の知識。AI は勝手に補完してはいけない。
  missingKnowledge: [
    '同業他社の料金水準との比較データ（社内に存在しない）',
    '個別顧問先ごとの特約・値引き条件（料金表には未記載）',
  ],
  // 「確認」: 人間の判断・承認が要る論点。
  questionsForHumanOwner: [
    'この料金表で確定見積もりを発行してよいか（最終承認者の確認が必要）',
    '11名以上の段階加算は 2026 料金（給与計算は1名 +1,100円）で全顧客に一律適用してよいか',
  ],
};

const md = exportContextPackageMarkdown(input);
writeFileSync(OUTPUT_PATH, md, 'utf-8');
console.error(
  `[delivery-e2e] wrote ${OUTPUT_PATH} (single .md) — included=${included.length}, excluded=${input.excludedDocuments.length}, humanReview=${input.humanReviewDocuments?.length ?? 0}`
);

// source 分割 bundle: included 各文書を個別 source、メタ層は guide 1枚。
const bundle = exportContextPackageSourceBundle(input);
rmSync(BUNDLE_DIR, { recursive: true, force: true });
mkdirSync(BUNDLE_DIR, { recursive: true });
for (const file of bundle.files) {
  writeFileSync(join(BUNDLE_DIR, file.fileName), file.content, 'utf-8');
}
console.error(
  `[delivery-e2e] wrote ${bundle.files.length} bundle files to ${BUNDLE_DIR} — ${bundle.files
    .map((f) => `${f.fileName}(${f.role})`)
    .join(', ')}`
);

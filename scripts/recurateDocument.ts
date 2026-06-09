/**
 * 単一ドキュメントを現行 curator で再分類し、direct（Public/Internal）になった場合のみ
 * Firestore レコードを curated/direct へ是正する remediation ツール。
 *
 * 用途: docs/curator-classification-precision-2026-06-09.md で特定した stale な
 * over-restriction レコード（公開テンプレが Restricted/blocked のまま残存）の修正。
 *
 * 安全策:
 * - 既定は DRY-RUN。実書き込みは `--apply` 明示時のみ。
 * - 再 curate 結果が direct でない（= over-restriction が再現する）場合は書き込まず中断。
 *   その場合は「stale ではない」シグナルなので、別途調査する。
 * - 書き込みは uploadOrchestrator の curated 永続化形（status=curated / sensitivitySource=curator）を
 *   そのままミラーし、direct 文書の canonical 状態に正規化する（masker ブロックは null 化）。
 *
 * 実行（live curator のため global 必須）:
 *   GOOGLE_CLOUD_LOCATION=global pnpm tsx scripts/recurateDocument.ts            # dry-run
 *   GOOGLE_CLOUD_LOCATION=global pnpm tsx scripts/recurateDocument.ts --apply    # 書き込み
 *   DOC_ID=... IR_PATH=... GOOGLE_CLOUD_LOCATION=global pnpm tsx scripts/recurateDocument.ts --apply
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { curatorFlow } from '../src/agents/curator/flow';
import { modelId as curatorModelId } from '../src/agents/_shared/genkitClient';
import { DOCUMENTS_COLLECTION } from '../src/lib/documents';
import { FieldValue, getFirestoreClient } from '../src/lib/firestore';
import {
  extractTextFromDocumentIR,
  type DocumentIR,
} from '../src/eval/curator/publicDocClassificationGolden';

// 既定ターゲット = 本番で見つかった stale な over-restriction レコード。
const DEFAULT_DOC_ID = 'd2e75082-336b-4a76-97d6-e1911eb7b664';
const DEFAULT_IR_PATH =
  'sample-data/document-conversion/official-doc-pdf/mhlw-labor-conditions-notice-general.document-ir.json';

const docId = process.env.DOC_ID ?? DEFAULT_DOC_ID;
const irPath = process.env.IR_PATH ?? DEFAULT_IR_PATH;
const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  const ref = getFirestoreClient().collection(DOCUMENTS_COLLECTION).doc(docId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error(`document ${docId} not found`);
  }
  const before = snap.data() ?? {};
  const fileName = String(before.fileName ?? '');
  console.log(`[recurate] target ${docId} (${fileName})`);
  console.log(
    `  before: sensitivity=${before.sensitivity} aiUsePolicy=${before.aiUsePolicy} status=${before.status}`
  );

  const ir = JSON.parse(
    readFileSync(join(process.cwd(), irPath), 'utf-8')
  ) as DocumentIR;
  const content = extractTextFromDocumentIR(ir);
  if (content.length === 0) {
    throw new Error(`extracted content is empty from ${irPath}`);
  }

  const result = await curatorFlow({ fileName, content });
  console.log(
    `  re-curated: sensitivity=${result.sensitivity} aiUsePolicy=${result.aiUsePolicy} freshness=${result.freshness}`
  );
  console.log(`    rationale: ${result.rationale}`);

  if (result.aiUsePolicy !== 'direct') {
    console.error(
      `  ⚠️ 再 curate が direct になりませんでした（${result.aiUsePolicy}）。stale ではない可能性。書き込みを中断します。`
    );
    process.exitCode = 1;
    return;
  }

  const update = {
    status: 'curated',
    maskingPending: null,
    updatedAt: FieldValue.serverTimestamp(),
    documentType: result.documentType,
    businessDomain: result.businessDomain,
    sensitivity: result.sensitivity,
    freshness: result.freshness,
    isAuthoritativeCandidate: result.isAuthoritativeCandidate,
    aiUsePolicy: result.aiUsePolicy,
    sensitivitySource: 'curator',
    originalCuratorSensitivity: null,
    sensitivityReason: null,
    curator: {
      documentType: result.documentType,
      businessDomain: result.businessDomain,
      sensitivity: result.sensitivity,
      freshness: result.freshness,
      isAuthoritativeCandidate: result.isAuthoritativeCandidate,
      aiUsePolicy: result.aiUsePolicy,
      rationale: result.rationale,
      completedAt: FieldValue.serverTimestamp(),
      modelId: curatorModelId,
    },
    curatorError: null,
    // direct 文書は masker を通らないため masker ブロックを null 化して正規化する。
    masker: null,
    maskerError: null,
    aiSafeStoragePath: null,
  };

  if (!apply) {
    console.log(
      `\n  DRY-RUN（--apply で書き込み）。提案: status=curated, sensitivity=${result.sensitivity}, aiUsePolicy=direct`
    );
    return;
  }

  await ref.update(update);
  console.log('\n  ✅ APPLIED. レコードを curated/direct に是正しました。');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

import './loadEnv';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { curatorFlow } from '../src/agents/curator/flow';
import { maskerRiskFlow } from '../src/agents/masker/flow';
import type { CuratorOutputResult } from '../src/agents/curator/schema';
import type { ResidualRiskOutputResult } from '../src/agents/masker/schema';

/**
 * sample-data/accounting-office を curatorFlow に通し、
 * src/demo/inventory.snapshot.json として実 LLM 出力を保存する。
 *
 * UI 側はこの snapshot を読むことで「見た目 = 実出力のフリーズ」を担保する。
 *
 * Masker A8 評価は、Curator が `requires_masking` を返した文書のうち、
 * sample-data/masked/ にマスク済みテキストが用意されているものだけ実行する。
 * (本格マスキングはまだ未実装のため、PoC で作った 2 ファイルでデモする)
 */

const SAMPLE_DIR = path.resolve(
  process.cwd(),
  'sample-data',
  'accounting-office'
);
const MASKED_DIR = path.resolve(process.cwd(), 'sample-data', 'masked');
const OUTPUT_FILE = path.resolve(
  process.cwd(),
  'src',
  'demo',
  'inventory.snapshot.json'
);

const TARGET_EXTENSIONS = new Set(['.txt', '.md', '.csv']);

/**
 * sample-data の元ファイル名 -> sample-data/masked のマスク済みファイル名対応。
 * 対応がない文書は Masker A8 評価をスキップする。
 */
const MASKED_PAIR: Record<string, string | undefined> = {
  '顧問契約書_実案件サンプル.txt': 'masked-contract-risk.txt',
  '顧客対応メモ_匿名化.txt': 'masked-memo-safe.txt',
};

type SnapshotEntry = CuratorOutputResult & {
  fileName: string;
  sourcePath: string;
  maskerEvaluation?: ResidualRiskOutputResult;
};

async function listTargetFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directory, entry.name))
    .filter((p) => TARGET_EXTENSIONS.has(path.extname(p)))
    .sort((a, b) => a.localeCompare(b, 'ja'));
}

async function evaluateMasker(
  fileName: string
): Promise<ResidualRiskOutputResult | undefined> {
  const maskedFile = MASKED_PAIR[fileName];
  if (!maskedFile) return undefined;

  try {
    const maskedContent = await readFile(
      path.join(MASKED_DIR, maskedFile),
      'utf8'
    );
    return await maskerRiskFlow({
      fileName: maskedFile,
      maskedContent,
    });
  } catch (e) {
    console.warn(
      `[masker] ${fileName} のマスク済みテキスト評価をスキップ: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
    return undefined;
  }
}

async function main(): Promise<void> {
  const files = await listTargetFiles(SAMPLE_DIR);
  if (files.length === 0) {
    throw new Error(`検証対象ファイルが見つかりません: ${SAMPLE_DIR}`);
  }

  const snapshot: SnapshotEntry[] = [];

  for (const filePath of files) {
    const fileName = path.basename(filePath);
    const content = await readFile(filePath, 'utf8');
    const curator = await curatorFlow({ fileName, content });
    const masker =
      curator.aiUsePolicy === 'requires_masking'
        ? await evaluateMasker(fileName)
        : undefined;

    const entry: SnapshotEntry = {
      ...curator,
      fileName,
      sourcePath: path.relative(process.cwd(), filePath),
      ...(masker ? { maskerEvaluation: masker } : {}),
    };
    snapshot.push(entry);

    console.log(
      `=== ${fileName} === sensitivity=${curator.sensitivity} aiUsePolicy=${curator.aiUsePolicy}` +
        (masker
          ? ` masker=${masker.recommendedSensitivity}`
          : '')
    );
  }

  await writeFile(OUTPUT_FILE, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  console.log(`\nWrote snapshot: ${path.relative(process.cwd(), OUTPUT_FILE)}`);
  console.log(
    `${snapshot.length} entries (${
      snapshot.filter((s) => s.maskerEvaluation).length
    } with masker evaluation)`
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

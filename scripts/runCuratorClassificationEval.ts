/**
 * Curator 分類精度 eval（live）。公開文書 fixture を curator に N 回かけ、
 * over-restriction（Public のはずが Confidential/Restricted・direct 以外）の
 * ばらつきと発生率を測る。
 *
 * 実行: pnpm tsx scripts/runCuratorClassificationEval.ts   (EVAL_RUNS=5 既定)
 * 前提: Gemini への live 呼び出し（ADC / GOOGLE_CLOUD_* 設定済みであること）。
 * 対象は公開文書のみ（実 PII なし）。
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { curatorFlow } from '../src/agents/curator/flow';
import {
  PUBLIC_DOC_GOLDEN,
  extractTextFromDocumentIR,
  isOverRestrictedForPublicDoc,
  type DocumentIR,
} from '../src/eval/curator/publicDocClassificationGolden';

const RUNS = Number(process.env.EVAL_RUNS ?? 5);

type RunOutcome = {
  sensitivity: string;
  aiUsePolicy: string;
  overRestricted: boolean;
  rationale: string;
};

function tally(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => `${value}×${count}`)
    .join(', ');
}

async function main(): Promise<void> {
  console.error(
    `[curator-eval] RUNS=${RUNS} per fixture, fixtures=${PUBLIC_DOC_GOLDEN.length} (公開文書のみ)\n`
  );

  let totalRuns = 0;
  let totalOver = 0;
  const perFixtureOver: { id: string; over: number; runs: number }[] = [];

  for (const fixture of PUBLIC_DOC_GOLDEN) {
    const ir = JSON.parse(
      readFileSync(join(process.cwd(), fixture.irPath), 'utf-8')
    ) as DocumentIR;
    const content = extractTextFromDocumentIR(ir);

    const outcomes: RunOutcome[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const result = await curatorFlow({ fileName: fixture.fileName, content });
      const overRestricted = isOverRestrictedForPublicDoc(result);
      outcomes.push({
        sensitivity: result.sensitivity,
        aiUsePolicy: result.aiUsePolicy,
        overRestricted,
        rationale: result.rationale,
      });
    }

    const over = outcomes.filter((o) => o.overRestricted).length;
    totalRuns += outcomes.length;
    totalOver += over;
    perFixtureOver.push({ id: fixture.id, over, runs: outcomes.length });

    const flag = over > 0 ? '⚠️' : '✅';
    console.log(`${flag} ${fixture.fileName}  (expect Public/Internal + direct)`);
    console.log(`   note: ${fixture.note}`);
    console.log(`   sensitivity: ${tally(outcomes.map((o) => o.sensitivity))}`);
    console.log(`   aiUsePolicy: ${tally(outcomes.map((o) => o.aiUsePolicy))}`);
    console.log(`   over-restriction: ${over}/${outcomes.length}`);
    // 誤判定のみ rationale を出す（幻覚の根拠を見える化）。
    for (const o of outcomes.filter((x) => x.overRestricted)) {
      console.log(
        `     ⚠️ ${o.sensitivity}/${o.aiUsePolicy} — ${o.rationale}`
      );
    }
    console.log('');
  }

  console.log('=== サマリ ===');
  for (const row of perFixtureOver) {
    console.log(`  ${row.id}: over ${row.over}/${row.runs}`);
  }
  const rate = totalRuns === 0 ? 0 : (totalOver / totalRuns) * 100;
  console.log(
    `\n  全体 over-restriction 率: ${totalOver}/${totalRuns} (${rate.toFixed(1)}%)`
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

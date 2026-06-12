/**
 * P1-D masker drift check（live・任意実行）。
 *
 * Synthetic PII fixture に Cloud DLP を live 適用し、
 * - piiLeakCount（under-mask）: 既知 synthetic PII が masked 出力に残存 → exit 1
 * - liveFalseMaskedTokenCount / maskedValueRetention（over-mask）: report-only
 *
 * 実行: pnpm eval:p1d:masker-drift
 * 前提: GOOGLE_CLOUD_PROJECT / ADC が設定済みであること。
 */
import './loadEnv';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { applyCloudDlpMask } from '../src/agents/masker/cloudDlpMasker';
import {
  buildP1dMaskerDriftReport,
  countPiiLeaks,
  extractMaskerInputTextFromDocumentIrJson,
  measureMaskedValueRetention,
  P1D_MASKER_DRIFT_FIXTURES,
  type P1dMaskerDriftFixtureResult,
  type P1dMaskerDriftReport,
} from '../src/eval/conversion/p1dMaskerDrift';

type CliOptions = {
  outPath: string;
  pretty: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  let outPath = 'tmp/p1d-masker-drift-report.json';
  let pretty = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--out') {
      const next = argv[index + 1];
      if (!next) throw new Error('--out requires a file path');
      outPath = next;
      index += 1;
      continue;
    }
    if (arg === '--no-pretty') {
      pretty = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { outPath, pretty };
}

function printHumanSummary(report: P1dMaskerDriftReport): void {
  console.error(
    `[p1d-masker-drift] fixtures=${report.summary.fixtureCount} provider=${report.maskingProvider} dlp=${report.dlpRuleSetVersion}\n`
  );

  for (const fixture of report.fixtures) {
    const leakFlag = fixture.piiLeakCount > 0 ? '❌' : '✅';
    const retentionRate =
      fixture.maskedValueRetention.rate === null
        ? 'n/a'
        : `${(fixture.maskedValueRetention.rate * 100).toFixed(1)}%`;
    console.log(`${leakFlag} ${fixture.fileName}`);
    console.log(`   masked spans: ${fixture.maskedSpansCount}`);
    console.log(`   pii leaks: ${fixture.piiLeakCount}`);
    if (fixture.piiLeaks.length > 0) {
      for (const leak of fixture.piiLeaks) {
        console.log(`     leak: ${leak}`);
      }
    }
    console.log(
      `   over-mask (missing non-PII): ${fixture.liveFalseMaskedTokenCount}/${fixture.maskedValueRetention.expectedCount}`
    );
    console.log(`   masked value retention: ${retentionRate}`);
    for (const missing of fixture.maskedValueRetention.missing) {
      console.log(`     missing: ${missing}`);
    }
    console.log('');
  }

  console.log('=== サマリ ===');
  console.log(`  piiLeakCount: ${report.summary.piiLeakCount}`);
  console.log(
    `  liveFalseMaskedTokenCount: ${report.summary.liveFalseMaskedTokenCount}`
  );
  console.log(
    `  maskedValueRetentionAverage: ${
      report.summary.maskedValueRetentionAverage === null
        ? 'n/a'
        : `${(report.summary.maskedValueRetentionAverage * 100).toFixed(1)}%`
    }`
  );
  console.log(`  executedAt: ${report.executedAt}`);
  console.log(`  dlpRuleSetVersion: ${report.dlpRuleSetVersion}`);
  console.log(`  googleCloudProject: ${report.googleCloudProject ?? '(unset)'}`);
  console.log(
    `  googleCloudLocation: ${report.googleCloudLocation ?? '(unset)'}`
  );
}

async function evaluateFixture(
  fixture: (typeof P1D_MASKER_DRIFT_FIXTURES)[number]
): Promise<P1dMaskerDriftFixtureResult> {
  const irPath = path.resolve(process.cwd(), fixture.irPath);
  const raw = JSON.parse(await readFile(irPath, 'utf8')) as unknown;
  const sourceText = extractMaskerInputTextFromDocumentIrJson(raw);
  if (sourceText.trim().length === 0) {
    throw new Error(`${fixture.id}: DocumentIR sidecar produced empty source text`);
  }

  const maskingResult = await applyCloudDlpMask({
    fileName: fixture.fileName,
    content: sourceText,
    curatorContext: {
      sensitivity: 'Confidential',
      aiUsePolicy: 'requires_masking',
      businessDomain: 'その他',
    },
  });

  const leakResult = countPiiLeaks(
    maskingResult.maskedContent,
    fixture.knownPiiStrings
  );
  const retentionResult = measureMaskedValueRetention(
    maskingResult.maskedContent,
    fixture.nonPiiRetentionValues
  );

  return {
    documentId: fixture.id,
    fileName: fixture.fileName,
    sourceTextLength: sourceText.length,
    maskedSpansCount: maskingResult.maskedSpans.length,
    ruleHits: maskingResult.ruleHits,
    piiLeakCount: leakResult.piiLeakCount,
    piiLeaks: leakResult.leaks,
    liveFalseMaskedTokenCount: retentionResult.liveFalseMaskedTokenCount,
    maskedValueRetention: retentionResult,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const fixtureResults: P1dMaskerDriftFixtureResult[] = [];

  for (const fixture of P1D_MASKER_DRIFT_FIXTURES) {
    fixtureResults.push(await evaluateFixture(fixture));
  }

  const report = buildP1dMaskerDriftReport(fixtureResults, {
    googleCloudProject: process.env.GOOGLE_CLOUD_PROJECT ?? null,
    googleCloudLocation: process.env.GOOGLE_CLOUD_LOCATION ?? null,
  });

  const json = JSON.stringify(report, null, options.pretty ? 2 : 0);
  const outPath = path.resolve(options.outPath);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${json}\n`, 'utf8');
  process.stdout.write(`${json}\n`);
  printHumanSummary(report);

  if (report.summary.piiLeakCount > 0) {
    process.stderr.write(
      `P1-D masker drift hard-fail: piiLeakCount=${report.summary.piiLeakCount}\n`
    );
    process.exit(1);
  }

  process.stderr.write('P1-D masker drift safety check passed: piiLeakCount=0\n');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

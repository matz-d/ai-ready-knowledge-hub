#!/usr/bin/env tsx
import './loadEnv';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { extractScanPdfFromBuffer } from '../src/lib/extractors/scanPdfDocumentExtractor';

const DEFAULT_FIXTURE_PATH =
  'sample-data/document-conversion/scan-pdf/synthetic-unmaskable-pii-scan.pdf';
const DEFAULT_TRIALS = 4;

function parseTrials(value: string | undefined): number {
  if (!value) return DEFAULT_TRIALS;
  const trials = Number(value);
  if (!Number.isInteger(trials) || trials < 1) {
    throw new Error(`trials must be a positive integer, got "${value}"`);
  }
  return trials;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const fixturePath = path.resolve(args[0] ?? DEFAULT_FIXTURE_PATH);
  const trials = parseTrials(args[1]);
  const fileName = path.basename(fixturePath);
  const buffer = await readFile(fixturePath);
  const results = [];

  for (let trial = 1; trial <= trials; trial += 1) {
    const startedAt = Date.now();
    const extracted = await extractScanPdfFromBuffer({ buffer, fileName });
    const findings = extracted.conversion.piiFindings;
    const unmaskable = findings.filter(
      (finding) => finding.maskability === 'unmaskable'
    ).length;
    results.push({
      trial,
      piiTotal: findings.length,
      piiMaskable: findings.length - unmaskable,
      piiUnmaskable: unmaskable,
      model: extracted.conversion.model,
      region: extracted.conversion.region,
      durationMs: Date.now() - startedAt,
      findings,
    });
  }

  const passed = results.every((result) => result.piiUnmaskable >= 1);
  console.log(
    JSON.stringify(
      {
        fixturePath,
        fileName,
        extractor: 'mainline extractScanPdfFromBuffer',
        acceptance: {
          requiredTrials: trials,
          requiredUnmaskablePerTrial: 1,
          passed,
        },
        results,
      },
      null,
      2
    )
  );

  if (!passed) {
    process.exitCode = 1;
  }
}

await main();

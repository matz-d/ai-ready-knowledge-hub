import './loadEnv';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { maskerRiskFlow } from '../src/agents/masker/flow';

const DEFAULT_SAMPLE = path.resolve(
  process.cwd(),
  'sample-data',
  'masked',
  'masked-contract-risk.txt'
);

async function main(): Promise<void> {
  const fileArg = process.argv[2];
  const filePath = fileArg ? path.resolve(fileArg) : DEFAULT_SAMPLE;
  const maskedContent = await readFile(filePath, 'utf8');
  const fileName = path.basename(filePath);
  const result = await maskerRiskFlow({ fileName, maskedContent });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

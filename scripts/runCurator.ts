import './loadEnv';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { curatorFlow } from '../src/agents/curator/flow';

const DEFAULT_SAMPLE = path.resolve(
  process.cwd(),
  'sample-data',
  'accounting-office',
  '年末調整_案内文.txt'
);

async function main(): Promise<void> {
  const fileArg = process.argv[2];
  const filePath = fileArg ? path.resolve(fileArg) : DEFAULT_SAMPLE;
  const content = await readFile(filePath, 'utf8');
  const fileName = path.basename(filePath);
  const result = await curatorFlow({ fileName, content });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

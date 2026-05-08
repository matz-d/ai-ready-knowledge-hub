import './loadEnv';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { curatorFlow } from '../src/agents/curator/flow';

const DEFAULT_SAMPLE_DATA_DIR = path.resolve(
  process.cwd(),
  'sample-data',
  'accounting-office'
);

const TARGET_EXTENSIONS = new Set(['.txt', '.md', '.csv']);

type CuratorRunResult =
  | {
      ok: true;
      fileName: string;
      output: Awaited<ReturnType<typeof curatorFlow>>;
    }
  | {
      ok: false;
      fileName: string;
      error: string;
    };

async function listTargetFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directory, entry.name))
    .filter((filePath) => TARGET_EXTENSIONS.has(path.extname(filePath)))
    .sort((a, b) => a.localeCompare(b, 'ja'));
}

async function runOne(filePath: string): Promise<CuratorRunResult> {
  const fileName = path.basename(filePath);
  try {
    const content = await readFile(filePath, 'utf8');
    const output = await curatorFlow({ fileName, content });
    return { ok: true, fileName, output };
  } catch (e) {
    return {
      ok: false,
      fileName,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function main(): Promise<void> {
  const directory = process.argv[2]
    ? path.resolve(process.argv[2])
    : DEFAULT_SAMPLE_DATA_DIR;
  const files = await listTargetFiles(directory);

  if (files.length === 0) {
    throw new Error(`検証対象ファイルが見つかりません: ${directory}`);
  }

  const results: CuratorRunResult[] = [];
  for (const filePath of files) {
    const result = await runOne(filePath);
    results.push(result);

    console.log(`=== ${result.fileName} ===`);
    if (result.ok) {
      console.log(JSON.stringify(result.output, null, 2));
    } else {
      console.error(result.error);
    }
  }

  const passed = results.filter((result) => result.ok).length;
  const failed = results.length - passed;
  console.log(`\nCurator validation: ${passed}/${results.length} passed`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

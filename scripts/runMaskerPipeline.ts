import './loadEnv';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { maskerPipelineFlow } from '../src/agents/masker/pipelineFlow';

async function main(): Promise<void> {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error(
      'Usage: pnpm masker:pipeline -- <path-to-text-file>'
    );
    process.exit(1);
  }
  const filePath = path.resolve(fileArg);
  const content = await readFile(filePath, 'utf8');
  const fileName = path.basename(filePath);
  const result = await maskerPipelineFlow({
    fileName,
    content,
    curatorContext: {
      sensitivity: 'Confidential',
      aiUsePolicy: 'requires_masking',
      businessDomain: '顧問契約管理',
    },
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

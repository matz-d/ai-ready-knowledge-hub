import './loadEnv';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { applyCloudDlpMask } from '../src/agents/masker/cloudDlpMasker';

async function main(): Promise<void> {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error('Usage: npm run masker:dlp:smoke -- <path-to-text-file>');
    process.exit(1);
  }

  const filePath = path.resolve(fileArg);
  const content = await readFile(filePath, 'utf8');
  const fileName = path.basename(filePath);
  const result = await applyCloudDlpMask({
    fileName,
    content,
    curatorContext: {
      sensitivity: 'Confidential',
      aiUsePolicy: 'requires_masking',
      businessDomain: '顧問契約管理',
    },
  });

  console.log(
    JSON.stringify(
      {
        provider: result.provider,
        maskedSpansCount: result.maskedSpans.length,
        ruleHits: result.ruleHits,
        maskedContentPreview: result.maskedContent.slice(0, 500),
      },
      null,
      2
    )
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

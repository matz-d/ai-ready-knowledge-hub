import './loadEnv';
import type { MaskingProvider } from '../src/agents/masker/maskingSchema';
import { resolveMaskingProvider } from '../src/agents/masker/provider';
import { regenerateChunksForDoc } from '../src/lib/chunkRegenerator';

const USAGE = [
  'Usage: npm run chunks:regenerate -- <docId>',
  '       npm run chunks:regenerate -- --dry-run <docId>',
  '       npm run chunks:regenerate -- --provider=<simple-rule|cloud-dlp> <docId>',
].join('\n');

type CliArgs = {
  docId: string;
  dryRun: boolean;
  provider?: MaskingProvider;
};

function parseCliArgs(argv: string[]): CliArgs {
  let dryRun = false;
  let provider: MaskingProvider | undefined;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--provider') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error(`Missing value for --provider\n${USAGE}`);
      }
      provider = parseMaskingProvider(value);
      i += 1;
      continue;
    }
    if (arg.startsWith('--provider=')) {
      provider = parseMaskingProvider(arg.slice('--provider='.length));
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}\n${USAGE}`);
    }
    positional.push(arg);
  }

  if (positional.length !== 1) {
    throw new Error(USAGE);
  }

  return { docId: positional[0], dryRun, provider };
}

function parseMaskingProvider(value: string): MaskingProvider {
  if (value === 'simple-rule' || value === 'cloud-dlp') {
    return value;
  }
  throw new Error(`Unknown masking provider: ${value}\n${USAGE}`);
}

async function main(): Promise<void> {
  const { docId, dryRun, provider: providerOverride } = parseCliArgs(
    process.argv.slice(2)
  );
  const maskingProvider = resolveMaskingProvider(providerOverride);
  const providerSource =
    providerOverride === undefined ? 'env/default' : 'cli';
  console.log(
    `[chunks:regenerate] Start docId=${docId}${dryRun ? ' (dry-run)' : ''} ` +
      `maskerProvider=${maskingProvider} providerSource=${providerSource}`
  );

  const result = await regenerateChunksForDoc(docId, {
    dryRun,
    provider: providerOverride,
  });
  if (dryRun) {
    console.log(
      `[chunks:regenerate] Dry-run: skip Firestore write (would replace ${result.maskedChunkCount} chunks).`
    );
    return;
  }
  console.log(
    `[chunks:regenerate] OK extractor=${result.extractorName} replacedChunks=${result.maskedChunkCount}`
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

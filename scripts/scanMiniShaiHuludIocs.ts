import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

type PackageLock = {
  packages?: Record<string, { name?: string; version?: string }>;
};

const rootDir = process.cwd();

const affectedScopes = [
  '@squawk/',
  '@tanstack/',
  '@uipath/',
  '@tallyui/',
  '@beproduct/',
  '@mistralai/',
  '@draftauth/',
  '@draftlab/',
  '@taskflow-corp/',
  '@tolka/',
  '@ml-toolkit-ts/',
  '@mesadev/',
  '@supersurkhet/',
];

const affectedUnscopedPackages = new Set([
  'safe-action',
  'ts-dna',
  'cross-stitch',
  'cmux-agent-mcp',
  'agentwork-cli',
  'git-branch-selector',
  'wot-api',
  'git-git-git',
  'nextmove-mcp',
  'ml-toolkit-ts',
]);

const payloadFileNames = new Set([
  'router_init.js',
  'router_runtime.js',
  'tanstack_runner.js',
]);

const textMarkers = [
  '@tanstack/setup',
  'github:tanstack/router#79ac49eedf774dd4b0cfa308722bc463cfe5885c',
  'bun run tanstack_runner.js',
  'A Mini Shai-Hulud has Appeared',
  'filev2.getsession.org',
  '169.254.169.254/latest/meta-data/iam/security-credentials',
  '169.254.170.2',
  'vault.svc.cluster.local:8200',
];

const ignoredDirectories = new Set([
  '.git',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'build',
]);

function packageNameFromLockPath(lockPath: string, entryName?: string): string {
  if (entryName) {
    return entryName;
  }
  if (!lockPath.startsWith('node_modules/')) {
    return lockPath;
  }
  return lockPath.replace(/^node_modules\//, '');
}

function findPackageLockHits(): string[] {
  const lockPath = path.join(rootDir, 'package-lock.json');
  if (!existsSync(lockPath)) {
    return [];
  }

  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as PackageLock;
  const hits: string[] = [];

  for (const [lockEntryPath, entry] of Object.entries(lock.packages ?? {})) {
    const packageName = packageNameFromLockPath(lockEntryPath, entry.name);
    if (
      affectedScopes.some((scope) => packageName.startsWith(scope)) ||
      affectedUnscopedPackages.has(packageName)
    ) {
      hits.push(`${packageName}@${entry.version ?? 'unknown'} (${lockEntryPath})`);
    }
  }

  return hits;
}

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (!ignoredDirectories.has(entry)) {
        yield* walkFiles(fullPath);
      }
      continue;
    }
    yield fullPath;
  }
}

function findPayloadFiles(): string[] {
  const hits: string[] = [];
  for (const filePath of walkFiles(rootDir)) {
    if (payloadFileNames.has(path.basename(filePath))) {
      hits.push(path.relative(rootDir, filePath));
    }
  }
  return hits;
}

function findTextMarkers(): string[] {
  const candidateFiles = [
    'package.json',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lock',
  ];
  const hits: string[] = [];

  for (const relativePath of candidateFiles) {
    const filePath = path.join(rootDir, relativePath);
    if (!existsSync(filePath)) {
      continue;
    }
    const content = readFileSync(filePath, 'utf8');
    for (const marker of textMarkers) {
      if (content.includes(marker)) {
        hits.push(`${relativePath}: ${marker}`);
      }
    }
  }

  return hits;
}

const packageHits = findPackageLockHits();
const payloadHits = findPayloadFiles();
const markerHits = findTextMarkers();
const allHits = [
  ...packageHits.map((hit) => `affected package: ${hit}`),
  ...payloadHits.map((hit) => `payload file: ${hit}`),
  ...markerHits.map((hit) => `marker: ${hit}`),
];

if (allHits.length > 0) {
  console.error('Mini Shai-Hulud IOC scan failed:');
  for (const hit of allHits) {
    console.error(`- ${hit}`);
  }
  process.exitCode = 1;
} else {
  console.log('Mini Shai-Hulud IOC scan passed: no package or payload markers found.');
}

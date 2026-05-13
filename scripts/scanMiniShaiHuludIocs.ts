import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
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
  'execution.js',
  'setup.mjs',
  'router_init.js',
  'router_runtime.js',
  'tanstack_runner.js',
]);

const textMarkers = [
  '@tanstack/setup',
  'github:tanstack/router#79ac49eedf774dd4b0cfa308722bc463cfe5885c',
  'bun run tanstack_runner.js',
  'A Mini Shai-Hulud has Appeared',
  'IfYouRevokeThisTokenItWillWipeTheComputerOfTheOwner',
  'filev2.getsession.org',
  'git-tanstack.com',
  'api.masscan.cloud',
  '169.254.169.254/latest/meta-data/iam/security-credentials',
  '169.254.170.2',
  '127.0.0.1:8200',
  'vault.svc.cluster.local:8200',
  'gh-token-monitor',
  'com.user.gh-token-monitor.plist',
];

const suspiciousRepoRelativePaths = [
  '.claude/setup.mjs',
  '.claude/router_runtime.js',
  '.github/workflows/codeql_analysis.yml',
  '.vscode/setup.mjs',
];

const userPersistencePaths = [
  'Library/LaunchAgents/com.user.gh-token-monitor.plist',
  '.config/systemd/user/gh-token-monitor.service',
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
  const nodeModulesIndex = lockPath.lastIndexOf('node_modules/');
  if (nodeModulesIndex === -1) {
    return lockPath;
  }
  return lockPath.slice(nodeModulesIndex + 'node_modules/'.length);
}

function isAffectedPackage(packageName: string): boolean {
  return (
    affectedScopes.some((scope) => packageName.startsWith(scope)) ||
    affectedUnscopedPackages.has(packageName)
  );
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
    if (isAffectedPackage(packageName)) {
      hits.push(`${packageName}@${entry.version ?? 'unknown'} (${lockEntryPath})`);
    }
  }

  return hits;
}

function findPnpmLockHits(): string[] {
  const lockPath = path.join(rootDir, 'pnpm-lock.yaml');
  if (!existsSync(lockPath)) {
    return [];
  }

  const content = readFileSync(lockPath, 'utf8');
  const hits = new Set<string>();

  for (const scope of affectedScopes) {
    if (content.includes(scope)) {
      hits.add(`${scope}* (pnpm-lock.yaml)`);
    }
  }

  for (const packageName of affectedUnscopedPackages) {
    const escapedPackageName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const packagePattern = new RegExp(`(^|[/\\s'"])${escapedPackageName}@`, 'm');
    if (packagePattern.test(content)) {
      hits.add(`${packageName} (pnpm-lock.yaml)`);
    }
  }

  return [...hits];
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
    const relativePath = path.relative(rootDir, filePath);
    if (
      payloadFileNames.has(path.basename(filePath)) ||
      suspiciousRepoRelativePaths.includes(relativePath)
    ) {
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
    '.claude/settings.json',
    '.vscode/tasks.json',
    '.github/workflows/codeql_analysis.yml',
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

function findUserPersistenceHits(): string[] {
  const homeDir = os.homedir();
  const hits: string[] = [];

  for (const relativePath of userPersistencePaths) {
    const filePath = path.join(homeDir, relativePath);
    if (existsSync(filePath)) {
      hits.push(filePath);
    }
  }

  return hits;
}

const packageHits = [...findPackageLockHits(), ...findPnpmLockHits()];
const payloadHits = findPayloadFiles();
const markerHits = findTextMarkers();
const persistenceHits = findUserPersistenceHits();
const allHits = [
  ...packageHits.map((hit) => `affected package: ${hit}`),
  ...payloadHits.map((hit) => `payload file: ${hit}`),
  ...markerHits.map((hit) => `marker: ${hit}`),
  ...persistenceHits.map((hit) => `user persistence file: ${hit}`),
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

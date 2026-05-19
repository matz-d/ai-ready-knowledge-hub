import path from 'node:path';
import type { DocumentSourceSubtype } from './documentIr';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

export function repoRoot(): string {
  return REPO_ROOT;
}

export function pocOutputDir(subtype: DocumentSourceSubtype): string {
  return path.join(REPO_ROOT, 'poc', 'document-conversion', 'output', subtype);
}

export function fixtureDir(subtype: DocumentSourceSubtype): string {
  return path.join(REPO_ROOT, 'sample-data', 'document-conversion', subtype);
}

export function fixtureReadmePath(): string {
  return path.join(REPO_ROOT, 'sample-data', 'document-conversion', 'README.md');
}

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DocumentIr, DocumentSourceSubtype } from './documentIr';
import { pocOutputDir } from './paths';

export type ConversionRunnerOptions = {
  inputPath: string;
  outputBasename?: string;
};

export type ConversionRunner = (
  options: ConversionRunnerOptions
) => Promise<DocumentIr>;

export async function writeDocumentIrArtifact(
  subtype: DocumentSourceSubtype,
  documentIr: DocumentIr,
  outputBasename: string
): Promise<string> {
  const dir = pocOutputDir(subtype);
  await mkdir(dir, { recursive: true });
  const outPath = path.join(dir, `${outputBasename}.document-ir.json`);
  await writeFile(outPath, `${JSON.stringify(documentIr, null, 2)}\n`, 'utf8');
  return outPath;
}

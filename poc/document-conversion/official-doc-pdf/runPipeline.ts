import path from 'node:path';
import { mapDocumentIrToChunkDrafts } from './adapter/toKnowledgeChunk';
import { enrichOfficialDocPdfEvalMetrics } from './eval/enrichEvalMetrics';
import { runOfficialDocPdfHealthCheck } from './eval/healthCheck';
import type { DocumentIr } from '../shared/documentIr';
import { safeParseDocumentIr } from '../../../src/eval/conversion/documentIr';
import type { ConversionEvalResult } from '../../../src/eval/conversion';
import {
  evaluateP1dFixture,
  type P1dExpectedFixture,
  type P1dFixtureQualityResult,
} from '../../../src/eval/conversion/p1dQualityGate';
import { writeDocumentIrArtifact } from '../shared/runConversion';

export type OfficialDocConverterId =
  | 'pdf-parse'
  | 'markitdown'
  | 'gemini'
  | 'pdf-parse+gemini-tables';

export type OfficialDocConverterRuntime = {
  elapsedMs?: number;
  model?: string;
  region?: string;
  pageGroupSize?: number;
  pageGroupCount?: number;
  geminiCallCount?: number;
  concurrency?: number;
  attemptsPerGroup?: number;
};

export type OfficialDocPipelineResult = {
  converter: OfficialDocConverterId;
  documentIr: DocumentIr;
  documentIrPath: string;
  pageCount: number;
  blockCount: number;
  tableBlockCount: number;
  chunkDraftCount: number;
  schemaPassed: boolean;
  schemaErrors: string[];
  eval: ConversionEvalResult;
  quality?: P1dFixtureQualityResult;
  runtime?: OfficialDocConverterRuntime;
};

/** JSON report shape: IR artifact is written to disk, not duplicated in compare output. */
export type OfficialDocPipelineSnapshot = Omit<
  OfficialDocPipelineResult,
  'documentIr'
>;

export function toPipelineSnapshot(
  result: OfficialDocPipelineResult
): OfficialDocPipelineSnapshot {
  const { documentIr: _documentIr, ...snapshot } = result;
  return snapshot;
}

export async function runOfficialDocPipeline(options: {
  converter: OfficialDocConverterId;
  fileName: string;
  documentIr: DocumentIr;
  outputBasename: string;
  totalPages?: number;
  inputPath?: string;
  expected?: P1dExpectedFixture;
  isPublicDocument?: boolean;
  runtime?: OfficialDocConverterRuntime;
}): Promise<OfficialDocPipelineResult> {
  const parsed = safeParseDocumentIr(options.documentIr);
  const schemaPassed = parsed.success;
  const schemaErrors = parsed.success
    ? []
    : parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`
      );
  const documentIr = parsed.success ? parsed.data : options.documentIr;

  const artifactBasename = `${options.outputBasename}.${options.converter}`;
  const documentIrPath = await writeDocumentIrArtifact(
    'official-doc-pdf',
    documentIr,
    artifactBasename
  );

  const chunkDrafts = mapDocumentIrToChunkDrafts(documentIr);
  const baseEval = runOfficialDocPdfHealthCheck(
    chunkDrafts,
    schemaPassed,
    schemaErrors
  );
  const evalResult = enrichOfficialDocPdfEvalMetrics(baseEval, documentIr, {
    totalPages: options.totalPages,
  });
  const quality =
    options.expected && options.inputPath
      ? evaluateP1dFixture({
          documentId: options.outputBasename,
          fixturePath: options.inputPath,
          sourceSubtype: 'official-doc-pdf',
          isPublicDocument: options.isPublicDocument ?? true,
          documentIr,
          chunks: chunkDrafts,
          expected: options.expected,
        })
      : undefined;

  const blockCount = documentIr.pages.reduce(
    (sum, page) => sum + page.blocks.length,
    0
  );
  const tableBlockCount = documentIr.pages.reduce(
    (sum, page) =>
      sum + page.blocks.filter((block) => block.kind === 'table').length,
    0
  );

  return {
    converter: options.converter,
    documentIr,
    documentIrPath,
    pageCount: documentIr.pages.length,
    blockCount,
    tableBlockCount,
    chunkDraftCount: chunkDrafts.length,
    schemaPassed,
    schemaErrors,
    eval: evalResult,
    ...(quality ? { quality } : {}),
    ...(options.runtime ? { runtime: options.runtime } : {}),
  };
}

export function fixtureBasename(inputPath: string): string {
  return path.parse(path.basename(inputPath)).name;
}

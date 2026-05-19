import path from 'node:path';
import { mapDocumentIrToChunkDrafts } from './adapter/toKnowledgeChunk';
import { enrichOfficialDocPdfEvalMetrics } from './eval/enrichEvalMetrics';
import { runOfficialDocPdfHealthCheck } from './eval/healthCheck';
import type { DocumentIr } from '../shared/documentIr';
import { safeParseDocumentIr } from '../../../src/eval/conversion/documentIr';
import type { ConversionEvalResult } from '../../../src/eval/conversion';
import { writeDocumentIrArtifact } from '../shared/runConversion';

export type OfficialDocConverterId = 'pdf-parse' | 'markitdown';

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
  };
}

export function fixtureBasename(inputPath: string): string {
  return path.parse(path.basename(inputPath)).name;
}

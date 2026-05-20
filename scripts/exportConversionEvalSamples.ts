import './loadEnv';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Timestamp } from '@google-cloud/firestore';
import {
  CONVERSION_EVAL_COLLECTION,
  type ConversionEvalRecord,
} from '../src/lib/conversionEvalStorage';
import { DOCUMENTS_COLLECTION } from '../src/lib/documents';
import { getFirestoreClient } from '../src/lib/firestore';
import {
  parseConversionEvalResult,
  type ConversionEvalResult,
} from '../src/eval/conversion/conversionEvalResult';
import {
  ConversionEvalStageSchema,
  type ConversionEvalStage,
} from '../src/eval/conversion/conversionEvalStage';

const TARGET_SOURCE_SUBTYPE = 'official-doc-pdf';
const DEFAULT_OUTPUT_DIR = 'tmp';

type CliOptions = {
  dryRun: boolean;
  outputPath: string;
  limit: number | null;
};

type RawConversionEval = Record<string, unknown> & {
  docId?: unknown;
  revisionId?: unknown;
  stage?: unknown;
  result?: unknown;
  sourceSubtype?: unknown;
  createdAt?: unknown;
};

type ConversionEvalSnapshotLike = {
  id: string;
  data(): RawConversionEval;
};

type SourceSubtypeLookup = (docId: string) => Promise<unknown>;

export type ExportConversionEvalSamplesResult = {
  rows: ExportRow[];
  skippedBySubtype: number;
  skippedInvalid: number;
};

export type ExportRow = {
  evalId: string;
  docId: string;
  revisionId: string;
  stage: ConversionEvalStage;
  createdAt: string | null;
  sourceSubtype: typeof TARGET_SOURCE_SUBTYPE;
  coverage: {
    pageCoverage: number;
    textDensityWarningsLength: number;
    tableCandidates: number;
  };
  locatorQuality: {
    hasPageLocators: boolean;
    hasTableLocators: boolean;
  };
  contextPackageReadiness: {
    oversizedChunks: number;
  };
  safetyReadiness: ConversionEvalResult['safetyReadiness'];
};

function todayForFileName(): string {
  return new Date().toISOString().slice(0, 10);
}

export function parseArgs(argv: string[]): CliOptions {
  let dryRun = false;
  let outputPath = path.join(
    DEFAULT_OUTPUT_DIR,
    `conversion-eval-samples-${todayForFileName()}.jsonl`
  );
  let limit: number | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--out') {
      const next = argv[index + 1];
      if (!next) throw new Error('--out requires a file path');
      outputPath = next;
      index += 1;
      continue;
    }
    if (arg === '--limit') {
      const next = argv[index + 1];
      if (!next) throw new Error('--limit requires a number');
      const parsed = Number.parseInt(next, 10);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error('--limit must be a positive integer');
      }
      limit = parsed;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { dryRun, outputPath, limit };
}

export function timestampToIsoOrNull(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

export function parseStoredRecord(
  evalId: string,
  raw: RawConversionEval
): ConversionEvalRecord {
  if (typeof raw.docId !== 'string') {
    throw new Error(`${CONVERSION_EVAL_COLLECTION}/${evalId} is missing docId`);
  }
  if (typeof raw.revisionId !== 'string') {
    throw new Error(`${CONVERSION_EVAL_COLLECTION}/${evalId} is missing revisionId`);
  }

  return {
    evalId,
    docId: raw.docId,
    revisionId: raw.revisionId,
    stage: ConversionEvalStageSchema.parse(raw.stage),
    result: parseConversionEvalResult(raw.result),
    createdAt: timestampToIsoOrNull(raw.createdAt),
  };
}

export function toExportRow(record: ConversionEvalRecord): ExportRow {
  const result = record.result;
  return {
    evalId: record.evalId,
    docId: record.docId,
    revisionId: record.revisionId,
    stage: record.stage,
    createdAt: record.createdAt,
    sourceSubtype: TARGET_SOURCE_SUBTYPE,
    coverage: {
      pageCoverage: result.coverage.pageCoverage,
      textDensityWarningsLength: result.coverage.textDensityWarnings.length,
      tableCandidates: result.coverage.tableCandidates,
    },
    locatorQuality: {
      hasPageLocators: result.locatorQuality.hasPageLocators,
      hasTableLocators: result.locatorQuality.hasTableLocators,
    },
    contextPackageReadiness: {
      oversizedChunks: result.contextPackageReadiness.oversizedChunks,
    },
    safetyReadiness: result.safetyReadiness,
  };
}

function isAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Could not load the default credentials') ||
    message.includes('Your default credentials were not found') ||
    message.includes('invalid_grant') ||
    message.includes('UNAUTHENTICATED')
  );
}

async function lookupDocumentSourceSubtype(docId: string): Promise<unknown> {
  const db = getFirestoreClient();
  const snapshot = await db.collection(DOCUMENTS_COLLECTION).doc(docId).get();
  return snapshot.data()?.sourceSubtype;
}

export async function collectExportRowsFromDocs(
  docs: ConversionEvalSnapshotLike[],
  lookupSourceSubtype: SourceSubtypeLookup,
  limit: number | null = null
): Promise<ExportConversionEvalSamplesResult> {
  const rows: ExportRow[] = [];
  let skippedBySubtype = 0;
  let skippedInvalid = 0;

  for (const doc of docs) {
    if (limit !== null && rows.length >= limit) break;

    const raw = doc.data();
    const sourceSubtype =
      raw.sourceSubtype ?? (typeof raw.docId === 'string'
        ? await lookupSourceSubtype(raw.docId)
        : undefined);

    if (sourceSubtype !== TARGET_SOURCE_SUBTYPE) {
      skippedBySubtype += 1;
      continue;
    }

    try {
      rows.push(toExportRow(parseStoredRecord(doc.id, raw)));
    } catch (error) {
      skippedInvalid += 1;
      console.warn(
        `[warn] skipped invalid ${CONVERSION_EVAL_COLLECTION}/${doc.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  rows.sort((left, right) => {
    const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;
    const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;
    const leftSortable = Number.isNaN(leftTime) ? 0 : leftTime;
    const rightSortable = Number.isNaN(rightTime) ? 0 : rightTime;
    return (
      leftSortable - rightSortable || left.evalId.localeCompare(right.evalId)
    );
  });

  return { rows, skippedBySubtype, skippedInvalid };
}

async function exportSamples(options: CliOptions): Promise<void> {
  if (options.dryRun) {
    console.log(
      [
        '[dry-run] Firestore connection skipped.',
        `Would read ${CONVERSION_EVAL_COLLECTION} and keep sourceSubtype === "${TARGET_SOURCE_SUBTYPE}".`,
        `Would write JSONL to ${options.outputPath}.`,
      ].join('\n')
    );
    return;
  }

  const db = getFirestoreClient();
  const snapshot = await db.collection(CONVERSION_EVAL_COLLECTION).get();
  const { rows, skippedBySubtype, skippedInvalid } =
    await collectExportRowsFromDocs(
      snapshot.docs.map((doc) => ({
        id: doc.id,
        data: () => doc.data() as RawConversionEval,
      })),
      lookupDocumentSourceSubtype,
      options.limit
    );

  await mkdir(path.dirname(options.outputPath), { recursive: true });
  const jsonl = rows.map((row) => JSON.stringify(row)).join('\n');
  await writeFile(options.outputPath, jsonl ? `${jsonl}\n` : '', 'utf8');

  console.log(
    [
      `Wrote ${rows.length} JSONL rows to ${options.outputPath}.`,
      `Skipped ${skippedBySubtype} rows by sourceSubtype and ${skippedInvalid} invalid rows.`,
    ].join('\n')
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  try {
    await exportSamples(options);
  } catch (error) {
    if (isAuthError(error)) {
      console.error(
        [
          'Firestore ADC authentication is not available.',
          'Authenticate locally, then rerun:',
          '  gcloud auth application-default login',
          '  pnpm tsx scripts/exportConversionEvalSamples.ts',
        ].join('\n')
      );
      process.exitCode = 2;
      return;
    }

    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

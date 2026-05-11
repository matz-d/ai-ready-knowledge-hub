import './loadEnv';
import path from 'node:path';
import { maskKnowledgeChunk } from '../src/agents/masker/maskKnowledgeChunk';
import { createChunkFirestoreAdapter } from '../src/lib/chunkFirestoreAdapter';
import { DOCUMENTS_COLLECTION } from '../src/lib/documents';
import { extractCsv } from '../src/lib/extractors/csvExtractor';
import { extractXlsx } from '../src/lib/extractors/xlsxExtractor';
import { getFirestoreClient } from '../src/lib/firestore';
import type { FirestoreDocument, FirestoreDocumentStatus } from '../src/lib/firestoreSchema';
import { adaptFirestoreDocumentToInventory } from '../src/lib/inventoryFirestoreAdapter';
import type { KnowledgeChunk } from '../src/lib/knowledgeChunkSchema';
import { readRawObject } from '../src/lib/storage';

const TERMINAL_CHUNK_ELIGIBLE_STATUSES = new Set<FirestoreDocumentStatus>([
  'curated',
  'ai_safe',
  'restricted',
  'blocked',
]);

const USAGE = [
  'Usage: npm run chunks:regenerate -- <docId>',
  '       npm run chunks:regenerate -- --dry-run <docId>',
].join('\n');

type CliArgs = {
  docId: string;
  dryRun: boolean;
};

type ExtractorResult = {
  extractorName: 'csv' | 'xlsx';
  extractorInput: string;
  chunks: ReturnType<typeof extractCsv>['chunks'] | ReturnType<typeof extractXlsx>['chunks'];
};

function parseCliArgs(argv: string[]): CliArgs {
  let dryRun = false;
  const positional: string[] = [];

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
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

  return { docId: positional[0], dryRun };
}

async function loadDocument(docId: string): Promise<{
  inventoryDocument: NonNullable<ReturnType<typeof adaptFirestoreDocumentToInventory>>;
}> {
  const snapshot = await getFirestoreClient()
    .collection(DOCUMENTS_COLLECTION)
    .doc(docId)
    .get();

  if (!snapshot.exists) {
    throw new Error(`Document not found: ${docId}`);
  }

  const firestoreDocument = snapshot.data() as FirestoreDocument;
  if (!TERMINAL_CHUNK_ELIGIBLE_STATUSES.has(firestoreDocument.status)) {
    throw new Error(
      `Document status "${firestoreDocument.status}" is not chunk-eligible. ` +
        'Only curated/ai_safe/restricted/blocked can own chunks.'
    );
  }

  const inventoryDocument = adaptFirestoreDocumentToInventory(
    snapshot.id,
    firestoreDocument
  );
  if (!inventoryDocument) {
    throw new Error(
      `Document ${docId} is terminal but missing effective fields required for chunk generation.`
    );
  }

  return { inventoryDocument };
}

function extractChunks(args: {
  docId: string;
  fileName: string;
  content: Buffer;
  documentSensitivity: NonNullable<ReturnType<typeof adaptFirestoreDocumentToInventory>>['sensitivity'];
  documentAiUsePolicy: NonNullable<
    ReturnType<typeof adaptFirestoreDocumentToInventory>
  >['aiUsePolicy'];
}): ExtractorResult {
  const extension = path.extname(args.fileName).toLowerCase();

  if (extension === '.csv') {
    const text = args.content.toString('utf-8');
    const extracted = extractCsv({
      docId: args.docId,
      fileName: args.fileName,
      content: text,
      documentSensitivity: args.documentSensitivity,
      documentAiUsePolicy: args.documentAiUsePolicy,
    });
    return {
      extractorName: 'csv',
      extractorInput: text,
      chunks: extracted.chunks,
    };
  }

  if (extension === '.xlsx') {
    const extracted = extractXlsx({
      docId: args.docId,
      fileName: args.fileName,
      content: args.content,
      documentSensitivity: args.documentSensitivity,
      documentAiUsePolicy: args.documentAiUsePolicy,
    });
    return {
      extractorName: 'xlsx',
      extractorInput: args.content.toString('base64'),
      chunks: extracted.chunks,
    };
  }

  throw new Error(`Unsupported file extension for chunk regeneration: ${extension}`);
}

async function main(): Promise<void> {
  const { docId, dryRun } = parseCliArgs(process.argv.slice(2));
  console.log(`[chunks:regenerate] Start docId=${docId}${dryRun ? ' (dry-run)' : ''}`);

  console.log('[1/5] Loading document metadata from Firestore...');
  const { inventoryDocument } = await loadDocument(docId);
  const storagePath = inventoryDocument.storagePath;
  if (!storagePath) {
    throw new Error(`Document ${docId} has no storagePath.`);
  }
  console.log(`[1/5] OK status=${inventoryDocument.status} storagePath=${storagePath}`);

  console.log('[2/5] Downloading original object from GCS...');
  const rawContent = await readRawObject(storagePath);
  console.log(`[2/5] OK bytes=${rawContent.length}`);

  console.log('[3/5] Extracting chunks...');
  const extracted = extractChunks({
    docId,
    fileName: inventoryDocument.fileName,
    content: rawContent,
    documentSensitivity: inventoryDocument.sensitivity,
    documentAiUsePolicy: inventoryDocument.aiUsePolicy,
  });
  console.log(`[3/5] OK extractor=${extracted.extractorName} chunks=${extracted.chunks.length}`);

  console.log('[4/5] Applying maskKnowledgeChunk to each chunk...');
  const maskedChunks: KnowledgeChunk[] = [];
  for (const [index, chunk] of extracted.chunks.entries()) {
    console.log(`[mask] ${index + 1}/${extracted.chunks.length} chunkId=${chunk.id}`);
    maskedChunks.push(await maskKnowledgeChunk(chunk));
  }
  console.log('[4/5] OK');

  if (dryRun) {
    console.log(
      `[5/5] Dry-run mode: skip Firestore write (would replace ${maskedChunks.length} chunks).`
    );
    return;
  }

  console.log('[5/5] Replacing chunks in Firestore...');
  const chunkAdapter = createChunkFirestoreAdapter();
  await chunkAdapter.replaceChunksForDocument(docId, maskedChunks, {
    extractorInput: extracted.extractorInput,
  });
  console.log(`[5/5] OK replacedChunks=${maskedChunks.length}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

import './loadEnv';
import { FieldPath } from '@google-cloud/firestore';
import { DOCUMENTS_COLLECTION } from '../src/lib/documents';
import { getFirestoreClient } from '../src/lib/firestore';

const BATCH_SIZE = 500;
const PREVIEW_DOC_COUNT = 5;

const USAGE = [
  'Usage:',
  '  pnpm backfill:source-kind --dry-run',
  '  pnpm backfill:source-kind --confirm',
].join('\n');

type Mode = 'dry-run' | 'confirm';

type CliArgs = {
  mode: Mode;
};

function parseCliArgs(argv: string[]): CliArgs {
  let dryRun = false;
  let confirm = false;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--confirm') {
      confirm = true;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}\n${USAGE}`);
    }
  }

  if (dryRun === confirm) {
    throw new Error(
      `Specify exactly one mode: --dry-run or --confirm\n${USAGE}`
    );
  }

  return {
    mode: dryRun ? 'dry-run' : 'confirm',
  };
}

function targetQuery() {
  return getFirestoreClient()
    .collection(DOCUMENTS_COLLECTION)
    .where('schemaVersion', '==', 1);
}

async function runDryRun(): Promise<void> {
  const query = targetQuery();
  const [countSnapshot, previewSnapshot] = await Promise.all([
    query.count().get(),
    query
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(PREVIEW_DOC_COUNT)
      .get(),
  ]);
  const targetCount = countSnapshot.data().count;
  const previewDocIds = previewSnapshot.docs.map((doc) => doc.id);

  console.log('[backfill:source-kind] Dry-run complete (no writes).');
  console.log(`targetCount=${targetCount}`);
  console.log(`previewDocIds=${JSON.stringify(previewDocIds)}`);
  console.log(
    '[backfill:source-kind] To execute writes, rerun with --confirm.'
  );
}

async function runConfirm(): Promise<void> {
  const db = getFirestoreClient();
  const updatePayload = {
    schemaVersion: 2,
    sourceKind: 'upload' as const,
    externalSource: null,
  };

  let processedCount = 0;
  let updatedCount = 0;
  const failedDocIds: string[] = [];
  let pageCursor: string | null = null;
  let batchIndex = 0;

  while (true) {
    let query = targetQuery()
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(BATCH_SIZE);
    if (pageCursor) {
      query = query.startAfter(pageCursor);
    }

    const snapshot = await query.get();
    if (snapshot.empty) {
      break;
    }

    batchIndex += 1;
    processedCount += snapshot.docs.length;
    const firstDocId = snapshot.docs[0]?.id ?? '';
    const lastDocId = snapshot.docs[snapshot.docs.length - 1]?.id ?? '';

    console.log(
      `[backfill:source-kind] batch=${batchIndex} size=${snapshot.docs.length} range=${firstDocId}..${lastDocId}`
    );

    const batch = db.batch();
    for (const doc of snapshot.docs) {
      batch.update(doc.ref, updatePayload);
    }

    try {
      await batch.commit();
      updatedCount += snapshot.docs.length;
    } catch (batchError: unknown) {
      const message =
        batchError instanceof Error ? batchError.message : String(batchError);
      console.error(
        `[backfill:source-kind] batch=${batchIndex} commit failed; fallback to per-doc updates. reason=${message}`
      );

      const perDocResults = await Promise.allSettled(
        snapshot.docs.map(async (doc) => {
          await doc.ref.update(updatePayload);
          return doc.id;
        })
      );

      for (let i = 0; i < perDocResults.length; i += 1) {
        const result = perDocResults[i];
        const docId = snapshot.docs[i]?.id;
        if (!docId) continue;

        if (result.status === 'fulfilled') {
          updatedCount += 1;
          continue;
        }

        failedDocIds.push(docId);
      }
    }

    pageCursor = snapshot.docs[snapshot.docs.length - 1]?.id ?? null;
  }

  console.log('[backfill:source-kind] confirm run complete.');
  console.log(`processedCount=${processedCount}`);
  console.log(`updatedCount=${updatedCount}`);
  console.log(`failedCount=${failedDocIds.length}`);
  console.log(`failedDocIds=${JSON.stringify(failedDocIds)}`);
}

async function main(): Promise<void> {
  const { mode } = parseCliArgs(process.argv.slice(2));

  console.log(
    `[backfill:source-kind] start mode=${mode} batchSize=${BATCH_SIZE}`
  );

  if (mode === 'dry-run') {
    await runDryRun();
    return;
  }

  await runConfirm();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

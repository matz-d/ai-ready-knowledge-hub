import { clearChunksForDoc } from './chunkRegenerator';
import {
  DEMO_SAMPLE_SET_FIELD,
  DEMO_SAMPLE_SET_ID,
} from './demoMode';
import { DOCUMENTS_COLLECTION } from './documents';
import { getFirestoreClient } from './firestore';
import { deleteObjectsWithPrefix } from './storage';

export type PurgeDemoSampleDocumentsResult = {
  docIds: string[];
  gcsObjectsDeleted: number;
  deletedPrefixes: string[];
  failures: Array<{ docId: string; stage: string; error: string }>;
};

function gcsPrefixesForDoc(docId: string): [string, string] {
  return [`raw/${docId}/`, `masked/${docId}/`];
}

async function listDemoSampleDocIds(): Promise<string[]> {
  const snapshot = await getFirestoreClient()
    .collection(DOCUMENTS_COLLECTION)
    .where(DEMO_SAMPLE_SET_FIELD, '==', DEMO_SAMPLE_SET_ID)
    .get();
  return snapshot.docs.map((doc) => doc.id);
}

/**
 * Removes demo-scoped sample documents. Order per doc:
 * chunks → Firestore document → GCS prefixes (`raw/{docId}/`, `masked/{docId}/`).
 */
export async function purgeDemoSampleDocuments(): Promise<PurgeDemoSampleDocumentsResult> {
  const docIds = await listDemoSampleDocIds();
  const deletedPrefixes: string[] = [];
  const failures: PurgeDemoSampleDocumentsResult['failures'] = [];
  let gcsObjectsDeleted = 0;

  for (const docId of docIds) {
    try {
      await clearChunksForDoc(docId);
    } catch (error) {
      failures.push({
        docId,
        stage: 'chunks',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await getFirestoreClient()
        .collection(DOCUMENTS_COLLECTION)
        .doc(docId)
        .delete();
    } catch (error) {
      failures.push({
        docId,
        stage: 'firestore_document',
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    for (const prefix of gcsPrefixesForDoc(docId)) {
      try {
        const deleted = await deleteObjectsWithPrefix(prefix);
        gcsObjectsDeleted += deleted;
        if (deleted > 0) {
          deletedPrefixes.push(prefix);
        }
      } catch (error) {
        failures.push({
          docId,
          stage: `gcs:${prefix}`,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    docIds,
    gcsObjectsDeleted,
    deletedPrefixes,
    failures,
  };
}

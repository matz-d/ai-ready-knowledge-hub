import type { DocumentReference } from '@google-cloud/firestore';
import { deleteMaskedObject, deleteRawObject } from '../storage';

export async function safeDeleteMaskedObject(
  aiSafeStoragePath: string
): Promise<void> {
  try {
    await deleteMaskedObject(aiSafeStoragePath);
  } catch (e) {
    console.error('[orchestrator] masked rollback failed', e);
  }
}
export async function safeDeleteRawObject(storagePath: string): Promise<void> {
  try {
    await deleteRawObject(storagePath);
  } catch (e) {
    console.error('[orchestrator] raw rollback failed', e);
  }
}

export async function safeDeleteFirestoreDoc(
  docRef: DocumentReference
): Promise<void> {
  try {
    await docRef.delete();
  } catch (e) {
    console.error('[orchestrator] firestore rollback failed', e);
  }
}

import { randomUUID } from 'node:crypto';
import type { Timestamp } from '@google-cloud/firestore';
import { FieldValue, getFirestoreClient } from './firestore';

export const DEMO_RESET_LOCK_DOC_PATH = 'demoMaintenance/resetLock';

/** Crash recovery: allow a new reset after this window if the lock was not released. */
export const DEMO_RESET_LOCK_STALE_MS = 30 * 60 * 1000;

export type AcquireDemoResetLockResult =
  | { ok: true; lockId: string }
  | { ok: false; reason: 'reset_in_progress' };

function resetLockRef() {
  return getFirestoreClient().doc(DEMO_RESET_LOCK_DOC_PATH);
}

function isLockStale(lockedAt: Timestamp | undefined): boolean {
  if (!lockedAt || typeof lockedAt.toDate !== 'function') {
    return true;
  }
  return Date.now() - lockedAt.toDate().getTime() >= DEMO_RESET_LOCK_STALE_MS;
}

export async function acquireDemoResetLock(): Promise<AcquireDemoResetLockResult> {
  const lockId = randomUUID();
  const db = getFirestoreClient();
  const ref = resetLockRef();

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const data = snapshot.data();
    if (data?.locked === true && !isLockStale(data.lockedAt as Timestamp | undefined)) {
      return { ok: false, reason: 'reset_in_progress' as const };
    }

    tx.set(
      ref,
      {
        locked: true,
        lockId,
        lockedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: true, lockId };
  });
}

export async function releaseDemoResetLock(lockId: string): Promise<void> {
  const db = getFirestoreClient();
  const ref = resetLockRef();

  try {
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return;

      const data = snapshot.data() ?? {};
      if (data.locked !== true || data.lockId !== lockId) {
        return;
      }

      tx.set(
        ref,
        {
          locked: false,
          lockId: null,
        },
        { merge: true }
      );
    });
  } catch (error) {
    console.warn('[demo] failed to release reset lock', error);
  }
}

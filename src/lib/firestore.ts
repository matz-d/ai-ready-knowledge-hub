import { Firestore, FieldValue } from '@google-cloud/firestore';

let client: Firestore | null = null;

export function getFirestoreClient(): Firestore {
  if (!client) {
    client = new Firestore();
  }
  return client;
}

export { FieldValue };

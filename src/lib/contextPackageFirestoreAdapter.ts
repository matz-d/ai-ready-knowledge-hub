import type { ContextPackageExportInput } from './exportContextPackage';
import type { InventoryDocument } from './inventory';
import { buildContextPackageExportInput } from './contextPackageInput';
import { listInventoryDocumentsFromFirestore } from './inventoryFirestoreAdapter';
import { readTextObject } from './storage';

/** Human-readable reason when `readBody` fails for an export candidate path. */
export const CONTEXT_PACKAGE_GCS_BODY_UNAVAILABLE = 'GCS body unavailable';

export type ContextPackageBodyReader = (objectPath: string) => Promise<string>;

export type AttachContextPackageBodiesOptions = {
  documents: InventoryDocument[];
  readBody?: ContextPackageBodyReader;
};

export type BuildFirestoreContextPackageExportInputOptions = {
  purpose: string;
  generatedAt?: Date | string;
  limit?: number;
  missingKnowledge?: string[];
  questionsForHumanOwner?: string[];
  readBody?: ContextPackageBodyReader;
};

/**
 * Returns the GCS object path whose body may be included in Full AI-Ready Sources.
 * `ai_safe` always uses the masked GCS object; restricted / blocked are metadata-only.
 */
export function contextPackageBodyObjectPath(
  doc: InventoryDocument
): string | null {
  if (doc.status === 'ai_safe') {
    return doc.aiSafeStoragePath ?? null;
  }

  if (doc.status === 'curated') {
    return doc.storagePath ?? null;
  }

  return null;
}

/**
 * Resolves Firestore-derived inventory metadata to export-ready rows by loading body
 * text from GCS. Restricted / blocked / non-terminal rows intentionally do not read
 * object bodies, even when raw storage paths exist.
 */
export async function attachContextPackageBodies(
  options: AttachContextPackageBodiesOptions
): Promise<InventoryDocument[]> {
  const readBody = options.readBody ?? readTextObject;

  return Promise.all(
    options.documents.map(async (doc) => {
      const objectPath = contextPackageBodyObjectPath(doc);
      if (!objectPath) {
        return { ...doc, aiSafeContent: undefined };
      }

      try {
        const body = await readBody(objectPath);
        return {
          ...doc,
          aiSafeContent: body,
          contextPackageBodyLoadError: undefined,
        };
      } catch {
        return {
          ...doc,
          aiSafeContent: undefined,
          contextPackageBodyLoadError: CONTEXT_PACKAGE_GCS_BODY_UNAVAILABLE,
        };
      }
    })
  );
}

export async function buildFirestoreContextPackageExportInput(
  options: BuildFirestoreContextPackageExportInputOptions
): Promise<ContextPackageExportInput> {
  const documents = await listInventoryDocumentsFromFirestore(options.limit);
  const documentsWithBodies = await attachContextPackageBodies({
    documents,
    readBody: options.readBody,
  });

  return buildContextPackageExportInput({
    purpose: options.purpose,
    documents: documentsWithBodies,
    generatedAt: options.generatedAt,
    missingKnowledge: options.missingKnowledge,
    questionsForHumanOwner: options.questionsForHumanOwner,
    allowPlaceholderBodies: false,
  });
}

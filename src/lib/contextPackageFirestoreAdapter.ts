import type { ContextPackageExportInput } from './exportContextPackage';
import type { InventoryDocument } from './inventory';
import { createChunkFirestoreAdapter } from './chunkFirestoreAdapter';
import { buildContextPackageExportInput } from './contextPackageInput';
import { getAllowedExtension } from './documents';
import { xlsxToNormalizedMarkdown } from './extractors/xlsxExtractor';
import { listInventoryDocumentsFromFirestore } from './inventoryFirestoreAdapter';
import { readRawObject, readTextObject } from './storage';

/** Human-readable reason when `readBody` fails for an export candidate path. */
export const CONTEXT_PACKAGE_GCS_BODY_UNAVAILABLE = 'GCS body unavailable';

export type ContextPackageBodyReader = (objectPath: string) => Promise<string>;
export type ContextPackageRawBodyReader = (objectPath: string) => Promise<Buffer>;

export type AttachContextPackageBodiesOptions = {
  documents: InventoryDocument[];
  readBody?: ContextPackageBodyReader;
  readRawBody?: ContextPackageRawBodyReader;
};

export type BuildFirestoreContextPackageExportInputOptions = {
  purpose: string;
  generatedAt?: Date | string;
  limit?: number;
  missingKnowledge?: string[];
  questionsForHumanOwner?: string[];
  readBody?: ContextPackageBodyReader;
  readRawBody?: ContextPackageRawBodyReader;
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
  const readRawBody = options.readRawBody ?? readRawObject;

  return Promise.all(
    options.documents.map(async (doc) => {
      const objectPath = contextPackageBodyObjectPath(doc);
      if (!objectPath) {
        return { ...doc, aiSafeContent: undefined };
      }

      try {
        const body =
          doc.status === 'curated' && getAllowedExtension(doc.fileName) === '.xlsx'
            ? await xlsxToNormalizedMarkdown(await readRawBody(objectPath))
            : await readBody(objectPath);
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
  const chunkAdapter = createChunkFirestoreAdapter();
  const chunkLists = await Promise.all(
    documents.map((doc) => chunkAdapter.listChunksForDocument(doc.id))
  );
  const chunks = chunkLists.flat();
  const docIdsWithChunks = new Set(chunks.map((chunk) => chunk.docId));
  const documentsNeedingBodyFallback = documents.filter(
    (doc) => !docIdsWithChunks.has(doc.id)
  );

  /*
   * Export policy:
   * - documents with chunks use chunk-level text/maskedText as the Full AI-Ready Sources.
   * - documents with zero chunks keep the legacy document-body path so existing live
   *   corpora do not become empty just because chunk regeneration has not run yet.
   */
  const documentsWithBodies = await attachContextPackageBodies({
    documents: documentsNeedingBodyFallback,
    readBody: options.readBody,
    readRawBody: options.readRawBody,
  });
  const bodyFallbackById = new Map(
    documentsWithBodies.map((doc) => [doc.id, doc])
  );
  const documentsForExport = documents.map(
    (doc) => bodyFallbackById.get(doc.id) ?? doc
  );

  return buildContextPackageExportInput({
    purpose: options.purpose,
    documents: documentsForExport,
    chunks,
    generatedAt: options.generatedAt,
    missingKnowledge: options.missingKnowledge,
    questionsForHumanOwner: options.questionsForHumanOwner,
    allowPlaceholderBodies: false,
  });
}

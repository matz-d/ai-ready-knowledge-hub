import { Firestore, FieldValue, Timestamp } from '@google-cloud/firestore';
import {
  assertConversionEvalResultStageShape,
  parseConversionEvalResult,
  type ConversionEvalResult,
} from '../eval/conversion/conversionEvalResult';
import {
  ConversionEvalStageSchema,
  type ConversionEvalStage,
} from '../eval/conversion/conversionEvalStage';
import { DOCUMENTS_COLLECTION } from './documents';
import { getFirestoreClient } from './firestore';

export const CONVERSION_EVAL_COLLECTION = 'conversion_eval';

export class ConversionEvalAlreadyExistsError extends Error {
  constructor(public readonly evalId: string) {
    super(`Conversion eval already exists: ${CONVERSION_EVAL_COLLECTION}/${evalId}`);
    this.name = 'ConversionEvalAlreadyExistsError';
  }
}

export class ConversionEvalParentDocumentNotFoundError extends Error {
  constructor(public readonly docId: string) {
    super(`Parent document not found: ${DOCUMENTS_COLLECTION}/${docId}`);
    this.name = 'ConversionEvalParentDocumentNotFoundError';
  }
}

export type ConversionEvalRecord = {
  evalId: string;
  docId: string;
  revisionId: string;
  stage: ConversionEvalStage;
  result: ConversionEvalResult;
  createdAt: string;
};

export type AppendConversionEvalInput = {
  docId: string;
  revisionId: string;
  stage: ConversionEvalStage;
  result: ConversionEvalResult;
};

export interface ConversionEvalStorageAdapter {
  /**
   * Appends one health/heuristic/golden eval snapshot (append-only).
   * Updates `documents/{docId}.latestConversionEvalId` to the new eval id.
   */
  appendConversionEval(input: AppendConversionEvalInput): Promise<ConversionEvalRecord>;

  /** Returns the newest eval for `docId`, or `null` when none exist. */
  getLatestForDocument(docId: string): Promise<ConversionEvalRecord | null>;
}

/** Builds `evalId` as `docId:revisionId` (Phase 3-H-2 M2 initial convention). */
export function buildConversionEvalId(docId: string, revisionId: string): string {
  if (!docId.trim()) {
    throw new Error('buildConversionEvalId: docId must be non-empty');
  }
  if (!revisionId.trim()) {
    throw new Error('buildConversionEvalId: revisionId must be non-empty');
  }
  return `${docId}:${revisionId}`;
}

/** Splits `evalId` on the last `:` so doc ids may contain colons in future. */
export function parseConversionEvalId(evalId: string): {
  docId: string;
  revisionId: string;
} {
  const separator = evalId.lastIndexOf(':');
  if (separator <= 0 || separator === evalId.length - 1) {
    throw new Error(`parseConversionEvalId: invalid evalId "${evalId}"`);
  }
  return {
    docId: evalId.slice(0, separator),
    revisionId: evalId.slice(separator + 1),
  };
}

type TimestampLike =
  | Timestamp
  | { toDate(): Date }
  | Date
  | string
  | null
  | undefined;

function timestampToIso(value: TimestampLike): string {
  if (!value) {
    throw new Error('conversion eval record is missing createdAt');
  }
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  throw new Error('conversion eval record has an unsupported createdAt value');
}

function parseStoredConversionEval(
  evalId: string,
  raw: Record<string, unknown>
): ConversionEvalRecord {
  const stage = ConversionEvalStageSchema.parse(raw.stage);
  const result = parseConversionEvalResult(raw.result);
  assertConversionEvalResultStageShape(result, stage);

  const docId = typeof raw.docId === 'string' ? raw.docId : parseConversionEvalId(evalId).docId;
  const revisionId =
    typeof raw.revisionId === 'string'
      ? raw.revisionId
      : parseConversionEvalId(evalId).revisionId;

  return {
    evalId,
    docId,
    revisionId,
    stage,
    result,
    createdAt: timestampToIso(raw.createdAt as TimestampLike),
  };
}

export function createConversionEvalStorage(
  db: Firestore = getFirestoreClient()
): ConversionEvalStorageAdapter {
  return {
    async appendConversionEval(input: AppendConversionEvalInput): Promise<ConversionEvalRecord> {
      const stage = ConversionEvalStageSchema.parse(input.stage);
      const result = parseConversionEvalResult(input.result);
      assertConversionEvalResultStageShape(result, stage);

      const evalId = buildConversionEvalId(input.docId, input.revisionId);
      const evalRef = db.collection(CONVERSION_EVAL_COLLECTION).doc(evalId);
      const parentRef = db.collection(DOCUMENTS_COLLECTION).doc(input.docId);

      const [existingEval, parentSnap] = await Promise.all([
        evalRef.get(),
        parentRef.get(),
      ]);

      if (existingEval.exists) {
        throw new ConversionEvalAlreadyExistsError(evalId);
      }
      if (!parentSnap.exists) {
        throw new ConversionEvalParentDocumentNotFoundError(input.docId);
      }

      const createdAt = FieldValue.serverTimestamp();
      const payload = {
        evalId,
        docId: input.docId,
        revisionId: input.revisionId,
        stage,
        result,
        createdAt,
      };

      await evalRef.set(payload, { merge: false });
      await parentRef.update({
        latestConversionEvalId: evalId,
        updatedAt: FieldValue.serverTimestamp(),
      });

      const written = await evalRef.get();
      const data = written.data();
      if (!data) {
        throw new Error(`Conversion eval write failed: ${CONVERSION_EVAL_COLLECTION}/${evalId}`);
      }

      return parseStoredConversionEval(evalId, data as Record<string, unknown>);
    },

    async getLatestForDocument(docId: string): Promise<ConversionEvalRecord | null> {
      const snapshot = await db
        .collection(CONVERSION_EVAL_COLLECTION)
        .where('docId', '==', docId)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

      if (snapshot.empty) {
        return null;
      }

      const doc = snapshot.docs[0];
      return parseStoredConversionEval(doc.id, doc.data() as Record<string, unknown>);
    },
  };
}

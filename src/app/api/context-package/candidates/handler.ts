/**
 * Testable handler for `POST /api/context-package/candidates` (Phase 4-UX S2).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { InventoryDocument } from '../../../../lib/inventory';
import {
  DEMO_MAX_PURPOSE_LENGTH,
  DEMO_SAMPLE_SET_ID,
  isDemoMode,
} from '../../../../lib/demoMode';
import { listInventoryDocumentsFromFirestore } from '../../../../lib/inventoryFirestoreAdapter';
import {
  selectCandidates,
  type SelectCandidatesResult,
} from '../../../../services/candidateSelection';

const DEFAULT_INVENTORY_LIMIT = 300;
const DEFAULT_RESPONSE_LIMIT = 50;

const RequestSchema = z.object({
  purpose: z.string().min(1).max(2000),
  inventoryLimit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(DEFAULT_INVENTORY_LIMIT),
  responseLimit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(DEFAULT_RESPONSE_LIMIT),
});

export type CandidatesRouteDeps = {
  listInventoryDocuments?: (limit: number) => Promise<InventoryDocument[]>;
  selectCandidates?: (
    purpose: string,
    docs: InventoryDocument[],
    options: { responseLimit: number },
  ) => SelectCandidatesResult;
};

export async function handleCandidatesPost(
  request: Request,
  deps: CandidatesRouteDeps = {},
): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        code: 'invalid_request',
        details: 'JSON body を送信してください。',
      },
      { status: 400 },
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { code: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { purpose, inventoryLimit, responseLimit } = parsed.data;
  const demoMode = isDemoMode();
  if (demoMode && purpose.length > DEMO_MAX_PURPOSE_LENGTH) {
    return NextResponse.json(
      {
        code: 'invalid_request',
        details: `公開デモの Purpose は ${DEMO_MAX_PURPOSE_LENGTH} 文字以内にしてください。`,
      },
      { status: 400 },
    );
  }

  const listInventoryDocuments =
    deps.listInventoryDocuments ??
    ((limit: number) =>
      listInventoryDocumentsFromFirestore(limit, {
        ...(demoMode ? { demoSampleSet: DEMO_SAMPLE_SET_ID } : {}),
      }));
  const runSelectCandidates = deps.selectCandidates ?? selectCandidates;

  try {
    const documents = await listInventoryDocuments(inventoryLimit);
    if (documents.length === 0) {
      return NextResponse.json(
        { code: 'no_inventory_documents' },
        { status: 409 },
      );
    }

    const { candidates, missingHints } = runSelectCandidates(purpose, documents, {
      responseLimit,
    });

    return NextResponse.json({
      candidates,
      missingHints,
      inventoryScanned: documents.length,
    });
  } catch (e) {
    console.error('[context-package/candidates] request failed', e);
    return NextResponse.json({ code: 'upstream_failure' }, { status: 502 });
  }
}

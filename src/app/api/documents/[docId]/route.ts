/**
 * `GET /api/documents/[docId]` — 単一 document のメタデータを返す。
 *
 * 文書詳細ページが mount 時に取得し、freshness バッジや再取り込みボタンに使う。
 */
import { NextResponse } from 'next/server';
import { getFirestoreClient } from '../../../../lib/firestore';
import { parseFirestoreDocumentData } from '../../../../lib/parseFirestoreDocumentData';
import { adaptFirestoreDocumentToInventory } from '../../../../lib/inventoryFirestoreAdapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ docId: string }> }
) {
  const { docId } = await params;

  if (!docId?.trim()) {
    return NextResponse.json({ error: 'doc_id_required' }, { status: 400 });
  }

  const db = getFirestoreClient();
  const snapshot = await db.collection('documents').doc(docId).get();

  if (!snapshot.exists) {
    return NextResponse.json({ error: 'document_not_found' }, { status: 404 });
  }

  const parsed = parseFirestoreDocumentData({
    id: snapshot.id,
    ...snapshot.data(),
  });

  const inventory = adaptFirestoreDocumentToInventory(snapshot.id, parsed);

  if (!inventory) {
    return NextResponse.json(
      { error: 'document_not_terminal' },
      { status: 409 }
    );
  }

  return NextResponse.json(inventory);
}

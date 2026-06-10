/**
 * `GET /api/pipeline/status` — ダッシュボードのパイプライン・ファネル用の
 * status 別件数。処理中（uploaded / curating / masking）が動いている間だけ
 * クライアントがポーリングする前提の軽量 endpoint。
 */
import { NextResponse } from 'next/server';
import { countDocumentsByStatusFromFirestore } from '../../../../lib/inventoryFirestoreAdapter';
import { inFlightDocumentCount } from '../../../../lib/pipelineStatusCounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const counts = await countDocumentsByStatusFromFirestore();
    return NextResponse.json({
      counts,
      inFlight: inFlightDocumentCount(counts),
    });
  } catch (error) {
    console.error('[pipeline-status] status count read failed', error);
    return NextResponse.json(
      { error: 'pipeline_status_unavailable' },
      { status: 503 }
    );
  }
}

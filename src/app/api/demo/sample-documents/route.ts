import { NextResponse } from 'next/server';
import { isDemoMode } from '../../../../lib/demoMode';
import { ingestAllDemoSamples } from '../../../../lib/demoSampleDocuments';
import { getKnowledgeHubBucketName } from '../../../../lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isDemoMode()) {
    return NextResponse.json({ error: 'demo_mode_disabled' }, { status: 403 });
  }

  try {
    getKnowledgeHubBucketName();
  } catch {
    return NextResponse.json(
      { error: 'サーバー設定 (KNOWLEDGE_HUB_BUCKET) が未完了です。' },
      { status: 503 }
    );
  }

  const result = await ingestAllDemoSamples(request);
  return NextResponse.json(result);
}

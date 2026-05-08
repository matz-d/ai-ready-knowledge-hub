import { NextResponse } from 'next/server';
import { curatorFlow } from '../../../agents/curator/flow';
import { CuratorInput } from '../../../agents/curator/schema';

/**
 * Curator 単体を JSON で叩く eval / smoke / curl 用 Route Handler。
 * `/upload` などの UI からは呼ばない。ファイルアップロードと基盤副作用の順序は
 * `POST /api/documents` → `orchestrateUploadProcessing`（`src/lib/uploadOrchestrator.ts`）に集約する。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'JSON body を送信してください。' },
      { status: 400 }
    );
  }

  const parsed = CuratorInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'CuratorInput に一致しません。',
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  try {
    const result = await curatorFlow(parsed.data);
    return NextResponse.json(result);
  } catch (e) {
    console.error('[curator] flow failed', e);
    return NextResponse.json(
      { error: 'Curator 実行に失敗しました。' },
      { status: 500 }
    );
  }
}

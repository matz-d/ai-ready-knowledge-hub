import { NextResponse } from 'next/server';
import { curatorFlow } from '../../../agents/curator/flow';
import { CuratorInput } from '../../../agents/curator/schema';

/**
 * W2 Walking Skeleton で `src/app/page.tsx` の Server Action から呼ぶ予定の
 * Curator Flow Route Handler。W1 時点ではまだ UI からの呼び出し経路が無いが、
 * Server Action 配線の seed として残している (D-W1-Close → W2 引き継ぎ)。
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

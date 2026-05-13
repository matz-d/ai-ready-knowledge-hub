/**
 * `GET /api/workspace/freshness` — document 詳細用の Drive modifiedTime 差分問い合わせ。
 *
 * Inventory 一覧から呼ぶと N+1 になるため、この endpoint は詳細ページの read-time
 * 鮮度バッジ専用にする。
 */
import { NextResponse } from 'next/server';
import {
  DriveFreshnessAccessError,
  MissingLatestModifiedTimeError,
  MissingSavedModifiedTimeError,
  NonWorkspaceDocumentError,
  WorkspaceDocumentNotFoundError,
  getWorkspaceFreshness,
} from '../../../../lib/workspaceFreshness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const docId = url.searchParams.get('docId')?.trim();

  if (!docId) {
    return NextResponse.json({ error: 'doc_id_required' }, { status: 400 });
  }

  try {
    const result = await getWorkspaceFreshness(docId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof WorkspaceDocumentNotFoundError) {
      return NextResponse.json({ error: 'document_not_found' }, { status: 404 });
    }

    if (err instanceof NonWorkspaceDocumentError) {
      return NextResponse.json({ error: 'not_workspace_document' }, { status: 400 });
    }

    if (err instanceof MissingSavedModifiedTimeError) {
      return NextResponse.json(
        { error: 'saved_modified_time_missing' },
        { status: 409 }
      );
    }

    if (err instanceof DriveFreshnessAccessError) {
      return NextResponse.json(
        {
          isStale: false,
          savedModifiedTime: err.savedModifiedTime,
          latestModifiedTime: '',
          code: err.code,
        }
      );
    }

    if (err instanceof MissingLatestModifiedTimeError) {
      return NextResponse.json({
        isStale: false,
        savedModifiedTime: err.savedModifiedTime,
        latestModifiedTime: '',
        code: 'latest_modified_time_unknown',
      });
    }

    console.error('[workspace/freshness] freshness check failed', err);
    return NextResponse.json(
      { error: 'workspace_freshness_failed' },
      { status: 502 }
    );
  }
}

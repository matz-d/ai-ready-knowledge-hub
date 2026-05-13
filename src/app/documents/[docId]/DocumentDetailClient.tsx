'use client';

import { useEffect, useState } from 'react';
import { ReimportButton } from '../../_components/ReimportButton';
import type { InventoryDocument } from '../../../lib/inventory';

type FreshnessState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'stale'; savedModifiedTime: string; latestModifiedTime: string }
  | { kind: 'fresh'; savedModifiedTime: string; latestModifiedTime: string }
  | { kind: 'drive_inaccessible'; code: 'drive_not_found' | 'drive_forbidden' }
  | { kind: 'unknown' };

type Props = {
  doc: InventoryDocument;
};

export function DocumentDetailClient({ doc }: Props) {
  const [freshness, setFreshness] = useState<FreshnessState>({ kind: 'idle' });

  const isWorkspace = doc.sourceKind === 'google_workspace';
  const reimportSource =
    doc.externalSourceWebViewLink ?? doc.externalSourceFileId ?? null;

  useEffect(() => {
    if (!isWorkspace) return;
    setFreshness({ kind: 'loading' });

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/workspace/freshness?docId=${encodeURIComponent(doc.id)}`
        );
        if (cancelled) return;

        if (res.ok) {
          const data = (await res.json()) as {
            isStale: boolean;
            savedModifiedTime: string;
            latestModifiedTime: string;
            code?: string;
          };
          if (
            data.code === 'drive_not_found' ||
            data.code === 'drive_forbidden'
          ) {
            setFreshness({
              kind: 'drive_inaccessible',
              code: data.code,
            });
          } else if (data.code === 'latest_modified_time_unknown') {
            setFreshness({ kind: 'unknown' });
          } else {
            setFreshness(
              data.isStale
                ? {
                    kind: 'stale',
                    savedModifiedTime: data.savedModifiedTime,
                    latestModifiedTime: data.latestModifiedTime,
                  }
                : {
                    kind: 'fresh',
                    savedModifiedTime: data.savedModifiedTime,
                    latestModifiedTime: data.latestModifiedTime,
                  }
            );
          }
        } else {
          const body = (await res.json()) as {
            code?: string;
            error?: string;
          };
          const code = body.code;
          if (
            code === 'drive_not_found' ||
            code === 'drive_forbidden'
          ) {
            setFreshness({
              kind: 'drive_inaccessible',
              code: code as 'drive_not_found' | 'drive_forbidden',
            });
          } else if (body.error === 'not_workspace_document') {
            setFreshness({ kind: 'idle' });
          } else {
            setFreshness({ kind: 'unknown' });
          }
        }
      } catch {
        if (!cancelled) {
          setFreshness({ kind: 'unknown' });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [doc.id, isWorkspace]);

  return (
    <div className="doc-detail-workspace">
      {isWorkspace && (
        <div className="doc-detail-drive-row">
          <FreshnessBadge state={freshness} />
          {reimportSource && (
            <ReimportButton urlOrFileId={reimportSource} />
          )}
        </div>
      )}
    </div>
  );
}

function FreshnessBadge({ state }: { state: FreshnessState }) {
  if (state.kind === 'idle') return null;

  if (state.kind === 'loading') {
    return (
      <span className="freshness-badge freshness-badge--loading" role="status">
        鮮度を確認中…
      </span>
    );
  }

  if (state.kind === 'stale') {
    return (
      <span
        className="freshness-badge freshness-badge--stale"
        title={`Drive 最終更新: ${state.latestModifiedTime} / 取り込み時: ${state.savedModifiedTime}`}
        role="status"
      >
        🔄 Drive 上で更新されています
      </span>
    );
  }

  if (state.kind === 'fresh') {
    return (
      <span
        className="freshness-badge freshness-badge--fresh"
        title={`Drive 最終更新: ${state.latestModifiedTime}`}
        role="status"
      >
        ✓ 最新
      </span>
    );
  }

  if (state.kind === 'drive_inaccessible') {
    const label =
      state.code === 'drive_not_found'
        ? 'Drive 上のファイルが見つかりません'
        : 'Drive へのアクセス権がありません';
    return (
      <span
        className="freshness-badge freshness-badge--inaccessible"
        role="alert"
      >
        ⚠ Drive 側で参照できなくなりました（{label}）
      </span>
    );
  }

  if (state.kind === 'unknown') {
    return (
      <span
        className="freshness-badge freshness-badge--unknown"
        role="status"
      >
        鮮度：不明
      </span>
    );
  }

  return null;
}

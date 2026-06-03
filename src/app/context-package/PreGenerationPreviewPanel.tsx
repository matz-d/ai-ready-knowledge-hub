'use client';

/**
 * UI for S7 pre-generation preview. File name is `*Panel.tsx` (not `PreGenerationPreview.tsx`)
 * so imports do not collide with `preGenerationPreview.ts` on case-insensitive filesystems.
 */
import {
  previewRequiresAcknowledgement,
  type PreGenerationPreview,
  type PreviewRow,
} from './preGenerationPreview';

type PreviewSectionProps = {
  title: string;
  titleClass: string;
  count: number;
  emptyLabel: string;
  rows: PreviewRow[];
};

function PreviewSection({
  title,
  titleClass,
  count,
  emptyLabel,
  rows,
}: PreviewSectionProps) {
  return (
    <section className={`cp-safety-column ${titleClass}`}>
      <h3 className="cp-safety-column-title">
        {title}
        <span className="cp-safety-column-count">{count}</span>
      </h3>
      {rows.length === 0 ? (
        <p className="cp-safety-empty">{emptyLabel}</p>
      ) : (
        <ul className="cp-safety-list">
          {rows.map((row) => (
            <li key={row.docId} className="cp-safety-item">
              <strong className="cp-safety-filename">{row.fileName}</strong>
              <span className="cp-safety-meta">
                {row.sensitivity} · {row.status}
              </span>
              <span className="cp-safety-reason">{row.note}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export type PreGenerationPreviewPanelProps = {
  preview: PreGenerationPreview;
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
};

/** Renders projection output only — no safety logic in this component. */
export function PreGenerationPreviewPanel({
  preview,
  acknowledged,
  onAcknowledgedChange,
}: PreGenerationPreviewPanelProps) {
  const needsAck = previewRequiresAcknowledgement(preview);
  const confirmCount =
    preview.counts.warnings + preview.counts.unknownDocIds;

  return (
    <section
      className="cp-safety-review cp-preview"
      aria-label="生成前プレビュー"
      data-testid="cp-pre-generation-preview"
    >
      <header className="cp-safety-review-header">
        <h2 className="cp-safety-review-title">生成前プレビュー</h2>
        <p className="cp-safety-review-lead">
          選択中の文書について、metadata から予測した生成時の扱いです。Restricted
          の自動除外は安全装置と一致します。送信予定は本文ゲートで最終確定され、本文は表示しません。
        </p>
        <p className="cp-preview-summary" data-testid="cp-preview-summary">
          AI へ渡す予定 {preview.counts.willSend} 件 · 自動除外{' '}
          {preview.counts.autoExcluded} 件 · 要確認 {confirmCount} 件
          {preview.counts.unknownDocIds > 0
            ? `（未知の docId ${preview.counts.unknownDocIds} 件）`
            : ''}
        </p>
      </header>

      <div className="cp-safety-grid">
        <PreviewSection
          title="AI へ渡す予定"
          titleClass="cp-safety-column--included"
          count={preview.counts.willSend}
          emptyLabel="選択中に AI へ渡す予定の文書はありません。"
          rows={preview.willSend}
        />
        <PreviewSection
          title="自動除外（AI には渡らない）"
          titleClass="cp-safety-column--excluded"
          count={preview.counts.autoExcluded}
          emptyLabel="Restricted 等で自動除外される文書はありません。"
          rows={preview.autoExcluded}
        />
        <PreviewSection
          title="要確認"
          titleClass="cp-safety-column--review"
          count={confirmCount}
          emptyLabel="確認が必要な文書はありません。"
          rows={preview.warnings}
        />
      </div>

      {preview.unknownDocIds.length > 0 ? (
        <section
          className="cp-safety-missing cp-preview-unknown"
          aria-label="候補一覧にない docId"
          data-testid="cp-preview-unknown"
        >
          <h3 className="cp-safety-missing-title">
            候補一覧にない docId
            <span className="cp-safety-column-count">
              {preview.counts.unknownDocIds}
            </span>
          </h3>
          <ul className="cp-docids-error-list">
            {preview.unknownDocIds.map((docId) => (
              <li key={docId}>
                <code>{docId}</code>
                <span className="cp-preview-unknown-note">
                  {' '}
                  — 存在と内容を確認してください
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {needsAck ? (
        <label className="cp-preview-ack" data-testid="cp-preview-ack">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => onAcknowledgedChange(e.target.checked)}
          />
          <span>
            除外・警告・未知の docId を確認しました（生成時の最終判定は本文ゲートが行います）
          </span>
        </label>
      ) : (
        <p className="cp-preview-ack-optional" data-testid="cp-preview-ack-optional">
          確認が必要な項目はありません。このまま生成できます。
        </p>
      )}
    </section>
  );
}

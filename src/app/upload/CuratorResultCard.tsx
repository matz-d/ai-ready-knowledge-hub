'use client';

import type { DocumentUploadSuccessResponse } from '../../lib/documents';

type Props = {
  result: DocumentUploadSuccessResponse;
};

function sensitivityClass(s: string): string {
  switch (s) {
    case 'Public':
      return 'sensitivity-badge sensitivity-public';
    case 'Internal':
      return 'sensitivity-badge sensitivity-internal';
    case 'Confidential':
      return 'sensitivity-badge sensitivity-confidential';
    case 'Restricted':
      return 'sensitivity-badge sensitivity-restricted';
    default:
      return 'sensitivity-badge sensitivity-internal';
  }
}

const DOCUMENT_FLOW_STATUS_LABEL: Record<
  DocumentUploadSuccessResponse['status'],
  string
> = {
  curated: 'キュレート済',
  blocked: 'ブロック',
  ai_safe: 'AI 利用可',
  restricted: '制限付き',
};

function documentFlowStatusBadgeClass(
  status: DocumentUploadSuccessResponse['status']
): string {
  const base = 'document-flow-status-badge';
  switch (status) {
    case 'curated':
      return `${base} ${base}--curated`;
    case 'blocked':
      return `${base} ${base}--blocked`;
    case 'ai_safe':
      return `${base} ${base}--ai-safe`;
    case 'restricted':
      return `${base} ${base}--restricted`;
    default:
      return `${base} ${base}--curated`;
  }
}

function formatCuratorCompletedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

export function CuratorResultCard({ result }: Props) {
  const { docId, status, curator, fileName } = result;
  const completedAtDisplay = formatCuratorCompletedAt(curator.completedAt);

  return (
    <article className="curator-result-card" aria-label="Curator 分類結果">
      <header className="curator-result-card__header">
        <div className="curator-result-card__title-row">
          <h2>分類結果</h2>
          <span
            className={documentFlowStatusBadgeClass(status)}
            title={status}
          >
            {DOCUMENT_FLOW_STATUS_LABEL[status]}
          </span>
        </div>
        <p className="curator-result-card__file">{fileName}</p>
        <dl className="curator-result-card__meta">
          <div>
            <dt>docId</dt>
            <dd>
              <code className="curator-result-card__code">{docId}</code>
            </dd>
          </div>
          <div>
            <dt>Curator モデル</dt>
            <dd>{curator.modelId}</dd>
          </div>
          <div>
            <dt>Curator 完了時刻</dt>
            <dd>
              <time dateTime={curator.completedAt}>{completedAtDisplay}</time>
            </dd>
          </div>
        </dl>
      </header>
      <dl className="curator-result-grid">
        <div>
          <dt>文書種別</dt>
          <dd>{curator.documentType}</dd>
        </div>
        <div>
          <dt>業務ドメイン</dt>
          <dd>{curator.businessDomain}</dd>
        </div>
        <div>
          <dt>機密度</dt>
          <dd>
            <span className={sensitivityClass(curator.sensitivity)}>
              {curator.sensitivity}
            </span>
          </dd>
        </div>
        <div>
          <dt>鮮度</dt>
          <dd>{curator.freshness}</dd>
        </div>
        <div>
          <dt>正本候補</dt>
          <dd>{curator.isAuthoritativeCandidate ? 'はい' : 'いいえ'}</dd>
        </div>
        <div>
          <dt>AI 利用方針</dt>
          <dd>{curator.aiUsePolicy}</dd>
        </div>
        {status === 'restricted' && result.sensitivityReason ? (
          <div className="curator-result-restricted">
            <dt>制限理由</dt>
            <dd>{result.sensitivityReason}</dd>
          </div>
        ) : null}
        {status === 'restricted' && result.originalCuratorSensitivity ? (
          <div className="curator-result-restricted">
            <dt>Curator 当初の機密度</dt>
            <dd>{result.originalCuratorSensitivity}</dd>
          </div>
        ) : null}
        <div className="curator-result-rationale">
          <dt>根拠</dt>
          <dd>{curator.rationale}</dd>
        </div>
      </dl>
    </article>
  );
}

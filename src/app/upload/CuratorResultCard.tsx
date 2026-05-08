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

export function CuratorResultCard({ result }: Props) {
  const { curator, fileName } = result;
  return (
    <article className="curator-result-card" aria-label="Curator 分類結果">
      <header className="curator-result-card__header">
        <h2>分類結果</h2>
        <p className="curator-result-card__file">{fileName}</p>
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
        <div className="curator-result-rationale">
          <dt>根拠</dt>
          <dd>{curator.rationale}</dd>
        </div>
      </dl>
    </article>
  );
}

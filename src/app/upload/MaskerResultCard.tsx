'use client';

import type { DocumentUploadSuccessResponse } from '../../lib/documents';

type Props = {
  result: DocumentUploadSuccessResponse;
};

export function MaskerResultCard({ result }: Props) {
  const { masker, status } = result;
  if (!masker) {
    return null;
  }

  const cardClass =
    status === 'ai_safe'
      ? 'masker-result-card masker-result-card--ai-safe'
      : status === 'restricted'
        ? 'masker-result-card masker-result-card--restricted'
        : 'masker-result-card';

  return (
    <article className={cardClass} aria-label="Masker 処理結果">
      <header className="masker-result-card__header">
        <h2>Masker 結果</h2>
      </header>

      {status === 'ai_safe' ? (
        <div
          className="masker-result-card__banner masker-result-card__banner--ai-safe"
          role="status"
        >
          <p className="masker-result-card__banner-title">
            マスク済み AI 参照版を生成済み
          </p>
          {result.aiSafeStoragePath ? (
            <p className="masker-result-card__banner-path">
              <span className="masker-result-card__path-label">
                AI 参照版ストレージパス
              </span>
              <code>{result.aiSafeStoragePath}</code>
            </p>
          ) : null}
        </div>
      ) : null}

      {status === 'restricted' ? (
        <div
          className="masker-result-card__banner masker-result-card__banner--restricted"
          role="status"
        >
          <p className="masker-result-card__banner-title">
            Masker が Restricted に昇格
          </p>
          {result.originalCuratorSensitivity != null &&
          result.originalCuratorSensitivity !== '' ? (
            <p className="masker-result-card__banner-meta">
              <span className="masker-result-card__path-label">
                Curator 時点の機密度
              </span>
              <span>{result.originalCuratorSensitivity}</span>
            </p>
          ) : null}
          {result.sensitivityReason != null && result.sensitivityReason !== '' ? (
            <p className="masker-result-card__banner-meta">
              <span className="masker-result-card__path-label">理由</span>
              <span>{result.sensitivityReason}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      <dl className="curator-result-grid masker-result-card__grid">
        <div>
          <dt>判定（decision）</dt>
          <dd>{masker.decision}</dd>
        </div>
        <div>
          <dt>マスクスパン数（maskedSpansCount）</dt>
          <dd>{masker.maskedSpansCount}</dd>
        </div>
        <div>
          <dt>残存リスク検出（residualRisk.detected）</dt>
          <dd>{masker.residualRisk.detected ? 'あり' : 'なし'}</dd>
        </div>
        <div className="curator-result-rationale">
          <dt>残存リスク理由（residualRisk.reasons）</dt>
          <dd>
            {masker.residualRisk.reasons.length === 0 ? (
              <span className="masker-result-card__empty">（なし）</span>
            ) : (
              <ul className="masker-result-card__reasons">
                {masker.residualRisk.reasons.map((r, i) => (
                  <li key={`${i}-${r}`}>{r}</li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt>推奨機密度（recommendedSensitivity）</dt>
          <dd>{masker.recommendedSensitivity}</dd>
        </div>
        <div className="curator-result-rationale">
          <dt>根拠（rationale）</dt>
          <dd>{masker.rationale}</dd>
        </div>
        <div>
          <dt>モデル（modelId）</dt>
          <dd>
            <code className="masker-result-card__mono">{masker.modelId}</code>
          </dd>
        </div>
        <div>
          <dt>完了時刻（completedAt）</dt>
          <dd>{masker.completedAt}</dd>
        </div>
      </dl>
    </article>
  );
}

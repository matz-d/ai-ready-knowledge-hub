'use client';

import {
  candidateDisplayReason,
  groupCandidatesByRecommendation,
  type CandidateRow,
} from './candidateSelectionUi';
import { buildCandidateDecisionTrace } from '../../lib/decisionTrace';

type SafetyReviewPanelProps = {
  candidates: CandidateRow[];
  missingHints: string[];
  selectedDocIds?: ReadonlySet<string>;
};

type ReviewColumnProps = {
  title: string;
  titleClass: string;
  count: number;
  emptyLabel: string;
  items: CandidateRow[];
  selectedDocIds?: ReadonlySet<string>;
  showSelectedState?: boolean;
};

function ReviewColumn({
  title,
  titleClass,
  count,
  emptyLabel,
  items,
  selectedDocIds,
  showSelectedState = false,
}: ReviewColumnProps) {
  return (
    <section className={`cp-safety-column ${titleClass}`}>
      <h3 className="cp-safety-column-title">
        {title}
        <span className="cp-safety-column-count">{count}</span>
      </h3>
      {items.length === 0 ? (
        <p className="cp-safety-empty">{emptyLabel}</p>
      ) : (
        <ul className="cp-safety-list">
          {items.map((candidate) => {
            const reason = candidateDisplayReason(candidate);
            const selected =
              showSelectedState && selectedDocIds?.has(candidate.docId);
            const trace = buildCandidateDecisionTrace(candidate);

            return (
              <li key={candidate.docId} className="cp-safety-item">
                <strong className="cp-safety-filename">{candidate.fileName}</strong>
                <span className="cp-safety-meta">
                  {candidate.documentType} · {candidate.businessDomain} ·{' '}
                  {candidate.sensitivity}
                </span>
                {reason ? (
                  <span className="cp-safety-reason">{reason}</span>
                ) : null}
                <details className="cp-safety-trace">
                  <summary>Decision Trace</summary>
                  <ol>
                    {trace.map((step) => (
                      <li key={`${candidate.docId}-${step.label}`}>
                        <strong>{step.label}</strong>
                        <span>{step.detail}</span>
                      </li>
                    ))}
                  </ol>
                </details>
                {showSelectedState ? (
                  <span
                    className={`cp-safety-selected${selected ? ' cp-safety-selected--on' : ''}`}
                  >
                    {selected ? '生成対象に選択中' : '未選択'}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Pre-generation safety summary: include / exclude / needs_review in three columns,
 * plus missing hints. Metadata-only — no document body.
 */
export function SafetyReviewPanel({
  candidates,
  missingHints,
  selectedDocIds,
}: SafetyReviewPanelProps) {
  const grouped = groupCandidatesByRecommendation(candidates);

  return (
    <section
      className="cp-safety-review"
      aria-label="生成前の安全確認"
      data-testid="cp-safety-review"
    >
      <header className="cp-safety-review-header">
        <h2 className="cp-safety-review-title">生成前の安全確認</h2>
        <p className="cp-safety-review-lead">
          候補 API の metadata 分類です。本文は表示しません。実際に AI
          へ渡るかの最終判定は生成処理で行われます。
        </p>
      </header>

      <div className="cp-safety-grid">
        <ReviewColumn
          title="AI に渡せる候補"
          titleClass="cp-safety-column--included"
          count={grouped.include.length}
          emptyLabel="推奨される文書はありません。"
          items={grouped.include}
          selectedDocIds={selectedDocIds}
          showSelectedState
        />
        <ReviewColumn
          title="除外すべき"
          titleClass="cp-safety-column--excluded"
          count={grouped.exclude.length}
          emptyLabel="除外対象の文書はありません。"
          items={grouped.exclude}
        />
        <ReviewColumn
          title="人間確認すべき"
          titleClass="cp-safety-column--review"
          count={grouped.needs_review.length}
          emptyLabel="要確認の文書はありません。"
          items={grouped.needs_review}
          selectedDocIds={selectedDocIds}
          showSelectedState
        />
      </div>

      <section
        className="cp-safety-missing"
        aria-label="足りない情報"
        data-testid="cp-safety-missing"
      >
        <h3 className="cp-safety-missing-title">
          足りない情報
          <span className="cp-safety-column-count">{missingHints.length}</span>
        </h3>
        {missingHints.length === 0 ? (
          <p className="cp-safety-empty">
            Purpose から推定した領域に、明らかな不足は検出されませんでした。
          </p>
        ) : (
          <ul className="cp-text-list">
            {missingHints.map((hint, index) => (
              <li key={`${index}-${hint}`}>{hint}</li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

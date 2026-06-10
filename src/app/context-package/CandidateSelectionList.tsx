'use client';

import {
  MAX_CONTEXT_PACKAGE_DOC_IDS,
  RECOMMENDATION_LABEL,
  type CandidateRow,
} from './candidateSelectionUi';

type CandidateSelectionListProps = {
  candidates: CandidateRow[];
  inventoryScanned: number;
  selectedDocIds: ReadonlySet<string>;
  onToggle: (docId: string, checked: boolean) => void;
  disabled?: boolean;
};

function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

export function CandidateSelectionList({
  candidates,
  inventoryScanned,
  selectedDocIds,
  onToggle,
  disabled = false,
}: CandidateSelectionListProps) {
  const selectedCount = candidates.filter(
    (c) => c.recommendation !== 'exclude' && selectedDocIds.has(c.docId),
  ).length;

  return (
    <section
      className="cp-candidates"
      aria-label="候補文書"
      data-testid="cp-candidate-selection"
    >
      <div className="cp-candidates-header">
        <h2 className="cp-candidates-title">候補文書</h2>
        <p className="cp-candidates-meta">
          Inventory {inventoryScanned} 件をスキャン · 上位 {candidates.length}{' '}
          件を表示 · {selectedCount} / {MAX_CONTEXT_PACKAGE_DOC_IDS} 件を選択中
        </p>
      </div>

      <ul className="cp-candidate-list">
        {candidates.map((candidate) => {
          const isExclude = candidate.recommendation === 'exclude';
          const isChecked = selectedDocIds.has(candidate.docId);
          const isSelectionLimitReached =
            !isChecked && selectedCount >= MAX_CONTEXT_PACKAGE_DOC_IDS;
          const reasonText =
            candidate.recommendation === 'include'
              ? candidate.matchReason
              : candidate.reasonLabel ?? candidate.reasonDetail;

          return (
            <li
              key={candidate.docId}
              className={`cp-candidate-item cp-candidate-item--${candidate.recommendation}`}
            >
              <label
                className={`cp-candidate-row${isExclude ? ' cp-candidate-row--disabled' : ''}`}
              >
                <input
                  type="checkbox"
                  className="cp-candidate-checkbox"
                  checked={isChecked}
                  disabled={disabled || isExclude || isSelectionLimitReached}
                  onChange={(e) => onToggle(candidate.docId, e.target.checked)}
                  aria-label={`${candidate.fileName} を Context Package に含める`}
                />
                <span className="cp-candidate-body">
                  <span className="cp-candidate-title-row">
                    <strong className="cp-candidate-filename">
                      {candidate.fileName}
                    </strong>
                    <span
                      className={`cp-badge cp-badge--rec-${candidate.recommendation}`}
                    >
                      {RECOMMENDATION_LABEL[candidate.recommendation]}
                    </span>
                    <span className="cp-badge cp-badge--sensitivity">
                      {candidate.sensitivity}
                    </span>
                    <span className="cp-badge cp-badge--status">
                      {candidate.status}
                    </span>
                  </span>
                  <span className="cp-candidate-meta">
                    {candidate.documentType} · {candidate.businessDomain} ·
                    関連スコア {formatScore(candidate.score)}
                    {candidate.isAuthoritativeCandidate ? ' · 正本候補' : ''}
                  </span>
                  {reasonText ? (
                    <span className="cp-candidate-reason">{reasonText}</span>
                  ) : null}
                  {candidate.recommendation === 'needs_review' ? (
                    <span className="cp-candidate-review-note">
                      人間による確認後に選択してください。
                    </span>
                  ) : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

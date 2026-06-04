/* @vitest-environment jsdom */

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SafetyReviewPanel } from '../SafetyReviewPanel';
import type { CandidateRow } from '../candidateSelectionUi';

const candidates: CandidateRow[] = [
  {
    docId: 'doc-include',
    fileName: '給与.csv',
    documentType: '表',
    businessDomain: '給与計算',
    sensitivity: 'Internal',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    status: 'curated',
    score: 0.9,
    recommendation: 'include',
    matchReason: '給与計算に関連',
  },
  {
    docId: 'doc-exclude',
    fileName: '契約.pdf',
    documentType: '契約書',
    businessDomain: '顧問契約管理',
    sensitivity: 'Restricted',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    status: 'restricted',
    score: 0.1,
    recommendation: 'exclude',
    reasonLabel: 'Restricted 情報',
  },
  {
    docId: 'doc-review',
    fileName: '旧版.pdf',
    documentType: 'マニュアル',
    businessDomain: '給与計算',
    sensitivity: 'Internal',
    freshness: 'superseded_candidate',
    isAuthoritativeCandidate: false,
    status: 'curated',
    score: 0.5,
    recommendation: 'needs_review',
    reasonLabel: '古い／上書き候補',
  },
];

afterEach(() => {
  cleanup();
});

describe('SafetyReviewPanel', () => {
  it('renders three columns with reasonLabel / matchReason and missing hints', () => {
    render(
      <SafetyReviewPanel
        candidates={candidates}
        missingHints={['給与計算領域に現行版の正本候補文書がありません']}
        selectedDocIds={new Set(['doc-include'])}
      />,
    );

    const panel = screen.getByTestId('cp-safety-review');
    expect(within(panel).getByText('AI に渡せる候補')).toBeTruthy();
    expect(within(panel).getByText('除外すべき')).toBeTruthy();
    expect(within(panel).getByText('人間確認すべき')).toBeTruthy();
    expect(within(panel).getByText('給与計算に関連')).toBeTruthy();
    expect(within(panel).getByText('Restricted 情報')).toBeTruthy();
    expect(within(panel).getByText('古い／上書き候補')).toBeTruthy();
    expect(within(panel).getByText('生成対象に選択中')).toBeTruthy();

    const missing = screen.getByTestId('cp-safety-missing');
    expect(
      within(missing).getByText('給与計算領域に現行版の正本候補文書がありません'),
    ).toBeTruthy();
  });

  it('does not render body or doc content fields', () => {
    const { container } = render(
      <SafetyReviewPanel candidates={candidates} missingHints={[]} />,
    );
    expect(container.textContent).not.toMatch(/aiSafeContent|maskedText/);
  });
});

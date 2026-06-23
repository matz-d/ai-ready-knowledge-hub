import type { InventoryDocument } from './inventory';
import {
  AI_USE_POLICY_LABELS,
  DOCUMENT_STATUS_LABELS,
  SENSITIVITY_LABELS,
} from './displayLabels';

type TraceCandidate = {
  recommendation: 'include' | 'exclude' | 'needs_review';
  matchReason?: string;
  reasonLabel?: string;
  reasonDetail?: string;
  reasonCode?: string;
  scoreBreakdown?: Record<string, number>;
};

export type DecisionTraceStep = {
  label: string;
  detail: string;
};

function scoreBreakdownSummary(scoreBreakdown?: Record<string, number>): string | null {
  if (!scoreBreakdown) return null;
  const positive = Object.entries(scoreBreakdown)
    .filter(([, score]) => score > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);
  if (positive.length === 0) return null;
  return positive.map(([key, score]) => `${key}: ${score}`).join(' / ');
}

export function buildCandidateDecisionTrace(
  candidate: TraceCandidate,
): DecisionTraceStep[] {
  const steps: DecisionTraceStep[] = [];

  if (candidate.matchReason) {
    steps.push({
      label: '目的との照合',
      detail: `一致根拠: ${candidate.matchReason}`,
    });
  }

  const breakdown = scoreBreakdownSummary(candidate.scoreBreakdown);
  if (breakdown) {
    steps.push({
      label: '関連スコア',
      detail: breakdown,
    });
  }

  if (candidate.reasonLabel ?? candidate.reasonDetail) {
    steps.push({
      label: '除外/確認理由',
      detail: `理由: ${[candidate.reasonLabel, candidate.reasonDetail]
        .filter(Boolean)
        .join(' - ')}`,
    });
  }

  if (candidate.reasonCode) {
    steps.push({
      label: '決定ルール',
      detail: candidate.reasonCode,
    });
  }

  const finalDetail =
    candidate.recommendation === 'include'
      ? 'AI に渡せる候補として選択可能'
      : candidate.recommendation === 'exclude'
        ? 'AI には渡さず Context Package から除外'
        : '人間が確認してから利用可否を判断';

  steps.push({
    label: '最終判断',
    detail: finalDetail,
  });

  return steps;
}

export function buildInventoryDecisionTrace(
  doc: InventoryDocument,
): DecisionTraceStep[] {
  // Curator の元判定を表示する。masker 格上げ済みなのに originalCuratorSensitivity が
  // 記録されていない旧データでは、格上げ後の sensitivity を Curator の判定として
  // 誤表示しないよう「記録なし」と明示する。
  const curatorSensitivity = doc.originalCuratorSensitivity
    ? SENSITIVITY_LABELS[doc.originalCuratorSensitivity]
    : doc.sensitivitySource === 'masker'
      ? '（元判定の記録なし）'
      : SENSITIVITY_LABELS[doc.sensitivity];

  const steps: DecisionTraceStep[] = [
    {
      label: 'Curator 分類',
      detail: `${doc.documentType} / ${doc.businessDomain} / ${curatorSensitivity}`,
    },
    {
      label: 'AI 利用方針',
      detail: AI_USE_POLICY_LABELS[doc.aiUsePolicy],
    },
  ];

  if (doc.curator?.rationale ?? doc.rationale) {
    steps.push({
      label: '分類理由',
      detail: doc.curator?.rationale ?? doc.rationale,
    });
  }

  if (doc.maskerEvaluation) {
    steps.push({
      label: 'Masker 判定',
      detail: `残存リスク${
        doc.maskerEvaluation.residualRisk.detected ? 'あり' : 'なし'
      } / 推奨機密度 ${
        SENSITIVITY_LABELS[doc.maskerEvaluation.recommendedSensitivity]
      }`,
    });
  }

  if (doc.sensitivitySource === 'masker' && doc.sensitivityReason) {
    steps.push({
      label: '格上げ理由',
      detail: doc.sensitivityReason,
    });
  }

  if (doc.restrictionSource === 'safety_gate') {
    steps.push({
      label: 'Safety Gate',
      detail: '決定論的な安全ゲートにより AI 利用から除外',
    });
  }

  steps.push({
    label: '最終状態',
    detail: `${DOCUMENT_STATUS_LABELS[doc.status]} / ${
      SENSITIVITY_LABELS[doc.sensitivity]
    }`,
  });

  return steps;
}

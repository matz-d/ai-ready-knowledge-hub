import { describe, expect, it } from 'vitest';
import {
  buildCandidateDecisionTrace,
  buildInventoryDecisionTrace,
} from '../decisionTrace';
import type { InventoryDocument } from '../inventory';

describe('decisionTrace', () => {
  it('explains an included candidate from match and score metadata', () => {
    const trace = buildCandidateDecisionTrace({
      recommendation: 'include',
      matchReason: '業務領域「給与計算」が目的に一致',
      scoreBreakdown: { domain: 4, filename: 2, stale: 0 },
    });

    expect(trace).toEqual([
      {
        label: '目的との照合',
        detail: '一致根拠: 業務領域「給与計算」が目的に一致',
      },
      { label: '関連スコア', detail: 'domain: 4 / filename: 2' },
      { label: '最終判断', detail: 'AI に渡せる候補として選択可能' },
    ]);
  });

  it('explains excluded candidates without requiring document body text', () => {
    const trace = buildCandidateDecisionTrace({
      recommendation: 'exclude',
      reasonCode: 'restricted_sensitivity',
      reasonLabel: 'Restricted 情報',
    });

    expect(trace).toContainEqual({
      label: '除外/確認理由',
      detail: '理由: Restricted 情報',
    });
    expect(trace).toContainEqual({
      label: '決定ルール',
      detail: 'restricted_sensitivity',
    });
    expect(trace.at(-1)).toEqual({
      label: '最終判断',
      detail: 'AI には渡さず Context Package から除外',
    });
  });

  it('explains document-level Curator, Masker, and final-state decisions', () => {
    const doc: InventoryDocument = {
      id: 'doc-1',
      fileName: '契約書.txt',
      status: 'restricted',
      documentType: '契約書',
      businessDomain: '顧問契約管理',
      sensitivity: 'Restricted',
      freshness: 'current',
      isAuthoritativeCandidate: false,
      aiUsePolicy: 'blocked',
      rationale: '個別契約の情報を含む',
      sensitivitySource: 'masker',
      originalCuratorSensitivity: 'Confidential',
      sensitivityReason: '残存リスクが高い',
      maskerEvaluation: {
        residualRisk: {
          detected: true,
          reasons: ['固有名詞が残る'],
        },
        recommendedSensitivity: 'Restricted',
        rationale: '再識別可能',
      },
    };

    const trace = buildInventoryDecisionTrace(doc);

    expect(trace).toContainEqual({
      label: 'Curator 分類',
      detail: '契約書 / 顧問契約管理 / 機密',
    });
    expect(trace).toContainEqual({
      label: 'Masker 判定',
      detail: '残存リスクあり / 推奨機密度 厳重管理',
    });
    expect(trace).toContainEqual({
      label: '格上げ理由',
      detail: '残存リスクが高い',
    });
    expect(trace.at(-1)).toEqual({
      label: '最終状態',
      detail: '保護中 / 厳重管理',
    });
  });

  it('marks needs_review candidates as requiring human judgment', () => {
    const trace = buildCandidateDecisionTrace({
      recommendation: 'needs_review',
      reasonCode: 'duplicate_version_ambiguity',
      reasonLabel: '正本が曖昧',
    });

    expect(trace).toContainEqual({
      label: '決定ルール',
      detail: 'duplicate_version_ambiguity',
    });
    expect(trace.at(-1)).toEqual({
      label: '最終判断',
      detail: '人間が確認してから利用可否を判断',
    });
  });

  it('surfaces the deterministic Safety Gate exclusion step', () => {
    const doc: InventoryDocument = {
      id: 'doc-gate',
      fileName: '顧客名簿.csv',
      status: 'restricted',
      documentType: '表',
      businessDomain: '顧客対応',
      sensitivity: 'Restricted',
      freshness: 'current',
      isAuthoritativeCandidate: false,
      aiUsePolicy: 'direct',
      rationale: '記入欄にマスク不能な個人情報が残る',
      sensitivitySource: 'curator',
      restrictionSource: 'safety_gate',
    };

    const trace = buildInventoryDecisionTrace(doc);

    expect(trace).toContainEqual({
      label: 'Safety Gate',
      detail: '決定論的な安全ゲートにより AI 利用から除外',
    });
    expect(trace.at(-1)).toEqual({
      label: '最終状態',
      detail: '保護中 / 厳重管理',
    });
  });

  it('does not attribute the promoted sensitivity to Curator when the original is unrecorded', () => {
    const doc: InventoryDocument = {
      id: 'doc-legacy',
      fileName: '旧契約.txt',
      status: 'restricted',
      documentType: '契約書',
      businessDomain: '顧問契約管理',
      sensitivity: 'Restricted',
      freshness: 'current',
      isAuthoritativeCandidate: false,
      aiUsePolicy: 'blocked',
      rationale: '再識別リスクが高い',
      sensitivitySource: 'masker',
      // originalCuratorSensitivity は旧データのため未記録
    };

    const trace = buildInventoryDecisionTrace(doc);

    expect(trace).toContainEqual({
      label: 'Curator 分類',
      detail: '契約書 / 顧問契約管理 / （元判定の記録なし）',
    });
  });
});

# docs/ インデックス

`docs/` 内ドキュメントの入口。ファイルは移動せずリンクのみ（リンク切れ回避）。作業順・優先度の正本は各 doc 冒頭の宣言に従う。

## 現役の正本

直近の判断・運用・提出準備に参照する文書。

| 文書 | 内容 |
|---|---|
| [next-actions-2026-06-10.md](next-actions-2026-06-10.md) | 提出前の作業優先順位（P0〜P3） |
| [refactoring-plan-2026-06-11.md](refactoring-plan-2026-06-11.md) | リファクタリング計画・実施状況 |
| [operate-deliver-readiness.md](operate-deliver-readiness.md) | 納品・デモ・E2E 検証の運用手順 |
| [production-readiness.md](production-readiness.md) | 本番 readiness チェックリスト |
| [p1-d-extraction-masking-quality-gate.md](p1-d-extraction-masking-quality-gate.md) | P1-D 品質ゲート設計 |
| [p1-d-evidence-2026-06-11.md](p1-d-evidence-2026-06-11.md) | P1-D 証跡 |
| [p1-f-full-coverage-strategist.md](p1-f-full-coverage-strategist.md) | P1-F async full-coverage strategist |
| [p1-f-review-follow-up-tasks.md](p1-f-review-follow-up-tasks.md) | P1-F レビュー残タスク |
| [decisions.md](decisions.md) | 意思決定ログ（D1〜 + Phase 別採用判断） |
| [architecture.md](architecture.md) | システム構成 |
| [firestore-schema.md](firestore-schema.md) | Firestore スキーマ |
| [setup-gcp.md](setup-gcp.md) | GCP セットアップ |
| [open-questions.md](open-questions.md) | 未決定事項・次フェーズ候補 |
| [demo-runbook.md](demo-runbook.md) / [demo-scenario.md](demo-scenario.md) | デモ手順・シナリオ |
| [delivery-e2e/](delivery-e2e/) | delivery E2E 検証ログ・ケース別ソース |

## プロダクト・技術の背景（参照用）

| 文書 | 内容 |
|---|---|
| [concept.md](concept.md) / [scope.md](scope.md) | コンセプト・スコープ |
| [tech-stack.md](tech-stack.md) | 技術スタック |
| [offering-model.md](offering-model.md) | 提供モデル |
| [gemini-model-migration.md](gemini-model-migration.md) | Gemini モデル移行メモ |
| [security/npm-supply-chain-2026-05-12.md](security/npm-supply-chain-2026-05-12.md) | npm サプライチェーン対策 |
| [curator-classification-precision-2026-06-09.md](curator-classification-precision-2026-06-09.md) | Curator 分類 precision 調査 |

## 完了フェーズの歴史

実装・検証は完了。新規作業の正本にしない。証跡・当時の方針確認用。

### Phase 2

| 文書 | 内容 |
|---|---|
| [phase-2-design.md](phase-2-design.md) | Phase 2 設計 |
| [phase-2-live-smoke.md](phase-2-live-smoke.md) | live smoke 証跡 |

### Phase 3（方向性・実装記録）

| 文書 | 内容 |
|---|---|
| [phase-3-b-workspace-resync.md](phase-3-b-workspace-resync.md) | Google Workspace resync |
| [phase-3-c-direction.md](phase-3-c-direction.md) | 認証・デプロイ方針 |
| [phase-3-c-5-source-coverage.md](phase-3-c-5-source-coverage.md) | source coverage 確認 |
| [phase-3-d-direction.md](phase-3-d-direction.md) | CI/CD + IAP + AuditEvent（完了） |
| [phase-3-e-direction.md](phase-3-e-direction.md) | Processing Boundary（完了） |
| [phase-3-google-sheets-import.md](phase-3-google-sheets-import.md) | Google Sheets import |
| [phase-3-h-direction.md](phase-3-h-direction.md) | Document Conversion PoC 方針 |
| [phase-3-h-2-direction.md](phase-3-h-2-direction.md) | official-doc-pdf 本線（完了） |
| [phase-3-h-2-monthly-review.md](phase-3-h-2-monthly-review.md) | monthly review |
| [phase-3-h-slide-pdf-poc.md](phase-3-h-slide-pdf-poc.md) | slide-pdf PoC |
| [phase-3-h-3-direction.md](phase-3-h-3-direction.md) | slide/scan-pdf 本線（完了） |
| [phase-3-h-3-slide-pdf-live-smoke.md](phase-3-h-3-slide-pdf-live-smoke.md) | slide-pdf live smoke |
| [phase-3-h-3-scan-pdf-live-smoke.md](phase-3-h-3-scan-pdf-live-smoke.md) | scan-pdf live smoke |
| [phase-3-h-3-scan-pdf-golden-baseline.md](phase-3-h-3-scan-pdf-golden-baseline.md) | scan-pdf golden baseline |
| [phase-3-h-3-scan-pdf-poc-measurement.md](phase-3-h-3-scan-pdf-poc-measurement.md) | scan-pdf PoC 計測 |
| [phase-3-h-3-scan-pdf-w5b-unmaskable-fixture.md](phase-3-h-3-scan-pdf-w5b-unmaskable-fixture.md) | unmaskable fixture |
| [phase-3-m-pdf-masker-live-smoke.md](phase-3-m-pdf-masker-live-smoke.md) | PDF masker live smoke |
| [iap-evidence/](iap-evidence/) | Phase 3-D IAP 完了証跡 |

### Phase 4 UX

| 文書 | 内容 |
|---|---|
| [phase-4-ux-direction.md](phase-4-ux-direction.md) | Phase 4 UX 方針 |
| [phase-4-ux-manual-pass-2026-06-10.md](phase-4-ux-manual-pass-2026-06-10.md) | ブラウザ手動通し証跡 |
| [phase-4-ux-evidence/](phase-4-ux-evidence/) | UX evidence（スクリーンショット等） |

### その他の歴史・イベント

| 文書 | 内容 |
|---|---|
| [week1-retrospective.md](week1-retrospective.md) | Week 1 振り返り |
| [hackathon.md](hackathon.md) | ハッカソン記録 |
| [w1-artifacts/inventory.snapshot.json](w1-artifacts/inventory.snapshot.json) | W1 inventory スナップショット |

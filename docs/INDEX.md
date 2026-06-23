# docs/ インデックス

`docs/` 内ドキュメントの入口。作業順・優先度の正本は各 doc 冒頭の宣言に従う。

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
| [p1-e-large-file-pre-splitting.md](p1-e-large-file-pre-splitting.md) | P1-E large file / table fallback / locator enrichment 方針 |
| [p1-e-plus-scan-pdf-quality-floor-2026-06-18.md](p1-e-plus-scan-pdf-quality-floor-2026-06-18.md) | P1-E+ scan-pdf quality floor 証跡（refresh safety guard / drift 3→0 / targeted product-quality follow-up） |
| [table-assist-async-ingest-live-smoke-2026-06-18.md](table-assist-async-ingest-live-smoke-2026-06-18.md) | table-assist async ingest production live smoke |
| [upload-multi-file-live-smoke-2026-06-18.md](upload-multi-file-live-smoke-2026-06-18.md) | `/upload` multi-file queue production live smoke |
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

## 完了フェーズの歴史（Archive）

Phase 2〜4 の方向性・証跡・イベント記録は `docs/archive/` に移動済み。提出用の公開リポジトリでも過去の意思決定や evidence を辿れるよう、archive も repository に含める。

主な内容: Phase 2/3/4 direction・live smoke・IAP/UX evidence、`week1-retrospective.md`、`hackathon.md`、`w1-artifacts/inventory.snapshot.json` など。採用判断の正本は [decisions.md](decisions.md)。

# Production Readiness — 「つくる」MVP 本番化ゲート（DoD）

**日付**: 2026-06-08
**目的**: Phase 4-UX MVP（purpose → 候補 → 選択 → Safety → Preview → 生成）を **本番レベル** で提供すると言える条件を、軸ごとに「満たすべきゲート」として固定する。実装前に DoD を明文化し、残作業をここから逆算する。
**正本ポリシー**: 本書は **ゲート一覧・現在地・DoD** の正本。製品定義は [CLAUDE.md](../CLAUDE.md)、**決定内容・閾値・採用理由** は [docs/decisions.md](decisions.md)（`D-PROD-*` 含む）、運用手順は [docs/setup-gcp.md](setup-gcp.md) を正とする。本書は decisions.md の決定をゲート状態として追跡し、重複して閾値や根拠を書かない。

## 状態タグ

| タグ | 意味 |
|---|---|
| ✅ | 本番ゲートを満たす（実装・検証済み） |
| 🔲 | 残作業あり（実装 or 検証が必要） |
| ⚠️ | **判断待ち**（製品判断が決まれば実装は小さい。後付け困難なので本番化前に確定する） |

---

## 1. 安全ゲート（Safety Invariants の enforce）

> CLAUDE.md Safety Invariants:「masking と exclusion は product-critical。後回しの polish にしない」。本軸が本書の中心。

| 項目 | 状態 | 現在地 | 残/判断 | 正本 |
|---|---|---|---|---|
| Masker 本線（curator→masker→`ai_safe`/`restricted`、PDF含む） | ✅ | text/PDF 同型に Masker 実行、live smoke 証跡あり | — | `D-P3-M-PDF-1` |
| 生成経路の決定論 safetyGate + 除外 taxonomy | ✅ | `applyStrategistInputBudget` 前に Restricted/blocked を除外、理由付き | — | `D-P4UX-0` |
| 候補/Preview の二層構造（助言レイヤ vs 権威ゲート） | ✅ | 候補は metadata のみ。本文ゲートは生成経路。「除外は断言・送信は予測」 | — | `D-P4UX-0` / `D-P4UX-2` |
| **`unmaskablePiiFindings` の本番 enforce** | ✅ | **実装済（`D-PROD-1`, 2026-06-08）**: `count >= 1` → `restricted`（fail-closed, OCR 由来）。`orchestratePdfPath` の curator 直後・aiUsePolicy 分岐前に gate。Inventory / Context Package 候補経路では `restrictionSource:'safety_gate'` の restricted を `masker:null` でも terminal 在庫として保持 | 完了（test 5件・full suite 777 green・build pass） | `D-PROD-1`, `uploadOrchestrator.ts`, `inventoryFirestoreAdapter.ts`, `firestoreSchema.ts` |
| **`safety_readiness` の enforce stage** | ✅ | **決定済（`D-PROD-2`）**: health は warn/pass 維持、blocker は `heuristic`+ のまま。現コードが既にこの挙動 | コード変更なし（現挙動の追認） | `D-PROD-2`, `src/eval/conversion/rollupOverallStatus.ts` |
| Cloud DLP 本番適用範囲 | 🔲 | 部分統合済み。本線の masking でどこまで DLP に依存するか・適用 subtype の確定が残 | 本番適用範囲を decisions に固定 | `D-P3-E` |

---

## 2. データ保持 / 削除（Retention & Deletion）

| 項目 | 状態 | 現在地 | 残/判断 | 正本 |
|---|---|---|---|---|
| `context_package_jobs.expiresAt` Firestore TTL | ✅ | 設定・`expiresAt.timestampValue` 実機確認済み | — | `setup-gcp.md §2.1` |
| GCS `context-package/job-results/` lifecycle（14日削除） | ✅ | 設定済み | — | `setup-gcp.md §2.3` |
| **raw DocumentIR / 元アップロードの unmasked PII retention（GH #10）** | ✅ | **決定済（`D-PROD-3`）**: `conversion_eval` はメトリクス専用で生 text を保持しない。PII at-rest 面は GCS `raw/` と再フレーミングし、14日 lifecycle delete を設定済み | 完了 | `D-PROD-3`, `setup-gcp.md §2.3`, `documentIrStorage.ts`, `uploadOrchestrator.ts` |
| `ai_safe_version` の保存位置 | 🔲 | サブコレクション vs metadata+別本文 が未決 | 保存位置を確定 | `firestore-schema.md`, open-questions |
| legacy `maskingPending` の扱い | 🔲 | 動作は本線化（park しない）。schema/docs コメントが旧挙動を現行と誤読させ得る | コメントを「歴史的挙動」と明示 | GH #11 |

---

## 3. 認証 / マルチテナント分離（Auth & Tenant Isolation）

| 項目 | 状態 | 現在地 | 残/判断 | 正本 |
|---|---|---|---|---|
| IAP 保護 + `verifyIapJwt`（匿名 302/401） | ✅ | middleware 統合・確認済み | — | `D-P3-D` |
| CI/CD は WIF（SA JSON key 不使用） | ✅ | 実装済み | — | `D-P3-D` |
| SA 分離（deploy `github-deployer` / runtime `aiknh-runner`） | ✅ | 実装済み | — | `D-P3-D` |
| tenant 分離（job / result route 認可、tenantId=IAP domain） | ✅ | revision `00041-2kr` で smoke 確認 | — | `setup-gcp.md §8` |
| candidates API の tenant 越境がないこと | ✅ | Firestore 読み取りは tenant scope、本文を返さない | — | `D-P4UX-1` |

---

## 4. 監視 / アラート（Observability）

| 項目 | 状態 | 現在地 | 残/判断 | 正本 |
|---|---|---|---|---|
| log-based metrics（`context_package_job_errors` / `_stale_recoveries`） | ✅ | 作成済み | — | `setup-gcp.md §8` |
| alert policies 3本（job errors / stale recoveries / Cloud Tasks backlog） | ✅ | 作成済み | — | `setup-gcp.md §8` |
| **通知 channel（`notificationChannels`）** | ✅ | **2026-06-08**: channel configured / policies attached。email channel `projects/ai-ready-knowledge-hub/notificationChannels/10853988392687424315`（`AI Ready Knowledge Hub ops alerts`, type `email`, `enabled: true`）を作成し alert policy 3本に `notificationChannels` 紐付け済み。`gcloud describe` では `verificationStatus` 出力なし（`UNVERIFIED` ではない）。synthetic alert `alert-email-delivery-sustained-20260608T081523Z` で delivery test 受信確認済み（alert `0.o8szm1c7od96`, 17:24 JST） | 将来は Google Group / ops alias へ差し替え | `setup-gcp.md §8.4` |
| Cloud Scheduler `context-package-job-sweeper` | ✅ | `ENABLED`、manual run でログ確認済み | — | `setup-gcp.md §8` |

---

## 5. 検証（Verification）

| 項目 | 状態 | 現在地 | 残/判断 | 正本 |
|---|---|---|---|---|
| `pnpm typecheck && pnpm test && pnpm build` green | ✅ | 2026-06-08 確認: `pnpm typecheck` ✅ / `pnpm test` 777 passed ✅ / `pnpm build` ✅ | — | CLAUDE.md Verification Policy |
| live async smoke（202 → succeeded → result 200、masked/no-raw-PII） | ✅ | revision `00041-2kr`、job `5d51117a-…` で確認 | — | `setup-gcp.md §8` |
| candidates API の IAP 越し疎通（Firestore 読み取り） | ✅ | runbook に追加・確認済み | — | `setup-gcp.md §8` |

---

## 6. 本番化ゲートとして確定した決定

`D-PROD-1` / `D-PROD-2` / `D-PROD-3` は **2026-06-08 に確定済み**。決定内容・閾値・採用理由の正本は [decisions.md](decisions.md) の各条目。本書はゲート状態と実装の現在地を記録する。

### 決定1: `unmaskablePiiFindings` の enforce 閾値（`D-PROD-1`）

- **決定**: `count >= 1` で `restricted` 化（fail-closed）。閾値に窓なし（N=0）。
- **根拠・代替案**: [decisions.md — D-PROD-1](decisions.md)
- **実装状態**: ✅ 実装済み（2026-06-08）。`orchestratePdfPath` の curator 直後・aiUsePolicy 分岐前に gate（`direct`/`requires_masking` 両方を覆う）。OCR 由来 restricted は masker を経ず、`sensitivitySource:'curator'` / `restrictionSource:'safety_gate'` / 理由 `UNMASKABLE_PII_RESTRICTION_REASON` で masker 由来と区別。IR snapshot / health eval / chunk は生成せず生 PII を新規に残さない（GH #10 と整合）。Inventory / Context Package 候補経路では `restrictionSource:'safety_gate'` の restricted を `masker:null` でも terminal 在庫として保持（`inventoryFirestoreAdapter.ts`）。`pnpm typecheck` / `pnpm test`(777) / `pnpm build` green（2026-06-08）。

### 決定2: `safety_readiness` の enforce stage（`D-PROD-2`）

- **決定**: health は warn/pass 維持、blocker は `heuristic+` のまま。
- **根拠・再評価条件**: [decisions.md — D-PROD-2](decisions.md)
- **実装状態**: ✅ コード変更なし（現コードが既にこの挙動。現挙動を正式決定として固定）。

### 決定3: raw DocumentIR snapshot / 元アップロードの retention（`D-PROD-3`）

- **決定**: GH #10 の実体を GCS `raw/` の PII-at-rest として扱い、元アップロードと `raw/{docId}/document-ir/v1.json` を 14日 lifecycle delete にする。`conversion_eval` はメトリクス専用で生 text を保持しない。
- **根拠・撤退条件**: [decisions.md — D-PROD-3](decisions.md)
- **実装状態**: ✅ GCS bucket lifecycle に `raw/` と `context-package/job-results/` の 14日 delete rule を設定済み（2026-06-08）。コードコメントで D-PROD-3 と eval-only fallback を明記。

---

## 7. 残る判断

本番ゲートのうち **未決** のもの。決定後は `D-PROD-*` または既存 decision ID として [decisions.md](decisions.md) に記録する。

- `ai_safe_version` の保存位置（firestore-schema）
- Cloud DLP 本番適用範囲（`D-P3-E`）

---

## 8. 作業グループの対応（phase-4-ux-direction との接続）

| グループ | 本書の対応行 | 性質 |
|---|---|---|
| **グループ1 安全ゲート** | §1 `D-PROD-1` / `D-PROD-2`（✅ 確定・実装済み） | 完了 |
| **グループ2 整合性 cleanup** | §2（#10 は `D-PROD-3` で完了。#11）, GH #9, #4 | 低リスク・土台固め |
| **グループ3 アーキ判断** | §2 `ai_safe_version`, §7 残る判断 | コードでなく決定 |
| 運用の残 | — | §4 通知 channel は 2026-06-08 に閉じた |

---

## 本番化 Done の定義（サマリ）

「つくる」MVP が本番レベルと言えるのは、次がすべて満たされたとき:

1. §1 の `D-PROD-1` / `D-PROD-2` 安全ゲートが enforce 実装＋テスト済み（2026-06-08 確定）。
2. §2 の生 PII 保持（#10）が安全側で解決され、retention 判断が [decisions.md](decisions.md) に記録済み。
3. §4 通知 channel が設定され、アラートが発報先を持つ。
4. §5 `pnpm typecheck && pnpm test && pnpm build` が現 main で green（2026-06-08 確認済み）。
5. `D-PROD-*` が [decisions.md](decisions.md) に記録済み（2026-06-08）。

> グループ2 の docs/コメント整合（#11/#9/#4）と グループ3 のアーキ判断は、本番 **提供** の品質には効くが、上記 1〜5 が満たされれば「つくる MVP 本番化」のコアゲートは通過とみなす。

---

## 関連ドキュメント

- [CLAUDE.md](../CLAUDE.md) — 製品定義・Safety Invariants・Verification Policy の正本
- [docs/decisions.md](decisions.md) — 決定内容・閾値・採用理由の正本（`D-P4UX-*` / `D-P3-M-PDF-1` / `D-P3-D` / `D-P3-E` / `D-PROD-*`）
- [docs/phase-4-ux-direction.md](phase-4-ux-direction.md) — Phase 4-UX 作業分配（S1–S11）
- [docs/setup-gcp.md](setup-gcp.md) §8 — 非同期 production smoke / 監視・アラート（運用正本）
- [docs/open-questions.md](open-questions.md) — 未決事項
- [docs/firestore-schema.md](firestore-schema.md) — Firestore 形状の正本

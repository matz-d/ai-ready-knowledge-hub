# Operate / Deliver Readiness — 「まわす」「とどける」軸の DoD

**日付**: 2026-06-09
**目的**: ハッカソン採点3軸（**つくる・まわす・とどける**）のうち、「つくる」は [docs/production-readiness.md](production-readiness.md) で本番化コアゲートを通過済み。本書は残る **まわす（継続運用）** と **とどける（成果物の受け渡し）** を軸ごとに「満たすべきゲート」として固定し、棚卸し結果と残作業を逆算する。
**正本ポリシー**: 本書は **まわす/とどける のゲート一覧・現在地・DoD** の正本。製品定義は [CLAUDE.md](../CLAUDE.md)、決定内容・閾値・採用理由は [docs/decisions.md](decisions.md)、運用手順は [docs/setup-gcp.md](setup-gcp.md) を正とする。まわすのインフラ系ゲート（auth / 監視 / 検証）は既に [production-readiness.md](production-readiness.md) §3–§5 で追跡済みのため、本書は重複再掲せずリンクで参照し、**net-new のゲートと判断**に集中する。

## 状態タグ

| タグ | 意味 |
|---|---|
| ✅ | 軸ゲートを満たす（実装・検証済み） |
| 🔲 | 残作業あり（実装 or 検証が必要） |
| ⚠️ | **判断待ち**（製品判断が決まれば実装は小さい。採点差別化に効く） |

---

## A. まわす（Operate — 継続運用）

> 採点観点:「一度作って終わり」ではなく、**壊れても自動復旧し、観測でき、安全に回り続ける**こと。本軸の大半は Phase 4-UX Hardening（S8–S10）で実装・実機確認済み。

| 項目 | 状態 | 現在地 | 残/判断 | 正本 |
|---|---|---|---|---|
| 非同期 job ライフサイクル（`queued`→`running`→`succeeded`/`failed`） | ✅ | 20秒ゲート無しの async 生成。状態機械は `contextPackageJobs/schema.ts` | — | `setup-gcp.md §8` |
| 分散正しさ: lease + attempt token による claim | ✅ | `running` 昇格は「queued または lease 期限切れ running」+ attempt token。worker クラッシュ時も `leaseExpiresAt` で再 claim 可能（running 放置の安全弁） | — | `contextPackageJobs/schema.ts`, `firestoreAdapter.ts` |
| stale-running 自動復旧 sweeper | ✅ | Cloud Scheduler `context-package-job-sweeper` `ENABLED`、manual run でログ確認済み | — | `setup-gcp.md §2.2 / §8` |
| 大結果の GCS offload（`MAX_INLINE_RESULT_BYTES` 超過） | ✅ | inline result が無い succeeded は `resultRef` から GCS 読み出し。実機 smoke 済み | — | `result/route.ts`, `setup-gcp.md §8` |
| retention / 自動削除（Firestore TTL + GCS lifecycle 14日） | ✅ | `expiresAt` TTL 実機確認。`raw/` + `context-package/job-results/` lifecycle delete 設定済み | — | `D-PROD-3`, `setup-gcp.md §2.1/§2.3` |
| 監視: log-based metrics + alert 3本 + 通知 channel + 配信テスト | ✅ | metrics（job errors / stale recoveries）、alert policy 3本、email channel 紐付け、synthetic alert 受信確認済み | 将来 Google Group へ差し替え | `production-readiness.md §4`, `setup-gcp.md §8.4` |
| マルチテナント分離（job / result / candidates 認可） | ✅ | tenantId=IAP domain、revision `00041-2kr` で越境なし確認 | — | `production-readiness.md §3`, `D-P4UX-1` |
| 再処理 / 再生成 recovery tooling | ✅ | `regenerateChunksForDoc`（`scripts/regenerateChunks.ts`）。**`raw/` 14日 lifecycle に依存**し、14日超は全 status で raw 404 失敗し得る（復旧=再アップロード） | — | `D-PROD-3` 決定項目5 |
| **Gemini API 運用制約の明文化 / 監視** | ✅ | **決定済・記述済（`D-OPS-1`）**: quota/コスト dashboard は新設せず runbook 注記 + 既存 job error alert で運用。`setup-gcp.md` Notes に「Gemini 運用監視」節を追記済み | — | `D-OPS-1`, `setup-gcp.md`, PR #18 |
| **enqueue 冪等性（重複 submit）** | ✅ | UI は通常クリックを disabled state で抑止し、同一 tick の二重 submit は同期 ref lock で `POST /api/context-package` を1回に抑える。Cloud Tasks は task name に `jobId` を使い、同一 job の二重 enqueue を拒否 | API-level の semantic retry idempotency key は post-submit hardening。現 MVP の submit 事故対策としては完了 | `ContextPackageForm.tsx`, `enqueuer.ts` |
| **運用 SLO / error budget** | ✅ | 提出向けの最小 SLO を §E に定義。既存 alert は job error / stale recovery / queue backlog を監視 | 実測 dashboard 化は後続。現状は runbook + evidence で運用 | 本書 |

---

## B. とどける（Deliver — 成果物の受け渡し）

> 採点観点:「AI に渡せる」と言うからには、**4分類（使える/除外/足りない/確認）を構造化し、下流 AI への渡し方まで含めて成立**していること。出力フォーマットは MVP として成立済み、**渡し先体験**に伸びしろがある。

| 項目 | 状態 | 現在地 | 残/判断 | 正本 |
|---|---|---|---|---|
| 出力が CLAUDE.md の4分類を構造化（使える/除外/足りない/確認） | ✅ | markdown が `Included Documents`(使える)+`Full AI-Ready Sources` / `Excluded Documents`(除外) / `Missing Knowledge`(足りない) / `Questions for Human Owner`(確認) を別節で出力 | — | `exportContextPackage.ts` |
| 下流 AI への明示指示を埋め込み | ✅ | `Instructions for Downstream AI`（included のみ使用 / excluded 不使用 / 欠落推論禁止 / 不足は人間に確認） | — | `exportContextPackage.ts` |
| 不完全カバレッジを正直に開示 | ✅ | budget truncation で落ちた safe chunk 数を manifest と専用節で警告（「除外は断言・送信は予測」の延長） | — | `D-P4UX-0` |
| included/excluded の理由・sensitivity を提示 | ✅ | included は Reason / Source type / Sensitivity、excluded は Reason / Status を逐文書で出力 | — | `exportContextPackage.ts` |
| restricted / human-review を「人間が確認すべき」として明示（沈黙除外しない） | ✅ | `humanReviewDocuments` を `Excluded` に `Restricted / human review only` で合流 | — | `preGenerationPreview.ts` |
| 成果物の取得（.md ダウンロード） | ✅ | `ContextPackageForm` の「.md をダウンロード」（Blob → `context-package_{slug}.md`） | — | `ContextPackageForm.tsx` |
| **渡し先別の取り込み手順（NotebookLM / Gemini / RAG）** | ✅ | NotebookLM の取り込み手順を E2E で確立: **単一 .md をチャットに貼らず、source 分割 bundle の全ファイルを source 追加**。経緯と手順は [delivery-e2e ログ](delivery-e2e/2026-06-09-verification-log.md) | Gemini/RAG 手順は同型で追補可 | `delivery-e2e/` |
| **出力粒度: 単一 .md vs source 分割** | ✅ | **D-DLV-1 fast-follow 発火・実装済（2026-06-09）**: E2E で単一 .md は NotebookLM が本文を grounding できず FAIL → `exportContextPackageSourceBundle()` で source 分割 bundle を追加し PASS。単一 .md は維持しつつ bundle を secondary export に | UI zip 導線は P1-B で実装済み（`ContextPackageForm`） | `D-DLV-1`, `exportContextPackage.ts` |
| **ダウンロード以外の handoff（clipboard / 直接連携）** | ✅ | **決定済・実装済（`D-DLV-2`, 2026-06-09）**: download + copy-to-clipboard の2導線。直接 API 連携はスコープ外。`Markdown をコピー`/`コピーしました`/`コピーできません` | — | `D-DLV-2`, `ContextPackageForm.tsx` |
| **エンドツーエンドの delivery 検証（実 NotebookLM/Gemini 投入）** | ✅ | accounting-office 1ケースを実 NotebookLM に投入し質問バッテリー5問すべて PASS（included のみ使用 / excluded 不使用 / missing・questions 認識）。証跡は [delivery-e2e ログ](delivery-e2e/2026-06-09-verification-log.md) | Gemini でも余力で確認 | `delivery-e2e/` |

---

## C. 判断（2026-06-09 すべて確定）

採点価値 / 後戻りコスト / 実装コスト / 証跡化しやすさ で評価し、3点とも確定。記録は [decisions.md](decisions.md)。

1. **出力粒度（B）** → `D-DLV-1`: **単一 `.md` を正本**。source 分割は E2E で引用品質が弱いと実証された場合の fast-follow。
2. **Gemini 運用監視（A）** → `D-OPS-1`: dashboard 新設せず **runbook 注記 + 既存 alert**。
3. **handoff の幅（B）** → `D-DLV-2`: **download + copy、直接連携なし**（copy 実装済み）。

**提出前の決定打**: §B の **E2E delivery 検証** → **2026-06-09 達成**。実 NotebookLM で 5/5 PASS。過程で単一 .md の grounding 失敗を発見し、`D-DLV-1` の fast-follow（source 分割 bundle）を実装して合格。証跡は [delivery-e2e ログ](delivery-e2e/2026-06-09-verification-log.md)。

---

## D. まわす/とどける Done の定義（サマリ）

**まわす** が運用レベルと言えるのは、A の ✅ 群（lifecycle / lease / sweeper / offload / retention / 監視 / tenant 分離 / recovery）が実装・実機確認済みであること。**これは既に達成済み**で、残るのは ⚠️/🔲 の運用磨き（Gemini 監視・冪等性・SLO）であり、いずれもコアブロッカーではない。

**とどける** が成立と言えるのは、B の ✅ 群（4分類の構造化出力 / 下流指示 / 正直なカバレッジ開示 / 理由・sensitivity 提示 / human-review 明示 / .md 取得）を満たすこと。**これも達成済み**。残るのは渡し先体験（渡し先別ガイド・出力粒度・handoff 幅・E2E 検証）で、ここが**ハッカソン提出のデモ価値に最も効く伸びしろ**。

> 結論: まわす/とどける とも **コア DoD は通過済み**。**とどける の E2E 検証も 2026-06-09 達成**（実 NotebookLM 5/5 PASS、source 分割 bundle を fast-follow 実装）。UI zip 導線（P1-B）とデモ docs の bundle 前提更新（P1-C）も完了。submit 重複 guard と提出向け SLO も 2026-06-16 に閉じた。残る限界効用は Gemini/RAG 取り込み手順の追補。

---

## E. Minimal Operate SLO（提出向け）

本 MVP の SLO は「提出デモと dev tenant の小規模運用」を対象にする。大量顧客・商用 multi-tenant の SLO ではない。

| 指標 | 目標 | 観測 / 運用方法 |
|---|---:|---|
| Async accepted response p95 | 3秒以下 | `POST /api/context-package` が `202` を返すまで。過去 smoke は `1.295s` / `3.647s` |
| Worker completion p95 | 10分以下 | P1-F の 30文書 / 11 batches 実測は約596秒。通常サンプルは60秒以下を目安 |
| Job success rate | 95%以上 | `context_package_job_errors` alert で低下を検知。失敗時は retry / stale recovery / result route を確認 |
| Stale-running recovery | 30分以内 | Cloud Tasks retry window と sweeper runbook に合わせる |
| Result retention | 14日 | Firestore TTL と GCS lifecycle（`raw/`, `context-package/job-results/`）で自動削除 |

Error budget の扱い:

- stale recovery や queue backlog の alert が出たら、提出デモ前は新規 large package 生成を止め、直近 job の status / worker logs / Cloud Tasks queue を確認する。
- Gemini quota / transient failure は job error alert で拾い、必要なら目的・文書数を絞って再生成する。
- 同じユーザー操作の通常 double-click は disabled state、同一 tick の二重 submit は ref lock で抑止済み。ネットワーク retry が同じ semantic request を別 job として作る問題は、post-submit の request idempotency key 候補として残す。

---

## F. とどける E2E delivery 検証 runbook（提出デモ証跡）

**状態:** 2026-06-09 実施・合格。本節は**確立した手順**として残す。実施結果は [delivery-e2e ログ](delivery-e2e/2026-06-09-verification-log.md)。

**目的:** 生成した Context Package を実際の NotebookLM / Gemini に投入し、4分類どおりに振る舞うことを1ケースで証跡化する。

**前提:** sample-data の synthetic / masked fixture のみ使用（実顧客データ・PII は投入しない）。

**⚠️ 重要な学び（必ず守る渡し方）:** **単一 `.md` を NotebookLM の1ソースとして投入しないこと。** NotebookLM が manifest（メタ層）を強く、付録的な本文層（`Full AI-Ready Sources`）を弱く見て「構成案」と誤読し、本文を grounding できず FAIL する（実証済み）。**source 分割 bundle を使う。**

**手順（NotebookLM、確立版）:**
1. Context Package を生成し、**source 分割 bundle** を得る（純関数 `exportContextPackageSourceBundle()`。検証では `pnpm tsx scripts/buildDeliveryE2ePackage.ts` が `docs/delivery-e2e/sources/<case>/` に出力）。
2. **新規 notebook**に bundle の**全ファイル**（`00-CONTEXT-PACKAGE-GUIDE.md` + included 生ソース）を source 追加。単一 .md や手動追加ファイルは混ぜない。
3. 質問バッテリーを投げ、次の4点を確認・スクショ:
   - **使える**: included 生ソース（例: `料金表_2026.csv`）の値で回答が構成される。
   - **除外**: excluded 文書の内容を使わない（bundle に **source file が存在しない** ＝ exclusion by absence）。
   - **足りない**: guide の `Missing Knowledge` に該当する問いには「不足」を認識し、勝手に補完しない。
   - **確認**: guide の `Questions for Human Owner` を人間確認事項として提示できる。
4. **Gemini**（任意）: 同じ bundle をファイル添付し、同じ4点を確認。
5. budget truncation が出たケースがあれば、guide の `Budget Truncation` 警告が「カバレッジ不完全」として伝わるかも確認（任意）。

**合格条件:** 4点すべてが少なくとも NotebookLM で確認でき、スクショ/メモを提出素材として残す。

**記録先:** 検証結果は `docs/delivery-e2e/` の検証ログに残し、本書 §B の該当行を ✅ にする（2026-06-09 実施済み）。

---

## 関連ドキュメント

- [CLAUDE.md](../CLAUDE.md) — 製品定義・4分類（使える/除外/足りない/確認）の正本
- [docs/production-readiness.md](production-readiness.md) — 「つくる」MVP 本番化ゲート（まわすの auth/監視/検証ゲートも §3–§5 に内包）
- [docs/decisions.md](decisions.md) — 決定内容・閾値・採用理由の正本
- [docs/setup-gcp.md](setup-gcp.md) §2 / §8 — retention / 非同期 production smoke / 監視・アラート（運用正本）
- [docs/offering-model.md](offering-model.md) — 提供形態

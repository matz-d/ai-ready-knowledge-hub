# Phase 4-UX: Purpose-Driven Context Package Selection — 方針 / 作業分配（正本）

**日付**: 2026-06-03
**状態**: 計画確定（S0 決定済み）／実装未着手
**正本ポリシー**: 本フェーズの命名・スコープ・分類規則・セキュリティ境界の決定は [docs/decisions.md](decisions.md) `D-P4UX-0` を正とする。本書は作業分配と実装者向け指示文の正本。製品定義そのものはリポジトリ直下 `CLAUDE.md` を正とする。

> **命名注意**: `docs/decisions.md` 既存の「Phase 4」は *マルチテナント商用化 / BigQuery write-once audit* を指す（行 971, 1164, 1395 ほか）。本フェーズはそれとは別物であり、UX 改善フェーズとして **Phase 4-UX** と呼ぶ。旧「Phase 4（商用化）」の参照は壊さず温存する。

---

## 1. 全体像

### 目的
「docId を手で指定すれば安全に Context Package 化できる」現状を、**「purpose を入れるだけで、候補文書・除外文書・足りない情報・確認質問が整理される」**状態に引き上げる。実務担当者が docId を意識せず、目的起点で安全な Context Package を組めるようにする。

### 背景
- 現行 UI（`src/app/context-package/ContextPackageForm.tsx`）は purpose textarea + **docId 手入力 textarea**。実務担当者が docId を知っている前提は非現実的。
- バックエンドは既に強い: `runStrategistOrchestrator`（`src/services/strategistOrchestrator/orchestrator.ts`）が deterministic safety gate → pre-LLM budget → Strategist(Gemini) を実装済み。除外理由 taxonomy・budget truncation 可視化・strict docId 解決・async job 経路まで揃っている。
- 足りないのは **「purpose → 候補文書」を出す軽い前段**と、それを見せる **候補選択 UI / 生成前の安心 UI**。

### やること
1. Purpose → 候補文書の **deterministic ランキング & 分類**（include / exclude / needs_review）+ missing hints
2. それを返す **`POST /api/context-package/candidates`** API
3. 候補リストを見せ、選択して生成へ渡す **Candidate Selection UI**
4. 生成前に「なぜ使える/除外/人間確認/足りない」を見せる **Safety Review Panel**
5. 生成前に「この情報を AI に渡します（raw PII / Restricted / stale が混ざっていない）」を見せる **Preview**
6. **Operational Hardening**: #15 job GC / stuck-running recovery、#16 large result GCS offload、smoke runbook 定着、monitoring/alert

### やらないこと（このフェーズ）
- **LLM による候補推薦**（M1 は deterministic / heuristic のみ。LLM 推薦は次フェーズ decision／`D-P4UX-0` 確定）
- Strategist 本体・safety gate ロジックの再設計（既存を再利用、触らない）
- マルチテナント商用化 / BigQuery audit（旧「Phase 4」。本フェーズとは別物）
- 認証方式・提供形態の変更

### 完了条件
- **Phase 4-UX MVP**: S1–S7 + S3/S11 docs。`pnpm typecheck && pnpm test && pnpm build` green。purpose 入力だけで候補→選択→Safety→Preview→生成が一巡し、docId 手入力が主導線から外れる。
- **Production Hardening（MVP と独立・並列可）**: S8（#15）, S9（#16）, S10（runbook/監視）。Codex 実機検証込み。
- 関連 live smoke は Codex が証跡化。

### 既存 docs / code との接続点
| 領域 | 接続先 |
|---|---|
| 候補ランキング次元 | `src/lib/inventory.ts`（`InventoryDocument`）, `src/agents/curator/schema.ts`（enum 正本）|
| Inventory 読み込み | `src/lib/inventoryFirestoreAdapter.ts`（`listInventoryDocumentsFromFirestore` / `resolveInventoryDocumentsByIds`）|
| 除外理由 taxonomy | `src/agents/strategist/schema.ts`（`ExclusionReasonEnum` / `ExclusionReasonLabels` / `ExclusionReasonOrigin`）|
| 文書レベル安全判定（metadata-only） | `src/agents/masker/upgrade.ts`（`isBlockedForAi` / `needsMaskerEvaluation`）|
| export 本体の安全判定（**候補では使わない**） | `src/lib/contextPackageInput.ts`（`isSafeForContextPackageExport`＝`aiSafeContent` 必須）|
| 決定論ランキングの参考実装 | `src/services/strategistOrchestrator/budget.ts`（purpose 関連度で chunk を並べる既存ロジック）|
| 生成本体（確定後に投げる先）| `POST /api/context-package`（`src/app/api/context-package/route.ts`）, 既存 `docIds` フィルタ経路 |
| UI | `src/app/context-package/ContextPackageForm.tsx`, `page.tsx`, `styles.css` |
| 運用 | GH #15 / #16, `docs/setup-gcp.md` §8（async smoke 正本）, `docs/demo-runbook.md`, `docs/open-questions.md` R10 |
| 決定正本 | `docs/decisions.md`（`D-P4UX-*`）, 本書 |

---

## S0 確定事項（`D-P4UX-0`）

| 項目 | 確定 | 後続への反映 |
|---|---|---|
| **命名** | **Phase 4-UX**（旧 Phase 4=商用化は温存、decisions.md 参照は壊さない） | doc 名 `phase-4-ux-direction.md`、decision ID `D-P4UX-*`。|
| **除外の可視性** | **理由つきで見せる**（fileName + reasonLabel）。本文/aiSafeContent は返さない | 候補に `reasonLabel` を付与、本文フィールドは持たせない。API は metadata のみ。|
| **古い文書** | **needs_review 既定** | `freshness==='superseded_candidate'` → `needs_review` / `reasonCode 'superseded_or_stale'` / 既定 unchecked。|
| **LLM 推薦** | **非対象で確定**（deterministic のみ） | 「やらないこと」に固定。新規 LLM 呼び出し禁止。|

### 設計上の二層構造（重要）
候補 API は **metadata-only の「助言レイヤ」**。本文・chunk・GCS・`aiSafeContent`・LLM を一切読まない/呼ばない。実際に本文が AI に渡るかの**権威ある判定は生成経路**（`/api/context-package` → `safetyGate` → `applyStrategistInputBudget` → Strategist）が行う。候補段階で `aiSafeContent` の有無を確認しようとすると adapter の責務を踏み越え、`ai_safe` 文書を不当に unsafe 化するため禁止。

---

## 2. 作業分解（S0〜S11）

### S0. 製品判断・命名確定（前提ゲート）— **確定済み**
S0 の4決定は上表（`D-P4UX-0`）で確定。以降の作業はこれを前提とする。

### 候補レスポンス型（S1/S2/S3 共通の正本）

```ts
type CandidateRecommendation = 'include' | 'exclude' | 'needs_review';

type CandidateDoc = {
  docId: string;
  fileName: string;
  documentType: DocumentType;
  businessDomain: BusinessDomain;
  sensitivity: Sensitivity;
  freshness: Freshness;
  isAuthoritativeCandidate: boolean;
  status: DocumentLifecycleStatus;  // curated | ai_safe | blocked | restricted
  updatedAt?: string;
  score: number;                    // deterministic 関連度
  recommendation: CandidateRecommendation;
  // 除外/確認の理由のみ taxonomy を使う。include には付けない。
  reasonCode?: ExclusionReason;     // ExclusionReasonEnum（増やさない）
  reasonLabel?: string;             // ExclusionReasonLabels 由来
  reasonDetail?: string;
  // include 側の説明は別名で（enum を汚さない）
  matchReason?: string;
  scoreBreakdown?: Record<string, number>;
};

// 本文 / aiSafeContent / maskedText は一切含めない（説明はするが中身は渡さない）
```

### S1 metadata-only 分類ルール（優先順）

```
1. exclude       : isBlockedForAi(doc)                 → reasonCode 'restricted_sensitivity'
2. needs_review  : needsMaskerEvaluation(doc)
                   || doc.maskingPending === true       → reasonCode 'masking_required_unavailable'
3. needs_review  : doc.freshness === 'superseded_candidate'
                                                        → reasonCode 'superseded_or_stale'（既定 unchecked）
4. include       : status ∈ {curated, ai_safe} かつ 上記非該当 かつ score >= 閾値
                                                        → matchReason / scoreBreakdown を付与
※ aiSafeContent の有無は候補段階で確認しない（権威ある本文ゲートは生成経路の safetyGate に委ねる）
```

---

### S1. 候補ランキング & 分類コアモジュール（M1 中核）
- **目的**: purpose と `InventoryDocument[]` から、決定論的に score・recommendation・reasonCode/Label・missingHints を出す純関数群。LLM・chunk・GCS・aiSafeContent 一切なし。
- **対象**: 新規 `src/services/candidateSelection/`（`ranking.ts`, `classify.ts`, `missingHints.ts`, `synonyms.ts`, `types.ts`, `__tests__/`）
- **推奨担当AI**: **Claude Code**（設計）→ 実装も Claude Code か Copilot CLI
- **推奨理由**: inventory / masker upgrade / strategist taxonomy / budget を横断する再利用設計判断が中心。
- **難易度**: 中 / **認証・GCP**: 不要（純関数）/ **依存**: S0 / **並列**: S5/S8/S9/S11 と並列可
- **検証**: `pnpm test src/services/candidateSelection` / **完了条件**: 代表 fixture で4分類と missingHints が期待通り、typecheck green。
- **指示文**: §6 参照。

### S2. `POST /api/context-package/candidates` API ルート（M1）
- **目的**: purpose + limit を検証し Inventory を読み S1 を呼んで候補を返す。生成（LLM）はしない。
- **対象**: 新規 `src/app/api/context-package/candidates/route.ts`, `__tests__/`
- **推奨担当AI**: **GitHub Copilot CLI**（route + DI test + build を autopilot で一括）
- **難易度**: 中 / **認証・GCP**: ランタイムで Firestore 読み取り（テストは mock 注入、新規 GCP 設定不要）/ **依存**: S1 / **並列**: S1 完了後は S3/S4 と並列可
- **検証**: `pnpm test src/app/api/context-package/candidates` / **完了条件**: 200 候補・400 検証・409 空 inventory のテスト green。
- **指示文**: §6 参照。

### S3. 候補レスポンス契約のドキュメント化（M1）
- **目的**: 上の確定版型・status code・reasonCode 一覧を docs 固定し UI が並行着手できるようにする。
- **対象**: 本書 §候補レスポンス型（正本）。必要なら `docs/architecture.md` に参照を足す。
- **推奨担当AI**: **Claude Code** / 軽微なら Cursor
- **難易度**: 低 / **認証・GCP**: 不要 / **依存**: S1 / **並列**: S2 と同時進行可

### S4. （任意）候補スコアリングの fixture / golden
- **目的**: ランキング回帰を golden で守る。
- **対象**: `sample-data/`（synthetic のみ、実顧客データ・PII 禁止）, `src/services/candidateSelection/__tests__/__snapshots__/`
- **推奨担当AI**: **Cursor Composer**
- **難易度**: 低 / **認証・GCP**: 不要 / **依存**: S1 / **並列**: 可

### S5. Candidate Selection UI（M2）
- **目的**: docId 手入力を主導線から外し、候補チェックボックスリスト（reason / status / sensitivity）で選択 → 生成。
- **対象**: `src/app/context-package/ContextPackageForm.tsx`, `styles.css`, 新規子コンポーネント
- **推奨担当AI**: **Cursor Composer**（UI）/ 状態設計の難所は Claude Code に相談
- **難易度**: 中 / **認証・GCP**: 不要 / **依存**: S2, S3 / **並列**: M5 と並列可
- **検証**: `pnpm test src/app/context-package` + 手動 / **完了条件**: purpose だけで候補が出て、選択して生成でき、docId 手入力なしで一巡。purpose 変更時に stale candidates で生成させない。
- **指示文**: §6 参照。

### S6. Safety Review Panel（M3）
- **目的**: 生成前に「AI に渡せる / 除外すべき / 人間確認すべき / 足りない」を候補 API 出力から表示。
- **対象**: 新規 `src/app/context-package/SafetyReviewPanel.tsx`, `styles.css`
- **推奨担当AI**: **Cursor Composer**（UI）/ taxonomy→文言マッピングは Claude Code が下書き
- **難易度**: 中 / **認証・GCP**: 不要 / **依存**: S2, S5 / **並列**: S7 と隣接（同 UI 領域で S5→S6→S7 は直列気味）

### S7. Context Package Preview（生成前の安心）（M4）
- **目的**: 生成前に「この情報を AI に渡します。raw PII / Restricted / stale は含みません」を明示。
- **対象**: 新規 `src/app/context-package/PreGenerationPreview.tsx`、必要なら候補 API に projection 追加
- **推奨担当AI**: **Claude Code**（safety projection の整合設計）→ UI は Cursor
- **難易度**: 中 / **認証・GCP**: 不要 / **依存**: S2, S5, S6 / **並列**: M5 と並列可
- **注意**: 生成前 deterministic 判定は既存 `isSafeForContextPackageExport` / safety gate と矛盾しないこと。チャンク本文の重い取得はせず文書メタ単位。

### S8. #15 Job GC / stuck-running recovery（Hardening）
- **目的**: Cloud Tasks リトライ枯渇後に `running` で詰まる job の GC / 復旧、`cancelled` 配線、terminal job retention。
- **対象**: `src/lib/contextPackageJobs/`, sweeper/TTL, `docs/`、GH #15
- **推奨担当AI**: **GitHub Copilot Cloud Agent**（issue 起点で PR まで）→ **Codex** が lease/Cloud Tasks の実機確認
- **難易度**: 高 / **認証・GCP**: 要（Firestore TTL / Cloud Tasks / lease）/ **依存**: なし（独立）/ **並列**: M1〜M4 と完全並列
- **注意**: lease の分散システム的正しさを最優先で検証。worker lease 15分 / queue max-retry-duration ≥1800s（`setup-gcp.md` §2）と整合。

### S9. #16 Large result GCS offload（Hardening）
- **目的**: `MAX_INLINE_RESULT_BYTES` 超 result を GCS に退避し job doc に `resultRef`。
- **対象**: `src/lib/contextPackageJobs/`, result route, GH #16
- **推奨担当AI**: **GitHub Copilot Cloud Agent** → **Codex** が GCS / 認可境界の実機確認
- **難易度**: 高 / **認証・GCP**: 要（GCS / 認可）/ **依存**: なし（S8 と同ファイル群＝直列推奨）/ **並列**: M1〜M4 と並列
- **注意**: tenant isolation と result-route 認可は不変。

### S10. Smoke runbook 定着 + monitoring/alert（Hardening）
- **目的**: production async smoke runbook を運用に乗せ、Secret/IAP/Cloud Tasks 事故防止チェックと監視/アラートを整える。
- **対象**: **`docs/setup-gcp.md` §8（正本）** + `docs/demo-runbook.md`, monitoring 設定
- **推奨担当AI**: **Codex**（IAP / Cloud Run / Cloud Tasks / live smoke の実機）
- **難易度**: 高 / **認証・GCP**: 要 / **依存**: S2（candidates health 追加）, S8/S9 と整合 / **並列**: docs 整備は随時、最終確認は統合後
- **指示文**: §6 参照。

### S11. Decision エントリ / direction doc 整備
- **目的**: `D-P4UX-*` decision と本書を正本化（session 終了時 docs 残し方針に整合）。
- **対象**: `docs/decisions.md`, 本書, `docs/open-questions.md`
- **推奨担当AI**: **Claude Code**
- **難易度**: 低 / **認証・GCP**: 不要 / **依存**: S0 / **並列**: 随時

---

## 3. 依存関係と実行順

### 最初にやるべき作業
- **S0（確定済み）** → **S1（候補コアモジュール）**。Phase 4-UX 全体の出力契約の源。

### 並列化できる作業グループ
- **グループA（新機能 UX・直列気味）**: S1 → S2 →（S3 並行）→ S5 → S6 → S7
- **グループB（運用・完全独立）**: S8 → S9（同ファイル群なので順次）、S10（docs は随時、実機は統合後）
- **グループC（補助）**: S4（S1 後いつでも）, S11（随時）
- グループ A と B は **day 1 から並列可**（B は GH issue 駆動で Cloud Agent / Codex に委譲）。

### 依存で後回し
- S5/S6/S7（UI 群）は S2 の API と S3 の契約が要る。S7 Preview は S5/S6 の上に乗る。
- S10 の実機 smoke は S2/S8/S9 統合後。

### 最後に統合確認すべき作業
- 候補 API → UI 選択 → 生成（既存 `/api/context-package`）の一巡を `pnpm typecheck && pnpm test && pnpm build`。
- UI 二段フロー（候補→Safety→Preview→生成）の手動通し。

### 最後に Codex で実機確認すべき認証/GCP/live 項目
- candidates API の Cloud Run + IAP 越し疎通（Firestore 読み取り）
- #15 lease 失効・Cloud Tasks リトライ枯渇時の GC 実機挙動
- #16 GCS offload と result-route 認可・tenant 分離の不変性
- smoke runbook 全工程の再現と監視/アラート発報
- Secret / IAP / Cloud Tasks の事故防止チェック

---

## 4. AI別の割り振り案

| AI | 担当 |
|---|---|
| **Codex** | S8/S9 の **実機検証**（lease・Cloud Tasks・GCS・認可境界）、S10 全般（IAP/Cloud Run/live smoke/監視）、最終統合の実機 smoke。|
| **Claude Code** | S1 設計（多モジュール再利用の中核）、S3 契約記述、S7 safety projection 設計、S11 decision/direction 整備、S0 の選択肢整理。|
| **GitHub Copilot CLI** | S2（API route + DI test + build を autopilot で一括）、UI 群の test/build 修正、PR 往復。|
| **GitHub Copilot Cloud Agent** | S8（#15）, S9（#16）— GH issue 起点で PR まで独立完結。|
| **Cursor Composer** | S5/S6（UI 実装・スタイル・型）、S7 の UI 部、S4 fixture/golden、局所単体テスト。|
| **人間** | S0（確定済み）、各 PR の最終採否、顧客向け文言の最終確認。|

---

## 5. リスクと注意点

### スコープが膨らみやすい箇所
- **S1 のランキング**: 「賢い推薦」に引っ張られて LLM/embeddings を入れたくなる。本フェーズは **deterministic 限定**（keyword + synonym + メタデータ加点）で止める。
- **S6/S7 の UI**: 生成後 result UI を作り込みすぎない。生成前は「区分が読める」最小限で。
- **missingHints**: 網羅しようとすると無限。「purpose 領域に current authoritative 0 件」程度の簡易版に固定。

### 触らない方がよい領域
- `safetyGate` / `applyStrategistInputBudget` / `strategistFlow` の判定ロジック本体（再利用はするが改変しない）。
- `src/agents/curator/schema.ts` の enum（表記揺れ厳禁＝正本）。
- 除外理由 taxonomy（`ExclusionReasonEnum`）— 新理由を増やさない。
- 既存 async job スキーマ（#15/#16 の範囲外を改変しない）。

### 認証・GCP・外部APIで詰まりそうな箇所
- candidates API はランタイムで Firestore を読む。**テストは必ず DI でモック**。実機疎通は Codex。
- `NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED` は Docker build 時に焼き込まれる（runtime 切替不可）。
- #15/#16 は Firestore TTL・Cloud Tasks lease・GCS・IAP/tenant 認可が絡む。**Cloud Agent 実装 → Codex 実機検証**の二段が安全。

### git/長時間実装を Copilot CLI / Cloud Agent に任せるとよい箇所
- S2 の API 実装一式（route + test + build + PR）→ Copilot CLI autopilot。
- S8（#15）/ S9（#16）→ Cloud Agent に issue ごと委譲し PR まで。

### Codex で最後に実機確認した方がよい箇所
- §3 末尾の「Codex で実機確認すべき項目」一式。

---

## 6. コピペ用 指示文（各AIへそのまま貼れる形・修正反映版）

### ▶ S1 → Claude Code（設計・実装）
```
リポジトリ方針（CLAUDE.md / .claude/skills/project-context、pnpm、npm 禁止）に従う。
src/services/candidateSelection/ に purpose-driven candidate selection の決定論コアを実装する。
これは metadata-only の「助言レイヤ」であり、本文・chunk・GCS・aiSafeContent・LLM を一切読まない/呼ばない。
入力: purpose: string と InventoryDocument[]（src/lib/inventory.ts）。
出力: CandidateDoc[]（recommendation 'include'|'exclude'|'needs_review'、reasonCode?/reasonLabel?/reasonDetail? は除外・確認時のみ、include には matchReason?/scoreBreakdown? を付与）と missingHints: string[]。本文・aiSafeContent・maskedText は含めない。

【safety 判定（修正必須）】
- isSafeForContextPackageExport（src/lib/contextPackageInput.ts）は aiSafeContent を要求する export 専用関数なので候補段階では使わない。
- safety は src/agents/masker/upgrade.ts の isBlockedForAi / needsMaskerEvaluation を使う（どちらも metadata で判定可能）。
- 分類は優先順で:
  1) isBlockedForAi(doc) → exclude, reasonCode 'restricted_sensitivity'
  2) needsMaskerEvaluation(doc) || doc.maskingPending===true → needs_review, 'masking_required_unavailable'
  3) doc.freshness==='superseded_candidate' → needs_review, 'superseded_or_stale'（既定 unchecked）
  4) status ∈ {curated, ai_safe} かつ上記非該当かつ score>=閾値 → include
- reasonCode/reasonLabel は src/agents/strategist/schema.ts の ExclusionReasonEnum / ExclusionReasonLabels を使い、新 enum を増やさない。include に taxonomy を付けない。

【ranking（決定論）】
purpose トークンと fileName/businessDomain/documentType の重なり + isAuthoritativeCandidate 加点 + freshness(current) 加点。参考: src/services/strategistOrchestrator/budget.ts。
Curator enum は日本語（料金管理 / 表 / 顧客対応 等）なので、英語 purpose（例: "invoice billing"）に備えて小さな synonym map を持つ:
  invoice/billing/請求/料金 → 料金管理 ; onboarding/研修/教育 → 教育・研修 ; payroll/給与 → 給与計算 （拡張可能な形で）。

missingHints は「purpose が示す businessDomain に current な authoritative 候補が 0 件」程度の簡易版でよい。
純関数で unit test を厚く。Firestore/HTTP に触れない。最後に pnpm typecheck と pnpm test を通す。
```

### ▶ S2 → GitHub Copilot CLI（API + test + build）
```
pnpm を使う（npm 禁止）。CLAUDE.md の Verification Policy に従う。
POST /api/context-package/candidates を src/app/api/context-package/candidates/route.ts に実装。
src/app/api/context-package/route.ts の作法を踏襲（runtime='nodejs', dynamic='force-dynamic'）。
zod 検証: { purpose: string(1..2000), inventoryLimit?: number(default 300, max 500), responseLimit?: number(default 50, max 100) }。
※ limit は2系統に分ける: inventoryLimit=Firestore から読む件数（listInventoryDocumentsFromFirestore に渡す）、responseLimit=UI に返す件数。最近100件しか見ない問題を避ける。
※ MVP では filters は持たない（superseded は S1 が常に needs_review で返す）。将来 showSuperseded? を追加。
Inventory は listInventoryDocumentsFromFirestore(inventoryLimit)（src/lib/inventoryFirestoreAdapter.ts）で読み、src/services/candidateSelection に渡し、score 降順で responseLimit 件を返す。
レスポンスは metadata と reasonLabel/matchReason のみ。aiSafeContent / 本文 / maskedText は絶対に含めない。
Inventory 0 件は 409 no_inventory_documents。
M1 では audit を書かない（候補表示は export ではない。必要なら将来 document.candidate_preview を decision 化）。LLM・chunk ロードは呼ばない。
テストは runStrategistOrchestrator と同じ DI 流儀（deps.listInventoryDocuments）で Firestore をモック。pnpm test 該当範囲と pnpm build を通し PR 作成。
```

### ▶ S3 → Claude Code（契約 docs）
```
本書（docs/phase-4-ux-direction.md）§候補レスポンス型を UI 実装者向けの単一情報源として確認・整備し、request/response 例・status code・reasonCode 一覧（ExclusionReasonLabels 由来）が揃っていることを保証する。必要なら docs/architecture.md から参照を張る。
```

### ▶ S4 → Cursor Composer（fixture / golden）
```
synthetic な inventory fixture（実顧客データ・PII 禁止）で候補ランキングの golden snapshot を作り、スコア式変更時の回帰を検知できるようにする。sample-data/ には synthetic / masked のみ。pnpm test を通す。
```

### ▶ S5 → Cursor Composer（候補選択 UI）
```
pnpm 前提。src/app/context-package/ContextPackageForm.tsx を二段フローに変更:
purpose 入力 → /api/context-package/candidates → 候補リスト（fileName, documentType・businessDomain, sensitivity バッジ, recommendation バッジ, reasonLabel/matchReason）→ チェックボックス選択 → 選択 docIds で既存 /api/context-package に生成依頼。
include は既定チェック、exclude はチェック不可＋reasonLabel 表示（本文は出さない）、needs_review は未チェック既定＋注意表示。
docId 手入力 textarea は「上級者向け」折りたたみへ退避（主導線から外す）。
purpose が変更されたら candidates / selectedDocIds / preview を invalidate し、再取得まで生成ボタンを無効化する（stale candidates で生成させない）。
既存の async polling(pollJob)・budget truncation 警告・エラー表示は維持。型/状態は既存 UiState 流儀。styles.css に追記。pnpm test src/app/context-package を通す。
```

### ▶ S6 → Cursor Composer（Safety Review Panel）
```
src/app/context-package/ に SafetyReviewPanel.tsx を追加。candidates API レスポンスから include/exclude/needs_review を3カラム、missingHints を別枠で生成前に表示。文言は reasonLabel（ExclusionReasonLabels）を使う。本文は出さない。生成後 result パネルと視覚言語を揃える。styles.css に追記。
```

### ▶ S7 → Claude Code（設計）+ Cursor（UI）
```
選択中 candidates から「生成時に AI へ渡る集合」のプレビューを生成前に表示する PreGenerationPreview を作る。Restricted/blocked が混ざらないこと・masking 必要分の扱い・superseded を含む場合の警告を deterministic に表示。判定は既存 isSafeForContextPackageExport / safety gate と矛盾しないこと。チャンク本文の重い取得はしない（文書メタ単位）。projection に unit test を付ける。生成ボタンは「内容を確認しました」確認後に有効化する設計を検討。
```

### ▶ S8 → GitHub Copilot Cloud Agent（#15）
```
Resolve GitHub issue #15 (Context Package job GC and stuck-running recovery). pnpm only.
terminal job の retention（Firestore TTL or scheduled sweeper）、lease 失効した stale running job の検知と terminal 化/復旧、予約済み cancelled の配線可否を docs/open-questions.md R10 と PR #14 レビューに沿って決め、テストと運用 docs を追加。lease の分散システム的正しさを最優先で検証。worker lease 15分 / queue max-retry-duration ≥1800s（docs/setup-gcp.md §2）と整合。PR を作成。GCP 実機検証は後段で Codex が行う前提でよい。
```

### ▶ S9 → GitHub Copilot Cloud Agent（#16）
```
Resolve GitHub issue #16 (Offload large Context Package results to GCS). pnpm only.
MAX_INLINE_RESULT_BYTES 超過 result を GCS に保存し job doc に resultRef を持たせる。tenant isolation と result-route 認可は不変。offload 成果物の retention/cleanup を決め、inline と GCS-backed 両方の取得テストを追加。PR を作成。GCS/認可の実機検証は Codex 前提でよい。
```

### ▶ S10 → Codex（運用・実機）
```
production async smoke runbook の正本は docs/setup-gcp.md §8（Context Package 非同期 production smoke）と docs/demo-runbook.md。両者を運用手順として定着させ、Secret/IAP/Cloud Tasks 事故防止チェックリストと、job 失敗・stuck・大型 result の監視/アラートを追加。
新規 POST /api/context-package/candidates の Cloud Run + IAP 越しヘルス確認を runbook に追加。
#15/#16 マージ後に lease GC・GCS offload・認可境界・tenant 分離を実機 smoke で証跡化し docs に残す。
worker lease 15分 / queue max-retry-duration ≥1800s（setup-gcp.md §2）の整合も確認する。
```

### ▶ S11 → Claude Code（decision/direction）
```
本フェーズの decision（命名衝突解消・候補 API 契約・分類規則・superseded 既定・セキュリティ境界）を D-P4UX-* として docs/decisions.md に追記し、本書を維持する。未決は docs/open-questions.md に残す。旧「Phase 4」(マルチテナント商用化) と明確に区別する。
```

---

## 関連ドキュメント
- [docs/decisions.md](decisions.md) `D-P4UX-0` — 本フェーズの命名・スコープ・分類規則・セキュリティ境界の正本
- [CLAUDE.md](../CLAUDE.md) — 製品定義の正本
- [docs/phase-3-m-pdf-masker-live-smoke.md](phase-3-m-pdf-masker-live-smoke.md) — Context Package 同期/非同期 live smoke 証跡
- [docs/setup-gcp.md](setup-gcp.md) §8 — Context Package 非同期 production smoke（runbook 正本）
- [docs/open-questions.md](open-questions.md) R10 — async job follow-ups（#15 / #16 の起点）
- [docs/firestore-schema.md](firestore-schema.md) — Firestore document shape の正本

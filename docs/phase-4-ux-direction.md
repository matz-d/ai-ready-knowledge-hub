# Phase 4-UX: Purpose-Driven Context Package Selection — 方針 / 作業分配（正本）

**日付**: 2026-06-03
**状態**: S1–S7（Phase 4-UX MVP 機能）実装済み。S8/S9/S10 Production Hardening は production smoke 完了、GitHub issue #15/#16 close 済み。
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
- **Production Hardening（MVP と独立・並列可）**: S8（#15）, S9（#16）, S10（runbook/監視）。production revision `ai-ready-knowledge-hub-00041-2kr` で async job / sweeper / GCS offload / tenant isolation / TTL を確認済み。
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

### 候補 API 契約（S1/S2/S3 共通の正本 — UI 実装者向け単一情報源）

> **正本ポリシー**: 本節が `POST /api/context-package/candidates` の request/response 型・status code・reasonCode・UI 既定動作の**唯一の正本**。製品判断（命名・二層構造・分類規則）は [docs/decisions.md](decisions.md) `D-P4UX-0` / `D-P4UX-1` / `D-P4UX-2`。TypeScript 型の実装正本は `src/services/candidateSelection/types.ts`。API ルートは `src/app/api/context-package/candidates/route.ts`。
>
> S5/S6/S7（UI）は本契約のみに依存して並行着手できる。本文・`aiSafeContent`・`maskedText`・chunk は**絶対にレスポンスに含めない**。

#### TypeScript 型（UI / API 共通）

```ts
// 実装 import 例（フロント / テスト）:
// import type { CandidateDoc, CandidateRecommendation } from '@/services/candidateSelection';

type CandidateRecommendation = 'include' | 'exclude' | 'needs_review';

type CandidateDoc = {
  docId: string;
  fileName: string;
  documentType: DocumentType;       // src/agents/curator/schema.ts（日本語 enum 正本）
  businessDomain: BusinessDomain;   // 同上
  sensitivity: Sensitivity;         // 同上
  freshness: Freshness;             // 同上
  isAuthoritativeCandidate: boolean;
  status: DocumentLifecycleStatus;  // curated | ai_safe | blocked | restricted | …
  updatedAt?: string;               // ISO 8601
  score: number;                    // deterministic raw relevance score（降順ソート済み）
  recommendation: CandidateRecommendation;
  // 除外/確認の理由のみ taxonomy を使う。include には付けない。
  reasonCode?: ExclusionReason;     // ExclusionReasonEnum（増やさない）
  reasonLabel?: string;             // ExclusionReasonLabels 由来（UI 表示用）
  reasonDetail?: string;            // 補足説明（任意。UI は reasonLabel の次に表示可）
  // include 側の説明は別名で（enum を汚さない）
  matchReason?: string;
  scoreBreakdown?: Record<string, number>;  // 例: { fileName, businessDomain, documentType, freshness, authoritative, recency }
};

type CandidatesResponse = {
  candidates: CandidateDoc[];
  missingHints: string[];           // purpose 領域で足りない情報のヒント（0 件可）
  inventoryScanned: number;         // Firestore から読んだ件数（= inventoryLimit 以下）
};

// レスポンスに含めてはいけないフィールド（テストでも assert する）:
// aiSafeContent, maskedText, rationale, body, chunks, content
```

### リクエスト（`POST /api/context-package/candidates`）

```jsonc
// POST /api/context-package/candidates
{
  "purpose": "新人スタッフ向けに給与計算業務を学べるAIを作りたい",
  "inventoryLimit": 300,   // optional, default 300, max 500
  "responseLimit": 50      // optional, default 50,  max 100
}
```

- `inventoryLimit` と `responseLimit` の**2系統分離**が設計の肝。`inventoryLimit` は Firestore から読む件数（全 Inventory を見る）、`responseLimit` は score 降順でトリミングした後に UI へ返す件数。「最近 100 件だけ」といった実装を防ぐ。

### レスポンス（200 OK）

```jsonc
{
  "candidates": [
    {
      "docId": "doc-abc123",
      "fileName": "給与計算チェックリスト.csv",
      "documentType": "表",
      "businessDomain": "給与計算",
      "sensitivity": "Internal",
      "freshness": "current",
      "isAuthoritativeCandidate": true,
      "status": "curated",
      "updatedAt": "2026-05-20T10:00:00Z",
      "score": 13.8,
      "recommendation": "include",
      "matchReason": "給与計算に関連する現行版の正本候補",
      "scoreBreakdown": {
        "fileName": 3,
        "businessDomain": 4,
        "documentType": 0,
        "freshness": 3,
        "authoritative": 2,
        "recency": 1.8
      }
    },
    {
      "docId": "doc-def456",
      "fileName": "顧問契約書_実案件.pdf",
      "documentType": "契約書",
      "businessDomain": "契約管理",
      "sensitivity": "Restricted",
      "freshness": "current",
      "isAuthoritativeCandidate": true,
      "status": "restricted",
      "score": 0,
      "recommendation": "exclude",
      "reasonCode": "restricted_sensitivity",
      "reasonLabel": "Restricted 情報"
    },
    {
      "docId": "doc-ghi789",
      "fileName": "給与計算マニュアル_旧版.pdf",
      "documentType": "マニュアル",
      "businessDomain": "給与計算",
      "sensitivity": "Internal",
      "freshness": "superseded_candidate",
      "isAuthoritativeCandidate": false,
      "status": "curated",
      "score": 7.4,
      "recommendation": "needs_review",
      "reasonCode": "superseded_or_stale",
      "reasonLabel": "古い／上書き候補"
    }
  ],
  "missingHints": ["給与計算領域に現行版の正本候補文書がありません"],
  "inventoryScanned": 47
}
```

本文 / `aiSafeContent` / `maskedText` は**絶対に含めない**。

### status codes

| HTTP | body `code` | 説明 |
|---|---|---|
| 200 | ― | `CandidatesResponse` を返却（`candidates` が空配列も 200） |
| 400 | `invalid_request` | JSON パース失敗または Zod 検証失敗 |
| 409 | `no_inventory_documents` | Inventory に文書が 0 件 |
| 502 | `upstream_failure` | Firestore 読み取り等の upstream 失敗 |

#### エラーレスポンス body

```jsonc
// 400 — JSON パース失敗
{ "code": "invalid_request", "details": "JSON body を送信してください。" }

// 400 — Zod 検証失敗（例: purpose 空、limit 範囲外）
{ "code": "invalid_request", "details": [ /* zod issue 配列 */ ] }

// 409 — Inventory 空
{ "code": "no_inventory_documents" }

// 502 — upstream 失敗
{ "code": "upstream_failure" }
```

### reasonCode → reasonLabel 対応表（`ExclusionReasonLabels` 由来）

候補 API が使用できる `reasonCode` は `ExclusionReasonEnum` の全7値（`src/agents/strategist/schema.ts` 正本）。候補段階で**実際に付与される**のは下表の4値のみ。`purpose_mismatch` / `insufficient_evidence_quality` は deterministic ランキングではスコア低下で表現し、`reasonCode` には載せない。

| reasonCode | reasonLabel | origin | 候補 API での用途 |
|---|---|---|---|
| `restricted_sensitivity` | Restricted 情報 | safety_gate | `isBlockedForAi` → `exclude` |
| `masking_required_unavailable` | マスク済み版なし | safety_gate | `needsMaskerEvaluation` / `maskingPending` → `needs_review` |
| `superseded_or_stale` | 古い／上書き候補 | strategist | `freshness === 'superseded_candidate'` → `needs_review` |
| `human_confirmation_required` | 人間確認が必要 | strategist | 上記非該当かつ `status ∉ {curated, ai_safe}`（処理中・失敗等）→ `needs_review` |
| `cross_customer_confidentiality` | 他顧客・第三者の機密 | safety_gate | 将来拡張（現時点では `isBlockedForAi` が包含） |
| `purpose_mismatch` | 目的不一致 | strategist | **非使用** |
| `insufficient_evidence_quality` | 根拠品質不足 | strategist | **非使用** |

### UI 実装者向け既定動作（S5/S6 前提）

| `recommendation` | チェックボックス | 表示フィールド | 生成への docId 渡し |
|---|---|---|---|
| `include` | **既定 ON**（ユーザーが OFF 可） | `matchReason`, `scoreBreakdown?`, メタバッジ | 選択 ON の docId のみ |
| `exclude` | **選択不可（disabled）** | `reasonLabel`（+ `reasonDetail?`） | 渡さない |
| `needs_review` | **既定 OFF**（ユーザーが ON 可） | `reasonLabel`（+ `reasonDetail?`） | 明示 ON の docId のみ |

- `missingHints` は候補リストとは別枠で表示（S6 Safety Review Panel）。
- purpose を変更したら `candidates` / 選択 docIds / preview を **invalidate** し、再取得完了まで生成ボタンを無効化（stale candidates で生成させない）。
- 候補取得後の生成は既存 `POST /api/context-package` に `{ purpose, docIds: string[] }` を渡す（docId 手入力は上級者向け折りたたみに退避）。

### S1 metadata-only 分類ルール（優先順）

```
1. exclude       : isBlockedForAi(doc)                 → reasonCode 'restricted_sensitivity'
2. needs_review  : needsMaskerEvaluation(doc)
                   || doc.maskingPending === true       → reasonCode 'masking_required_unavailable'
3. needs_review  : doc.freshness === 'superseded_candidate'
                                                        → reasonCode 'superseded_or_stale'（既定 unchecked）
4. include       : status ∈ {curated, ai_safe} かつ 上記非該当 かつ score >= 閾値
                                                        → matchReason / scoreBreakdown を付与
5. needs_review  : 上記いずれにも該当しない（処理中 status 等）
                                                        → reasonCode 'human_confirmation_required'
※ aiSafeContent の有無は候補段階で確認しない（権威ある本文ゲートは生成経路の safetyGate に委ねる）
```

---

### S1. 候補ランキング & 分類コアモジュール（M1 中核）— **実装済み**
- **目的**: purpose と `InventoryDocument[]` から、決定論的に score・recommendation・reasonCode/Label・missingHints を出す純関数群。LLM・chunk・GCS・aiSafeContent 一切なし。
- **対象**: `src/services/candidateSelection/`（`ranking.ts`, `classify.ts`, `missingHints.ts`, `synonyms.ts`, `selectCandidates.ts`, `types.ts`, `index.ts`, `__tests__/`）
- **推奨担当AI**: **Claude Code**（設計）→ 実装も Claude Code か Copilot CLI
- **推奨理由**: inventory / masker upgrade / strategist taxonomy / budget を横断する再利用設計判断が中心。
- **難易度**: 中 / **認証・GCP**: 不要（純関数）/ **依存**: S0 / **並列**: S5/S8/S9/S11 と並列可
- **検証**: `pnpm test src/services/candidateSelection` / **完了条件**: 代表 fixture で4分類と missingHints が期待通り、typecheck green。
- **S2 への入口**: `selectCandidates(purpose, docs, { responseLimit, now? })` を facade として公開（`index.ts` から re-export）。**分類 → missingHints 計算 → responseLimit スライス** の順序を内部で固定し、`{ candidates, missingHints, totalClassified }` を返す。S2 はこの facade を呼ぶこと（`classifyInventory` + `generateMissingHints` を手配線しない）。理由: hints を responseLimit でスライスした後に計算すると、上限を超えた位置の current/authoritative 文書を見落とし「足りない」を誤検出するため。
- **実装結果（2026-06-03）**: 33 unit test green、`pnpm typecheck` / `pnpm test`（704 件）green。`generateMissingHints` のコアロジックは確定版。
- **指示文**: §6 参照。

### S2. `POST /api/context-package/candidates` API ルート（M1）— **実装済み**
- **目的**: purpose + limit を検証し Inventory を読み S1 を呼んで候補を返す。生成（LLM）はしない。
- **対象**: `src/app/api/context-package/candidates/route.ts`, `__tests__/`
- **推奨担当AI**: **GitHub Copilot CLI**（route + DI test + build を autopilot で一括）
- **難易度**: 中 / **認証・GCP**: ランタイムで Firestore 読み取り（テストは mock 注入、新規 GCP 設定不要）/ **依存**: S1 / **並列**: S1 完了後は S3/S4 と並列可
- **検証**: `pnpm test src/app/api/context-package/candidates` / **完了条件**: 200 候補・400 検証・409 空 inventory のテスト green。
- **指示文**: §6 参照。

### S3. 候補レスポンス契約のドキュメント化（M1）— **実装済み**
- **目的**: 上の確定版型・status code・reasonCode 一覧を docs 固定し UI が並行着手できるようにする。
- **対象**: 本書 §候補 API 契約（正本）。`docs/architecture.md` に参照を追加済み。
- **推奨担当AI**: **Claude Code** / 軽微なら Cursor
- **難易度**: 低 / **認証・GCP**: 不要 / **依存**: S1 / **並列**: S2 と同時進行可
- **実装結果（2026-06-03）**: UI 向け単一情報源として request/response 型・エラー body・502・UI 既定動作表・TypeScript import パスを本節に集約。`D-P4UX-1` と実装（S2 route / S1 classify）を整合。

### S4. （任意）候補スコアリングの fixture / golden — **実装済み**
- **目的**: ランキング回帰を golden で守る。
- **対象**: `sample-data/candidate-selection/accounting-office-inventory.fixture.json`, `src/services/candidateSelection/__tests__/golden.test.ts`, `__tests__/__snapshots__/golden.test.ts.snap`
- **推奨担当AI**: **Cursor Composer**
- **難易度**: 低 / **認証・GCP**: 不要 / **依存**: S1 / **並列**: 可
- **実装結果（2026-06-03）**: synthetic 10 件 fixture（include / exclude / needs_review 各パターン）+ 3 golden snapshot（日本語 purpose / 英語 synonym / responseLimit）。`pnpm test src/services/candidateSelection` 36 passed。

### S5. Candidate Selection UI（M2）— **実装済み**
- **目的**: docId 手入力を主導線から外し、候補チェックボックスリスト（reason / status / sensitivity）で選択 → 生成。
- **対象**: `src/app/context-package/ContextPackageForm.tsx`, `src/app/styles.css`, `CandidateSelectionList.tsx`, `candidateSelectionUi.ts`
- **推奨担当AI**: **Cursor Composer**（UI）/ 状態設計の難所は Claude Code に相談
- **難易度**: 中 / **認証・GCP**: 不要 / **依存**: S2, S3 / **並列**: M5 と並列可
- **検証**: `pnpm test src/app/context-package` + 手動 / **完了条件**: purpose だけで候補が出て、選択して生成でき、docId 手入力なしで一巡。purpose 変更時に stale candidates で生成させない。
- **指示文**: §6 参照。

### S6. Safety Review Panel（M3）— **実装済み**
- **目的**: 生成前に「AI に渡せる / 除外すべき / 人間確認すべき / 足りない」を候補 API 出力から表示。
- **対象**: `src/app/context-package/SafetyReviewPanel.tsx`, `src/app/styles.css`
- **推奨担当AI**: **Cursor Composer**（UI）/ taxonomy→文言マッピングは Claude Code が下書き
- **難易度**: 中 / **認証・GCP**: 不要 / **依存**: S2, S5 / **並列**: S7 と隣接（同 UI 領域で S5→S6→S7 は直列気味）

### S7. Context Package Preview（生成前の安心）（M4）— **実装済み**
- **目的**: 生成前に「この情報を AI に渡します。raw PII / Restricted / stale は含みません」を明示。
- **対象**: `src/app/context-package/preGenerationPreview.ts`, `PreGenerationPreviewPanel.tsx`（UI。macOS 等では `PreGenerationPreview.tsx` と `preGenerationPreview.ts` が衝突するため Panel 名）, `ContextPackageForm.tsx`
- **推奨担当AI**: **Claude Code**（safety projection の整合設計＝完了）→ UI は Cursor
- **難易度**: 中 / **認証・GCP**: 不要 / **依存**: S2, S5, S6 / **並列**: M5 と並列可
- **注意**: 生成前 deterministic 判定は既存 `isSafeForContextPackageExport` / safety gate と矛盾しないこと。チャンク本文の重い取得はせず文書メタ単位。
- **projection 実装結果（2026-06-03 / Claude Code）**:
  - `projectPreGenerationPreview(candidates: CandidateRow[], selectedDocIds: ReadonlySet<string>): PreGenerationPreview` — 純関数・決定論・metadata-only。
  - 戻り値 `{ willSend, autoExcluded, warnings, unknownDocIds, counts, hasAutoExcluded, hasWarnings }`。各行は `disposition`（`will_send` | `auto_excluded` | `stale_warning` | `masking_pending` | `needs_confirmation`）と日本語 `note` を持つ。
  - **整合の核**: 候補レイヤは `aiSafeContent` を読まない（二層構造）。よって projection は「除外（安全側）は断言、送信は予測（生成時の本文ゲートで narrowing されうる）」という framing。`auto_excluded` は safetyGate ルール1–2（Restricted / blocked）を metadata でミラーし、downstream gate が同じ除外を必ず enforce するので矛盾しない。`will_send` は予測であり over-promise しない。
  - **安全インバリアント**: `classify()` が unsafe を最優先判定するため Restricted/blocked は構造的に `will_send` へ落ちない。`Confidential`＋`ai_safe`（マスク済み）は送信可（Restricted のみが安全ブロッカ）。
  - **advanced override の穴**: 候補一覧にない手入力 docId は `unknownDocIds` で可視化し ack を要求。
  - `previewRequiresAcknowledgement(preview)`: auto-excluded / warning / unknown があれば true（生成ボタン有効化前の「内容を確認しました」判定用）。
  - 16 unit test green（最重要は「will_send に unsafe が混ざらない」）。`pnpm typecheck` / `pnpm test src/app/context-package`（33）green。
- **UI への申し送り（Cursor）**: `PreGenerationPreviewPanel.tsx` は上記 projection を `candidates` + 実効 `docIds`（`resolveDocIdsForGeneration`）から計算して表示する（自前の安全判定を書かない）。生成ボタンは S5 の `canGenerateContextPackage(...)` に加えて `!previewRequiresAcknowledgement(preview) || acknowledged` を AND する。S6 SafetyReviewPanel と視覚言語を揃える。本文・aiSafeContent は出さない。

### S8. #15 Job GC / stuck-running recovery（Hardening）— **完了**
- **目的**: Cloud Tasks リトライ枯渇後に `running` で詰まる job の GC / 復旧、`cancelled` 配線、terminal job retention。
- **対象**: `src/lib/contextPackageJobs/`, sweeper/TTL, `docs/`、GH #15
- **推奨担当AI**: **GitHub Copilot Cloud Agent**（issue 起点で PR まで）→ **Codex** が lease/Cloud Tasks の実機確認
- **難易度**: 高 / **認証・GCP**: 要（Firestore TTL / Cloud Tasks / lease）/ **依存**: なし（独立）/ **並列**: M1〜M4 と完全並列
- **注意**: lease の分散システム的正しさを最優先で検証。worker lease 15分 / queue max-retry-duration ≥1800s（`setup-gcp.md` §2）と整合。
- **実装結果（2026-06-03 / 2026-06-08 検証完了）**: terminal job TTL、`DELETE /api/context-package/jobs/:jobId` cancel、`POST /api/context-package/jobs/sweep` stale recovery、route / adapter tests を追加済み。production sweeper resume + manual run、async job retry recovery、`expiresAt.timestampValue`、queue empty、Token Creator cleanup を確認し、GitHub issue [#15](https://github.com/matz-d/ai-ready-knowledge-hub/issues/15) は close 済み。

### S9. #16 Large result GCS offload（Hardening）— **完了**
- **目的**: `MAX_INLINE_RESULT_BYTES` 超 result を GCS に退避し job doc に `resultRef`。
- **対象**: `src/lib/contextPackageJobs/`, result route, GH #16
- **推奨担当AI**: **GitHub Copilot Cloud Agent** → **Codex** が GCS / 認可境界の実機確認
- **難易度**: 高 / **認証・GCP**: 要（GCS / 認可）/ **依存**: なし（S8 と同ファイル群＝直列推奨）/ **並列**: M1〜M4 と並列
- **注意**: tenant isolation と result-route 認可は不変。
- **実装結果（2026-06-03 / 2026-06-08 検証完了）**: `MAX_INLINE_RESULT_BYTES` 超過 result を GCS `context-package/job-results/{tenant}/{job}.json` へ退避し、job doc は `resultRef` を保持する。inline / GCS-backed result route と cleanup tests を追加済み。production GCS offload / result route 認可 / tenant isolation smoke を確認し、GitHub issue [#16](https://github.com/matz-d/ai-ready-knowledge-hub/issues/16) は close 済み。

### S10. Smoke runbook 定着 + monitoring/alert（Hardening）
- **目的**: production async smoke runbook を運用に乗せ、Secret/IAP/Cloud Tasks 事故防止チェックと監視/アラートを整える。
- **対象**: **`docs/setup-gcp.md` §8（正本）** + `docs/demo-runbook.md`, monitoring 設定
- **推奨担当AI**: **Codex**（IAP / Cloud Run / Cloud Tasks / live smoke の実機）
- **難易度**: 高 / **認証・GCP**: 要 / **依存**: S2（candidates health 追加）, S8/S9 と整合 / **並列**: docs 整備は随時、最終確認は統合後
- **実装結果（2026-06-03 / Codex）**:
  - `docs/setup-gcp.md` §8 を production async smoke の正本として拡張（preflight / service-to-service smoke / post-smoke cleanup / Monitoring alert / incident triage）。
  - `docs/demo-runbook.md` から §8 へ参照を追加。
  - production revision `ai-ready-knowledge-hub-00036-dfb` で service-to-service smoke 完了: job `a5bfcfef-fa29-4c88-94c3-47e897b05ec9` が HTTP 202 → `succeeded` → result HTTP 200、masked content / raw PII 不在を確認。
  - Firestore TTL（`context_package_jobs.expiresAt`）と GCS lifecycle（`context-package/job-results/`, 14日削除）を設定。
  - log-based metrics `context_package_job_errors` / `context_package_stale_recoveries` と alert policies 3本（job errors / stale recoveries / Cloud Tasks backlog）を作成。通知 channel は未設定のため、Console で notificationChannels を追加する。
  - **2026-06-08 追補**: Cloud Scheduler `context-package-job-sweeper` は `ENABLED`。manual run で Cloud Run log `[context-package-job] sweeper completed` を確認。production revision `ai-ready-knowledge-hub-00041-2kr` で final async smoke job `5d51117a-6a46-40bd-b981-9bc250a448ba` が HTTP `202` → `succeeded` → result HTTP `200`、`expiresAt.timestampValue`、queue empty、Token Creator cleanup を確認済み。
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
Inventory は listInventoryDocumentsFromFirestore(inventoryLimit)（src/lib/inventoryFirestoreAdapter.ts）で読み、selectCandidates(purpose, docs, { responseLimit })（src/services/candidateSelection。index.ts から export 済み）に渡す。戻り値 { candidates, missingHints, totalClassified } をそのままレスポンスに使う。candidates は score 降順で responseLimit 件に絞り込み済み。
※ classifyInventory / generateMissingHints を直接呼んで手配線しないこと。selectCandidates が「分類→hints計算→スライス」の順序を保証している（slice 後に hints 計算すると上限超の current/authoritative を missing 誤検出する）。
レスポンスは { candidates, missingHints } の metadata と reasonLabel/matchReason のみ。aiSafeContent / 本文 / maskedText は絶対に含めない。
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

### ▶ S7 設計・projection（Claude Code）— **完了**
```
src/app/context-package/preGenerationPreview.ts に純関数 projectPreGenerationPreview / previewRequiresAcknowledgement を実装済み。
metadata-only・決定論・safetyGate ルール1–3 をミラー。本文/aiSafeContent/chunk を読まない。16 unit test green。
```

### ▶ S7 UI（Cursor）— **実装済み**
```
pnpm 前提。src/app/context-package/PreGenerationPreviewPanel.tsx を新規作成し、ContextPackageForm.tsx に組み込む（ファイル名は `preGenerationPreview.ts` とのケース衝突回避）。
安全判定は自前で書かず、preGenerationPreview.ts の projectPreGenerationPreview(candidates, selectedDocIds) の戻り値だけを描画する:
  - willSend（AI へ渡す予定）/ autoExcluded（Restricted 等で自動除外。AI には渡らないと明示）/ warnings（stale・masking 未完・unknownDocIds）を区分表示。
  - 各行の note（日本語）と disposition を使う。本文・aiSafeContent は絶対に出さない。
  - counts と hasAutoExcluded / hasWarnings でサマリ（「AI へ渡す N件 / 自動除外 M件 / 要確認 K件」）を出す。
生成ボタンは S5 の canGenerateContextPackage(...) に加えて (!previewRequiresAcknowledgement(preview) || acknowledged) を AND する。
acknowledged は「内容を確認しました」チェックボックス state。warning/auto-excluded/unknown が無いときは ack 不要（previewRequiresAcknowledgement が false）。
S6 SafetyReviewPanel と視覚言語（cp-safety-* クラス系）を揃え、styles.css に追記。pnpm test src/app/context-package を通す。
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
- [docs/decisions.md](decisions.md) `D-P4UX-0` / `D-P4UX-1` / `D-P4UX-2` — 製品判断・API 契約・コアモジュール設計の正本
- [docs/architecture.md](architecture.md) — Phase 4-UX フロー概要（§Phase 4-UX 参照）
- [CLAUDE.md](../CLAUDE.md) — 製品定義の正本
- [docs/phase-3-m-pdf-masker-live-smoke.md](phase-3-m-pdf-masker-live-smoke.md) — Context Package 同期/非同期 live smoke 証跡
- [docs/setup-gcp.md](setup-gcp.md) §8 — Context Package 非同期 production smoke（runbook 正本）
- [docs/open-questions.md](open-questions.md) R10 — async job follow-ups（#15 / #16 の起点）
- [docs/firestore-schema.md](firestore-schema.md) — Firestore document shape の正本

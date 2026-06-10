# P1-F: Async Full-Coverage Strategist（batched review）

**作成**: 2026-06-10
**位置づけ**: P1-B（source bundle zip UI）のデブサーバー確認で露出した、P1-C 前に直すべき本丸バグの修正計画。`docs/next-actions-2026-06-10.md` の優先表に P1-F として登録し、**実行順は P1-C より先**。

---

## 1. きっかけ（観測された事象）

P1-B 実装後、purpose「新入社員向けに、月次の給与計算業務を安全に学べる NotebookLM を作りたい…」で 30 文書を選択して生成したところ:

- UI に truncation 警告: **safe chunk 400 件（20 文書）が budget で除外**
- Strategist が実際にレビューしたのは budget 内に残った 5 文書 / ≤80 chunk のみ
- included は 2 chunk → **zip は guide + 2 source の3ファイル**
- 落ちた文書の中に `給与計算チェックリスト.md`（目的のど真ん中）が含まれていた

観測された dropped 内訳は付録 A を参照。

## 2. 診断（3層）

### 2-a. 思想（bundle の中身）— 問題なし

`sourceBundle` = **Strategist curated bundle** は正しい。safety-cleared を広く全部入れる案は「目的に必要な情報へ整理する」という Context Package の価値命題（CLAUDE.md 4分類）を壊すため、別 export mode としても作らない。

### 2-b. 本丸バグ — async 経路の budget が据え置き

- `src/services/strategistOrchestrator/budget.ts` の pre-LLM budget（5文書/80chunk/45k chars）は、Vertex 入力 token 上限による `INVALID_ARGUMENT` 回避 + 同期 20 秒ゲートのための guard。「全候補レビュー」を放棄する根拠ではない。
- `src/lib/contextPackageLimits.ts:6` は「async jobs handle slow broad requests」と宣言して選択上限を 100 に広げた。
- ところが `src/lib/contextPackageJobs/runJob.ts` は `enforceSyncBudget: false` を渡すだけで `inputBudget` 未指定 → `DEFAULT_STRATEGIST_INPUT_BUDGET` がそのまま適用。**async job は 20 秒ゲートが外れるだけで、レビュー母集団は同期と同じ 5 文書のまま**。
- UI は `mode: 'auto'` で route が sync/async を判定するため、広い選択は async job に流れ、そこでこのギャップを踏む。

### 2-c. 副因 — 日本語 purpose で関連度スコアがほぼ無効

`budget.ts#purposeTerms` は空白・句読点分割のため、日本語 purpose からは「月次の給与計算業務を安全に学べる」のような長い連結句が term になり、chunk 本文への substring 一致がほぼ起きない（budget.ts 自身が注記済み）。結果、「どの 5 文書を残すか」が freshness/recency 頼みになり、`給与計算チェックリスト.md` が落ちて fixture 系が残るような選別になった。

## 3. 確定した設計判断

| ID | 判断 | 内容 |
|---|---|---|
| D-CP-COV-1 | bundle 思想 | `sourceBundle` = Strategist curated を維持。broad bundle mode は作らない |
| D-CP-COV-2 | coverage | **async 経路は batched strategist で全 safe chunk をレビューする（truncation ゼロ）**。truncation warning は同期経路・暫定の安全表示に格下げ |
| D-CP-COV-3 | missing/questions のマージ | included/excluded は決定論的 union。**missing / humanReviewQuestions は決定論的 dedupe + reduce LLM pass 1回**で全体整合させる。偽 missing（バッチAで missing 扱いだがバッチBの資料に存在）は4分類の信頼毀損なので許容しない。reduce 失敗時は dedupe-only に fallback し、成果物に degraded を明示 |

「budget を単純に引き上げる」案（Gemini 3.5 は長 context）は不採用。理由: lost-in-the-middle による選別品質低下、chunk ごとの verdict 列挙による**出力 token 長の爆発**、コスト。バッチ化は両方を構造的に回避する。

## 4. 現状の実装地図（実装者向け fact）

すでに動いているもの（**再実装しないこと**）:

- **truncation の可視化は end-to-end 配線済み**:
  - `budget.ts#applyStrategistInputBudget` → `droppedDocuments`（文書別内訳）
  - `orchestrator.ts#buildResult` → `budgetDroppedDocuments`
  - `toContextPackage.ts#buildStrategistExportInput` → `budgetTruncatedDocuments`
  - `exportContextPackage.ts` → 単一 .md / bundle guide 両方に `Budget Truncation (Incomplete Coverage)` 節 + manifest ⚠️ 行 + downstream AI への INCOMPLETE 指示（`truncationInstruction`）
  - `contextPackagePayload.ts` → payload の `budgetDroppedDocuments` / `budget.budgetDroppedCount`
  - `ContextPackageForm.tsx`（~688行）→ UI 警告
- **flow の検証基盤**: `strategistFlow` は `generateValidated`（4段フォールバック）+ `strategistOutputUnknownChunkRefMessage`（hallucinated ref 弾き、**自バッチ入力に対して**検証）。バッチ実行してもバッチごとにそのまま効く。
- **Strategist の契約**: 入力 chunk 全件の verdict は要求していない（included は「絞る」、未言及 chunk は黙って消える）。バッチ union でもこの意味論は変わらない。
- **job 基盤**: lease/claim/sweeper/GCS offload（S8–S10）。新インフラ不要。

## 5. スコープ外

- broad source bundle mode（D-CP-COV-1 で不採用）
- 同期経路のバッチ化（同期は budget + truncation 警告のまま）
- P1-D/P1-E（品質 eval・大ファイル分割）— 別トラック
- `purposeTerms` 改善は Stage 3 として本計画に含むが、Stage 2 の合格条件にはしない

---

## 6. 実装計画

### Stage 0: 検証（実装前、30分）

- [x] 今回ダウンロードした zip の `00-CONTEXT-PACKAGE-GUIDE.md` に `Budget Truncation` 節と INCOMPLETE 指示が実際に出ていることを確認（出ていなければ P1-A/B の配線バグなので先に直す）
  - 確認済み: `/Users/makotomatuda/Downloads/context-package_sources_新入社員向けに_月次の給与計算業務を安全に学べる_Noteb.zip`
  - guide に manifest の `Budget truncation: 400 safe chunk(s) across 20 document(s)`、downstream AI への `This package is INCOMPLETE` 指示、`## Budget Truncation (Incomplete Coverage)`、文書別 `Dropped chunks` が入っている。
- [x] `exportContextPackage` の既存テストで truncation 系（markdown / bundle guide 両方）がカバーされているか確認、無ければ追補
  - 既存では payload の `budgetDroppedDocuments` は固定済みだったが、markdown / bundle guide の truncation 表示を直接固定するテストが不足していた。
  - `src/lib/__tests__/exportContextPackageSourceBundle.test.ts` に単一 markdown と bundle guide 両方の truncation 表示テストを追補。
  - `pnpm vitest run src/lib/__tests__/exportContextPackageSourceBundle.test.ts` passed（11 tests）。

### Stage 1: 小さな磨き（半日以内）

- [ ] **UI**: truncation がある result では bundle zip ダウンロードボタンに不完全であることを明示（例: ボタン脇に「⚠️ 不完全版」バッジ、または click 時に1行 confirm）。`budgetDroppedDocuments.length > 0` で分岐
- [ ] **表示文言**: markdown / guide / UI の `Source documents reviewed` は実態が「loaded」なので、Stage 2 完了までの暫定として truncation 時のみ「(coverage incomplete)」が伝わる現行 ⚠️ 行で足りるか再確認。ラベル変更は payload key を変えない範囲で（`sourceDocumentsReviewed` key は据え置き）
- [ ] 同期経路の truncation 警告文に「対象を絞る」だけでなく「（Stage 2 後）非同期生成なら全件レビューされる」へ誘導する文言を予約（Stage 2 マージ時に有効化）

### Stage 2: async batched strategist（本丸、2–3日）

#### 2-1. バッチ分割（純関数、`src/services/strategistOrchestrator/batching.ts` 新設）

```
partitionStrategistBatches(candidates, purpose, config) → { batches: BudgetCandidate[][], stats }
```

- 入力は safety gate 通過済み candidates（`applyStrategistInputBudget` と同じ入口）
- **文書単位を保つ**: 文書レベル関連度（その文書の chunk score の max）降順に文書を並べ、文書ごとに chunk を元順序で詰める
- 各バッチの上限は `StrategistInputBudgetConfig` と同じ（maxDocuments/maxChunks/maxTotalPromptChars/maxCharsPerChunk）— Vertex 上限 guard をバッチ単位で維持
- **巨大文書の分割**: 1文書が maxChunks を超える場合（実例: `mhlw-r07-model-work-rules.pdf` 167 chunks > 80）、その文書の chunk を元順序のまま連続する複数バッチに跨がせる。バッチ内 chunk 順は常に元順序
- **不変条件（テストで固定）**: 全 candidate がちょうど1バッチに属する / 決定論的 / 各バッチが budget 制約を満たす

実装済み:
- `src/services/strategistOrchestrator/batching.ts`
- `src/services/strategistOrchestrator/__tests__/batching.test.ts`
- 小さい文書は丸ごと保持し、巨大文書のみ連続 batch に分割することをテストで固定。

#### 2-2. orchestrator に coverage mode 追加（`orchestrator.ts`）

- `RunStrategistOrchestratorInput` に `coverage?: 'budget' | 'full'`（既定 `'budget'` = 現行動作、変更なし）
- `coverage: 'full'` のとき:
  - `applyStrategistInputBudget` の単発絞り込みの代わりに `partitionStrategistBatches` でバッチ列を作る
  - バッチごとに `strategistFlow` を実行（まず **逐次**。並列化は quota（D-OPS-1: 実リスクは `global` 制約・fail-closed）を見てから env knob で）
  - included/excluded はバッチ間 union（バッチは disjoint なので衝突しないが、念のため docId+chunkId 重複 assert）
  - missing / humanReviewQuestions は per-batch 結果を貯めて 2-3 の reduce へ
  - `budget` report は全バッチ合算で `droppedChunks: 0`。`coverage: { mode: 'full', batches: N }` を report に追加
- `sourceDocumentsReviewed` は **読み込んだ terminal 文書数**にする。safety gate で全 chunk が落ちた文書も「reviewed」の対象であり、manifest と safetyExcluded の自己矛盾を避ける。
- guard: `coverage: 'full'` は `enforceSyncBudget: true` と併用不可（throw）。同期 route から full に入れない契約を型でなく実行時にも固定

実装済み:
- `RunStrategistOrchestratorInput.coverage?: 'budget' | 'full'`
- `coverage:'full'` + `enforceSyncBudget:true` の guard
- full mode は batch ごとに `strategistFlow` を逐次実行し、included/excluded を union。
- full mode の `budget.droppedChunks` / `budgetDroppedDocuments` は 0 / `[]`。
- full mode の `sourceDocumentsReviewed` は loaded document count。safe chunk が無い文書も safety review 済みとして数える。

#### 2-3. reduce flow（`src/agents/strategist/reduceFlow.ts` + schema 追補、新 LLM call は package あたり1回）

- 入力: `purpose` / included サマリ（docId, fileName, chunk title or rationale — **本文は渡さない**）/ 決定論 dedupe 済みの candidate missing[] / candidate questions[]
- 出力: `{ missing: MissingInfo[], humanReviewQuestions: HumanReviewQuestion[] }`（既存 `MissingInfoSchema` / `HumanReviewQuestionSchema` を再利用）
- プロンプト指示の核: 「included 一覧に実在する topic を missing から落とす」「重複・言い換えを統合する」「新規の missing を発明しない」
- 検証: `relatedChunkIds` ⊆ 全バッチ入力 chunk id の和集合 / 件数 cap（入力 candidate 数以下）
- **fallback**: `generateValidated` リトライ後も失敗したら dedupe-only 結果を採用し、result に `missingConsolidation: 'llm' | 'deterministic_fallback'` を持たせる。`'deterministic_fallback'` のとき guide/markdown の Missing Knowledge 節冒頭に「consolidation degraded（偽 missing が残り得る）」の1行を出す。job 全体は fail させない

実装済み:
- `src/agents/strategist/reduceFlow.ts`
- `src/services/strategistOrchestrator/consolidateGaps.ts`
- full mode では deterministic dedupe 後に reduce LLM を1回呼ぶ。
- reduce 失敗時は `deterministic_fallback` で job 全体は継続。
- `deterministic_fallback` の degraded 表示は単一 markdown / bundle guide の Missing Knowledge 節へ出す。
- 単一バッチでは cross-batch 不整合がないため reduce LLM を呼ばず deterministic のまま返す。
- reduce prompt は compact JSON を使い、allowed chunk ids は candidate questions に出現した id の和集合だけに絞る。

#### 2-4. runJob 配線（`runJob.ts`）

- `runStrategistOrchestrator({ ..., enforceSyncBudget: false, coverage: 'full' })`
- progress に `batchesCompleted / batchesTotal` を追加（`schema.ts#ContextPackageJobProgress` 拡張、optional field なので後方互換）
- バッチごとに progress 書き込み（既存の progress 書き込み経路を流用）。progress 更新時に lease を renew し、attempt token 不一致などで `false` が返った場合は旧 worker を中断する。

実装済み:
- `runJob.ts` は async job で `coverage:'full'` を渡す。
- `ContextPackageJobProgress` に `batchesCompleted / batchesTotal` を追加。
- `updateContextPackageJobProgress()` を追加し、batch progress callback から lease renewal 付きで更新。
- progress 更新が `false` を返した場合は `StrategistFullCoverageLeaseLostError` で batch loop を中断し、旧 worker は complete/fail せず skip する。

#### 2-5. 運用リスク確認（コード変更前に値を確認、必要なら調整）

- [x] job lease TTL / sweeper の stale 判定が「30文書 ≈ 7バッチ + reduce ≈ 数分」の実行時間に耐えるか
  - repo設定: `CONTEXT_PACKAGE_JOB_LEASE_MS = 15分`、queue max retry duration は setup doc で 30分推奨。
  - batch progress 更新ごとに `leaseExpiresAt` を延長する。lease 喪失時は旧 worker を中断し、二重 LLM パスを避ける。
- [ ] Cloud Tasks の dispatchDeadline と worker route の timeout が同上に耐えるか
  - repo上では明示的な dispatch deadline 設定は見当たらない。デプロイ済み queue / Cloud Run timeout の live config 確認が必要。
- [ ] Gemini quota: package あたり LLM call が 1 → 最大 ~8 に増える。`docs/setup-gcp.md` の Gemini 運用監視節（D-OPS-1）に追記
  - 実装上は sequential call。quota・latency は production smoke 前に監視観点へ追記する。

#### 2-6. テスト

- [x] `batching.test.ts`: 全件被覆・disjoint・決定論・巨大文書跨ぎ・バッチ budget 遵守・文書関連度順
- [x] `orchestrator.test.ts`: fake strategistFlow で full coverage（バッチ入力の合計=safe 全件 / union マージ / report の droppedChunks=0 / coverage block / sourceDocumentsReviewed 真値）
- [x] `reduceFlow` 検証ロジック（fallback 経路含む）
- [x] `runJob.test.ts`: coverage:'full' 配線・progress 拡張
- [x] payload/export: full coverage 時に truncation 節が出ないこと（既存 'None' 経路の確認）
- [x] `pnpm typecheck` / `pnpm test` / `pnpm build`

### Stage 2 Review Follow-up（2026-06-10）

外部レビューで挙がった主要 finding への対応:
- [x] lease renewal / lease lost abort: progress 更新で lease を延長し、false なら full coverage worker を中断。
- [x] `sourceDocumentsReviewed` の意味補正: full mode でも loaded document count に統一。
- [x] reduce fallback の degraded 表示: markdown / bundle guide に明示。
- [x] reduce validation の正規化差分と prompt肥大の軽減: candidate key 正規化を統一、compact JSON、allowed ids を candidate questions に限定。
- [x] 単一 batch では reduce LLM を呼ばない。
- [x] batch prompt の `safetyExcludedCount` は batch 内 doc に対応する件数だけ渡す。
- [ ] cross-document superseded / stale の再評価: 旧版・新版が別 batch に分かれると比較できない。Stage 2.5 として related document grouping または included/excluded reduce を検討する。
- [ ] budget admission predicate の一本化: `budget.ts` と `batching.ts` の判定ロジック重複を後続で整理する。

#### 2-7. Done 条件

- 今回の給与計算シナリオ（30文書）をデブサーバーで再実行し、**truncation 警告が出ず**、`給与計算チェックリスト.md` を含む妥当な included が bundle に入ること（手動 evidence を `docs/phase-4-ux-evidence/` へ）
- 同期経路（狭い docIds）の挙動が不変であること

### Stage 3: purposeTerms 日本語対応（後続、半日）

- `budget.ts#purposeTerms` に CJK 連続文字列の **bigram 展開**を追加（既存 term は残す、term 数 cap ~64、決定論）
- 効く先: 同期経路の budget 選別品質 + Stage 2 のバッチ順序（≒ 早いバッチに関連文書が来る）
- テスト: 今回の給与 purpose で `給与計算チェックリスト` 系 chunk のスコアが fixture 系を上回ること
- Stage 2 の合格条件ではない（full coverage なら順序が品質に与える影響は小さい）

---

## 7. 付録 A: 2026-06-10 デブサーバー実測（dropped 内訳）

400 chunks / 20 docs。上位: `mhlw-r07-model-work-rules.pdf` 167 / `mhlw-overtime-limit-guide.pdf` 138 / `synthetic-invoice-with-pii-scan.pdf` 37 / `mhlw-labor-conditions-notice-blank-scan.pdf` 14 / `synthetic-context-package-deck.pdf` 12 / `nta-withholding-form-blank-scan.pdf` 9 / ほか 1–4 chunk の文書多数（**`給与計算チェックリスト.md` 1 chunk を含む**）。

設計への含意:
- 167 chunk の単一文書 > maxChunks 80 → バッチ分割は文書跨ぎを必須要件にする（2-1）
- 最関連文書（給与計算チェックリスト）が落ち、fixture 系が残った → 関連度スコアの日本語問題の実証（Stage 3 の根拠）

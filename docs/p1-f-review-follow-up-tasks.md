# P1-F Review Follow-up Tasks

**作成**: 2026-06-10
**背景**: P1-F async full-coverage strategist の実装後レビューで、即時修正した finding と、後続 issue として残す finding を分離する。

## Status

P1-F Stage 2 の本体と主要 hardening は実装済み。

- async job は `coverage: 'full'` で batched strategist を実行する
- batch progress で lease を renew し、lease 喪失時は旧 worker を中断する
- reduce fallback は markdown / bundle guide に degraded 表示する
- single batch では reduce LLM を呼ばない
- batch prompt の safety excluded count は batch-local にした

## Completed Review Follow-ups

実装順序: **FU-2 → FU-1**（budget contract を先に単一化し、batch 境界の安全を固めてから version ambiguity guard を足す）。

### P1-F-FU-2: Budget admission predicate unification ✅

**Problem**: `budget.ts` と `batching.ts` が、chunk admission / budget guard に近い判定を別々に持っていた。sync budget と async batch の境界条件がずれるリスクがあった。

**Chosen approach**:
- `budget.ts` に `chunkAdmitsToBudget` / `admitChunkToBudget` / `chunksAdmitToBudget` / `batchSatisfiesBudgetContract` を切り出し、`StrategistInputBudgetConfig` の単一解釈を共有する。
- `applyStrategistInputBudget`（sync / relevance-ranked greedy）と `partitionStrategistBatches`（async / document-oriented full coverage）は **同じ admission predicate** を使うが、**選び方・分割方針は分離したまま**。
- 最初の 1 chunk は `maxTotalPromptChars` を超えても通す特例を predicate に含めた。

**Verification**:
- `src/services/strategistOrchestrator/__tests__/budgetAdmissionContract.test.ts`
- 既存 `budget.test.ts` / `batching.test.ts`

### P1-F-FU-1: Cross-document stale / superseded safety ✅

**Problem**: 旧版・新版が別 batch に分かれると、batch 内 strategist は相互比較できない。included union だけでは version conflict を人間確認へ回せない。

**Chosen approach**（LLM reduce / batch 前 grouping ではない）:
- full-coverage merge 後に、**決定論的 duplicate/version ambiguity guard**（`duplicateVersionGuard.ts`）を適用する。
- filename / title / year / version / freshness / `updatedAt` は **弱いヒント** のみ。authoritative truth として auto-exclude しない。
- 明らかな version family が推定でき、かつ強弱に差がある場合のみ、**弱い側の既存 included 参照**を `human_confirmation_required` に降格し、確認質問を追加する（stale / superseded と断言する auto-exclude はしない）。
- 推定できない・同点の場合は no-op。chunk id / doc id は発明しない。

**Product principle**: exclusion は断言、送信は予測。不確実な stale/version conflict は human review。

**Verification**:
- `src/services/strategistOrchestrator/__tests__/duplicateVersionGuard.test.ts`
- `orchestrator.test.ts` の cross-batch old/new fixture

## Related Non-review Follow-ups

以下は review finding ではないが、P1-F production smoke 前に同じ流れで確認する。

- Cloud Tasks `dispatchDeadline` と Cloud Run timeout が multi-batch job に耐えるか live config を確認する。
- Gemini quota / latency 監視を `docs/setup-gcp.md` または運用 docs に追記する。
- 給与計算シナリオをデブサーバーで再実行し、truncation 警告ゼロと bundle 内容を evidence 化する。
- Stage 3 として `purposeTerms` の CJK bigram 対応を検討する。

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

## Remaining Review Findings

### P1-F-FU-1: Cross-document stale / superseded decision

**Problem**: 旧版・新版・改訂版などの関連文書が別 batch に分かれると、batch 内 strategist は相互比較できない。現在の included / excluded union は決定論的だが、「旧版を stale として落とす」「新版を優先する」という判断が batch 境界をまたいで必要な場合に弱い。

**Why it matters**: Context Package は「使える情報」と「除外すべき情報」を区別するプロダクトなので、古い資料を included に残すと downstream AI の信頼性を落とす。

**Candidate approaches**:
- Batch 前に related document grouping を作り、同じ topic / version family は同じ batch に寄せる。
- Batch 後に included / excluded の cross-document reduce pass を追加し、stale / superseded の再判定だけを行う。
- First step として、file name / doc title / freshness metadata から明らかな version family を作る決定論 heuristic を評価する。

**Done**:
- 旧版・新版が別 batch に分かれる fixture test を追加する。
- 新版が included、旧版が excluded または human-review になる。
- reduce / grouping が新しい chunk id を発明しないことを検証する。

### P1-F-FU-2: Budget admission predicate unification

**Problem**: `budget.ts` と `batching.ts` が、chunk admission / budget guard に近い判定を別々に持っている。現状はテストで守っているが、将来片方だけ変わると sync budget と async batch の境界条件がずれる。

**Why it matters**: sync route は budget truncation、async route は batch full coverage という役割分担なので、同じ input budget contract を共有していないと「同期では落ちるが非同期 batch では単発 Vertex limit を超える」などの事故が起きる。

**Candidate approaches**:
- `StrategistInputBudgetConfig` を使う admission helper を `budget.ts` から切り出す。
- `applyStrategistInputBudget` と `partitionStrategistBatches` が同じ helper を呼ぶようにする。
- 既存の budget / batching tests に shared contract test を追加する。

**Done**:
- admission helper が単一化される。
- sync budget と async batch が同じ `maxDocuments` / `maxChunks` / `maxTotalPromptChars` / `maxCharsPerChunk` 解釈を使う。
- 既存の P1-F batching tests と budget tests が通る。

## Related Non-review Follow-ups

以下は review finding ではないが、P1-F production smoke 前に同じ流れで確認する。

- Cloud Tasks `dispatchDeadline` と Cloud Run timeout が multi-batch job に耐えるか live config を確認する。
- Gemini quota / latency 監視を `docs/setup-gcp.md` または運用 docs に追記する。
- 給与計算シナリオをデブサーバーで再実行し、truncation 警告ゼロと bundle 内容を evidence 化する。
- Stage 3 として `purposeTerms` の CJK bigram 対応を検討する。

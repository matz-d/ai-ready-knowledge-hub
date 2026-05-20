# Phase 3-H-2 方向性メモ: official-doc-pdf の薄い本線統合と Eval 育成

> 作成: 2026-05-19
> 背景: Phase 3-H Priority 1（`poc/document-conversion/official-doc-pdf/` での PoC 縦串確立）が完了した。subtype 1 の first-choice 変換器（`pdf-parse`）と MarkItDown の比較で、subtype 1 は `pdf-parse` 一択であることが確認できた（MarkItDown は表認識ゼロ、ブロック数が極端に膨らむ）。Phase 3-H-2 では、この subtype 1 のみを **Firestore feature flag で gating した薄い本線統合** として PDF → Curator まで通し、観測データを使って health / heuristic / golden の 3 段成熟度を育成する。

## 変更履歴

- **2026-05-19 (v1)**: 初版。`D-P3-H-3`（subtype 1 薄い本線統合の高レベル方針）の「未決事項（継続）」を `D-P3-H-4`（M1 初期判断）で埋め、実装方針として正本化した。`D-P3-H-2`（subtype 起点組み直し）にも整合。

---

## 1. ゴール

Phase 3-H-2 では `official-doc-pdf` を **薄い本線統合 + Eval 育成ループ** として完成度を上げる。観測データ蓄積（M2）が heuristic 閾値抽出（M3）の材料を作り、heuristic 閾値が次の本線統合の安全網になる、というループを立ち上げることが本フェーズの本質。

**Phase 3-H-2 の一行定義:**

> `official-doc-pdf` を Firestore feature flag で gating した薄い本線統合として PDF → Curator まで通し、DocumentIR を GCS、ConversionEvalResult を Firestore に永続化することで、health / heuristic / golden の 3 段成熟度を **実データから育成する** ループを立ち上げる。

**M1 境界の正確な言い換え:**

> 「PDF を本線に入れる」ではなく、**「PDF を Curator 判定まで本線に入れ、`aiUsePolicy === 'direct'` の PDF だけ chunk 化する」**。`requires_masking` / `blocked` の PDF は `documents/{docId}.status = 'curated'` で停止し、`maskingPending: true` フラグだけ立てる。

---

## 2. なぜ Phase 3-H-2 を進めるか（Priority 1 完了後の前提）

Phase 3-H Priority 1 で次が揃った:

- `src/eval/conversion/` に `DocumentIR` / `ConversionEvalResult` / `documentIrToKnowledgeChunks` の本線品質の型・実装。
- `poc/document-conversion/official-doc-pdf/` で `pdf-parse` vs MarkItDown の比較結果。subtype 1 は `pdf-parse` 一択。
- `sample-data/document-conversion/{official-doc-pdf,slide-pdf,scan-pdf}/` に出典・ライセンス・PII 表付きで fixture 6 件配置済み。
- `pnpm test` 345 件 pass（Phase 3-E 完了時 298 件から +47 件）。

ただし `grep DocumentIr src/app src/lib` は 0 hit で、**本線への配線はまだ無い**。これは Priority 1 の設計通りであり、Phase 3-H-2 の入り口がここ。

PoC の成果物（adapter / eval scaffold）が **本物の PDF バイトを通った経験が無い**（unit test のみ）ことが、薄い本線統合を急がない場合のリスク。Phase 3-H-2 で実バイトを流して、想定外の挙動を観測の段階で潰す。

---

## 3. 確定済み事項

高レベル方針は `D-P3-H-3` で「subtype 1 を feature flag 付きで薄く本線統合する」が確定済み。本フェーズはその「未決事項（継続）」を `D-P3-H-4` で具体化したもの。

| 論点 | 決定 | 出典 |
|---|---|---|
| 高レベル方針: 評価完成前に subtype 1 を本線統合するか | する。subtype 1 のみ、段階的有効化 | `D-P3-H-3 Q1` |
| 高レベル方針: 統合方式 | `official-doc-pdf` 判定時のみ DocumentIR + adapter、health gate 必須、fail-closed | `D-P3-H-3 Q2` |
| Q1: feature flag の粒度 | Firestore `feature_flags` collection、allow-list ベース、`expiresAt?` を schema に含める | `D-P3-H-4 Q1` |
| Q2: DocumentIR snapshot の保存先 | GCS `raw/{docId}/document-ir/v1.json` | `D-P3-H-4 Q2` |
| Q3: ConversionEvalResult の保存先 | Firestore `conversion_eval/{evalId}` collection（append-only） | `D-P3-H-4 Q3` |
| Q4: M1 のスコープ | PDF 受理 + Curator まで。`aiUsePolicy === 'direct'` のみ chunk 化。Masker 統合は含めない | `D-P3-H-4 Q4` |
| Q5: `requires_masking` / `blocked` PDF の扱い | `documents/{docId}.status = 'curated'` で停止し、`maskingPending: true` フラグを立てる。新 status は導入しない | `D-P3-H-4 Q5` |
| Q6: PII 入り fixture の観測経路 | M1〜M3 の本線観測には乗らない。Curator が `requires_masking` を返すため。PoC compare runner で継続観測する | `D-P3-H-4 Q6` |

`D-P3-H-3` で「後続で確定する項目」とされた次の 3 点は、本フェーズの M3 / M4 / M5 完了時に別の決定エントリで埋める。

- heuristic gate の閾値（`coverage` / `locator_quality` / `safety_readiness`）→ M3 完了時
- golden fixture の expected fields と recall 判定 → M4 完了時
- feature flag の公開範囲拡大条件 → M5 完了時（Phase 3-H-3 着手判断の前提）

---

## 4. M1: 薄い本線統合

### 4.1 ゴール

`/api/documents` が feature flag ON の tenant に対し `application/pdf` を受理し、`pdf-parse` → `DocumentIR` → `documentIrToKnowledgeChunks` を駆動する。`aiUsePolicy === 'direct'` の PDF のみ chunk 化し Firestore に書く。

### 4.2 スコープ

| やる | やらない |
|---|---|
| Firestore `feature_flags` collection 新設、`pdf-conversion-subtype-1` flag を dev tenant 先行 ON | 全 tenant ON / public exposure |
| `pdfDocumentExtractor.ts`（`src/lib/extractors/`）追加 | OCR / Vertex AI 呼出（subtype 2/3 用、Phase 3-H-3） |
| `uploadOrchestrator` に PDF 分岐追加。既存 status 遷移 `uploaded → curating → curated` を踏襲 | 新 status の導入 |
| `documents/{docId}.sourceSubtype` optional field 追加 | Firestore `schemaVersion` の bump（後方互換維持） |
| `aiUsePolicy === 'direct'` の PDF のみ chunk 化 | `requires_masking` / `blocked` PDF の chunk 化（KnowledgeChunk invariant rule 3 と衝突するため） |
| DocumentIR snapshot を GCS `raw/{docId}/document-ir/v1.json` に保存 | DocumentIR を Firestore inline 保存 |
| `maskingPending: true` フラグ追加（`requires_masking` PDF 用） | UI / API での「Masker 待ち」状態の表示（Phase 3-H-2 後半 or 3-H-3） |

### 4.3 触るファイル

```
新規:
  src/lib/featureFlags.ts                     ← Firestore feature_flags reader
  src/lib/__tests__/featureFlags.test.ts
  src/lib/extractors/pdfDocumentExtractor.ts  ← PDF → DocumentIR (本線品質)
  src/lib/extractors/__tests__/pdfDocumentExtractor.test.ts
  src/lib/documentIrStorage.ts                ← GCS raw/{docId}/document-ir/v1.json read/write
  src/lib/__tests__/documentIrStorage.test.ts

修正:
  src/app/api/documents/route.ts              ← PDF MIME 許可（flag ON 時）
  src/lib/uploadOrchestrator.ts               ← PDF 分岐、aiUsePolicy 'direct' のみ chunk 化、
                                                 requires_masking 時は maskingPending: true
  src/lib/firestoreSchema.ts                  ← sourceSubtype / maskingPending optional 追加
  firestore.indexes.json                       ← feature_flags index 追記
  firestore.rules                              ← feature_flags collection 読み取りルール
```

### 4.4 Feature flag schema（判断 1 = C: Allow-list + expiry）

`src/lib/featureFlags.ts` に Zod schema を定義する:

```ts
// 概念形（Phase 3-H-2 M1 で確定実装する）
type FeatureFlag = {
  flagId: 'pdf-conversion-subtype-1' | string; // 命名規約は M1 で確定
  defaultEnabled: boolean;                     // 全 tenant への既定値
  enabledTenants: string[];                    // tenant id allow-list（IAP email domain 由来）
  expiresAt?: string;                          // ISO8601。optional だが PoC flag に必須運用する
  description: string;                         // 何のための flag か
  createdAt: string;
  updatedAt: string;
};
```

- `enabledTenants` は IAP email domain 由来（`D-P3-D` に整合）。
- `expiresAt` は schema には optional で入れるが、**Phase 3-H-2 中の運用ルールとして PoC flag には必須記入** とする（永続化事故防止）。
- Reader は per-request cache 推奨。Firestore read が増えすぎないように。

### 4.5 KnowledgeChunk invariant rule 3 との衝突点（重要）

`src/lib/knowledgeChunkSchema.ts` L172-179 で次が強制されている:

```
When aiUsePolicy is requires_masking, maskedText must be present and non-empty.
```

M1 では Masker を統合しないため、Curator が `requires_masking` を返した PDF の chunk を作ると **invariant 違反になる**。これを避けるため:

1. `aiUsePolicy === 'direct'` の PDF のみ chunk 化する
2. `aiUsePolicy === 'requires_masking'` の PDF は `documents/{docId}.status = 'curated'` で停止
3. `documents/{docId}.maskingPending = true` を立てて「解析済みだが Masker 待ち」を表現
4. `aiUsePolicy === 'blocked'` は既存挙動と同じ（chunk 無し）

これは既存 text/csv/xlsx パイプラインの「Masker 経由でないと chunk 化しない」挙動と整合する。

### 4.6 観測対象から外れる fixture（M2 以降への影響）

`synthetic-employment-context-with-pii.pdf` は合成 PII を含むため、Curator が `requires_masking` を返す可能性が高い。M1 の制約により **本線では chunk 化されず、M2 観測ログにも入らない**。

そのため:

- M1〜M3 の本線観測データは「Curator が `direct` と判定した公的文書」が中心になる
- `safety_readiness` の本格評価は Masker 本線統合後（Phase 3-H-2 後半か Phase 3-H-3）
- PII 入り fixture は引き続き `poc/document-conversion/official-doc-pdf/compare/runCompare.ts` で観測する（PoC 経路）

---

## 5. M2: 観測データ蓄積

### 5.1 ゴール

M1 を通過した変換ごとに `ConversionEvalResult`（health stage）を Firestore `conversion_eval/{evalId}` に append し、`documents/{docId}` から最新 evalId を辿れるようにする。

### 5.2 スコープ

| 項目 | 内容 |
|---|---|
| `conversion_eval/{evalId}` collection | append-only。`evalId` は `docId:revisionId` 形式を初期案にする |
| Reverse pointer | `documents/{docId}.latestConversionEvalId?` optional |
| AuditEvent 拡張 | `document.convert` action 追加。`converterId` / `sourceSubtype` / `evalStatus` を含む。`inferenceDestination` field は Phase 3-H-3 用に予約（未値） |
| 観測対象 | fixture 4 件（`direct` 判定の 3 件）+ dev tenant の任意 PDF upload |
| ダッシュボード | 作らない。Firestore Console + 簡易 export script で十分 |

### 5.3 触るファイル

```
新規:
  src/lib/conversionEvalStorage.ts            ← Firestore conversion_eval read/write
  src/lib/__tests__/conversionEvalStorage.test.ts
  scripts/exportConversionEvalSamples.ts      ← 観測データを JSON で吐く（M3 用）

修正:
  src/lib/audit/auditEvent.ts                 ← document.convert action 追加
  src/lib/uploadOrchestrator.ts               ← eval 結果を保存
  firestore.indexes.json                       ← conversion_eval index 追記
  firestore.rules                              ← conversion_eval 読み取りルール
```

---

## 6. M3: Heuristic 閾値抽出

### 6.1 ゴール

M2 で集めた分布から subtype-1 の `coverage` / `locator_quality` / `context_package_readiness` / `safety_readiness` の閾値関数を実装し、`evalSafetyReadiness('heuristic')` を Cloud DLP に接続する。

### 6.2 スコープ

| 軸 | やること |
|---|---|
| `coverage.pageCoverage` | M2-D 実測 2 件はいずれも `1.0`。初期閾値は `>= 1.0` pass、`>= 0.75` warn、`< 0.75` fail（非ブロッカー） |
| `coverage.tableCandidates` | M2-D 実測は `78` / `116`。文書種別差が大きいため閾値は設けず観測のみ。`textDensityWarnings` で異常を拾う |
| `locator_quality.has*` | M2-D 実測はいずれも `hasPageLocators=true` / `hasTableLocators=true`。`hasPageLocators === true` 必須、`hasTableLocators` は warning のみ |
| `context_package_readiness.oversizedChunks` | M2-D 実測はいずれも `0`。`=== 0` 必須（既存実装に近い） |
| `safety_readiness.maskableChunkRate` | DLP 実測は `0.0714` / `0.2442`。公開文書では「PII finding が載った chunk 比率」に引っ張られるため、M3-C では blocker / warn 閾値に使わず観測値として保持（初期下限 `0`） |
| `safety_readiness.unmaskablePiiFindings` | DLP 実測はいずれも `0`。`=== 0` 必須。DLP detected かつ chunk が `imageText` / locator 無し / chunk 境界跨ぎの場合をカウント |
| コスト管理 | DLP 呼出は per-eval throttling。本線 Masker 統合とは別予算枠で観測 |

### 6.3 触るファイル

```
新規:
  src/eval/conversion/heuristic/evalCoverage.ts
  src/eval/conversion/heuristic/evalLocatorQuality.ts
  src/eval/conversion/heuristic/evalContextPackageReadiness.ts
  src/eval/conversion/heuristic/evalSafetyReadinessHeuristic.ts
  src/eval/conversion/heuristic/__tests__/

修正:
  src/eval/conversion/evalSafetyReadiness.ts  ← heuristic stage 実装、DLP bridge
  src/eval/conversion/runConversionEvalHealthCheck.ts → 名前再考（runner 全体の進化）
```

### 6.4 PoC 側との関係

`poc/document-conversion/official-doc-pdf/eval/enrichEvalMetrics.ts` で先に書いた coverage / locatorQuality 計算ロジックは、M3 で `src/eval/conversion/heuristic/` に昇格させる。PoC 側は削除しないが、本線実装を re-export する形に薄くする。

---

## 7. M4: Golden eval 雛形

### 7.1 ゴール

公的文書 fixture に `*.expected.json` を併置し、`semanticRetention.keyFieldRecall` / `missingExpectedFields` を実装する。

### 7.2 スコープ

| 項目 | 内容 |
|---|---|
| `sample-data/document-conversion/official-doc-pdf/*.expected.json` | 4 fixture 分作成。fixture 名 + `.expected.json` |
| 期待フィールド粒度 | 様式名 / 適用年 / 章タイトル / 表の主要セル / 記入欄ラベル / 重要金額・日付 |
| `evalSemanticRetention` 実装 | `missingExpectedFields` を chunks 連結テキストの substring match で算出。`keyFieldRecall` は `(found / expected)` |
| 月次レビュー手順 | [docs/phase-3-h-2-monthly-review.md](phase-3-h-2-monthly-review.md)（golden 手動 trigger → recall 表 → 期待値ドリフトレビュー → `expected.json` 更新 PR。CI からは呼ばない） |

### 7.3 PII 入り fixture の golden

`synthetic-employment-context-with-pii.pdf` の `expected.json` には **マスク後に残るべき非 PII 重要情報** を入れる。PII 自体の検出 recall は `safetyReadiness.piiDetectionRecall`（M3 で実装）の責務。

---

## 8. M5: CI gate 接続

### 8.1 ゴール

GitHub Actions に conversion eval を組み込み、health gate を必須、heuristic を warning gate、golden を手動 + 月次にする。

### 8.2 スコープ

| Stage | CI 扱い | 失敗時 |
|---|---|---|
| health | 必須 gate | PR block |
| heuristic | warning gate | PR コメント、block しない |
| golden | 手動 trigger + 月次 | レビュー対象、block しない |

### 8.3 触るファイル

```
新規:
  .github/workflows/conversion-eval.yml
  scripts/runConversionEvalForCi.ts

修正:
  既存 deploy workflow に依存ジョブ追加（block にしない形）
```

---

## 9. M6: Phase 3-H-3 引き継ぎ

### 9.1 ゴール

slide-pdf / scan-pdf を本線統合する時の足場（Vertex AI 呼出 → AuditEvent `inferenceDestination` 拡張）を docs として固定し、[docs/phase-3-h-3-direction.md](phase-3-h-3-direction.md) と `D-P3-H-6` ドラフトを起こす。

### 9.2 スコープ

| 項目 | 内容 |
|---|---|
| `docs/phase-3-h-3-direction.md` 新設 | slide-pdf / scan-pdf 本線統合方針 |
| AuditEvent `inferenceDestination` 拡張仕様 | Phase 3-E §6.1 `ProcessingRecord` との接続点を明示 |
| feature flag 命名 | `pdf-conversion-subtype-2` / `pdf-conversion-subtype-3`（subtype 1 命名規約踏襲） |
| 後送り検討 | Masker 本線統合のタイミング（3-H-3 内か別フェーズか） |

---

## 10. やらないこと（Phase 3-H-2 全体）

| 範囲外 | 移送先 |
|---|---|
| slide-pdf / scan-pdf の本線統合 | Phase 3-H-3 |
| Vertex AI Gemini 呼出を upload pipeline に乗せる | Phase 3-H-3（subtype 2/3 で必要時） |
| Masker 本線統合（PDF 経路） | Phase 3-H-2 後半 or Phase 3-H-3 |
| BigQuery write-once audit | Phase 4 |
| Customer-managed / BYOC | Phase 4 |
| `cloud-sanitized-ingress` の PDF 対応 | Phase 3-G |
| DLP custom dictionary（顧客名・支店名） | 後続未決（`docs/open-questions.md`） |
| 新 status の導入（`pending_masking` 等） | `D-P3-H-4 Q5` で不採用 |

---

## 11. KnowledgeChunk invariant rule 3 衝突点の正本記載

> `src/lib/knowledgeChunkSchema.ts` L172-179: `aiUsePolicy === 'requires_masking'` の chunk は `maskedText` 非空必須。

Phase 3-H-2 M1 では Masker を本線統合しないため、Curator が `requires_masking` を返した PDF の chunk を作ると invariant 違反になる。回避策:

| Curator 返り値 | M1 挙動 |
|---|---|
| `direct` | chunk 化、`documents/{docId}.status = 'curated'`、`maskingPending: false` |
| `requires_masking` | chunk **化しない**、`status = 'curated'`、`maskingPending: true`、DocumentIR は GCS に保存（後で Masker 適用時に再 chunk 化可能） |
| `blocked` | chunk 化しない、`status = 'blocked'`（既存挙動と同じ）、`maskingPending` は立てない |

DocumentIR を GCS に保存する設計（判断 2）が、ここで効く。Masker 統合後に再 chunk 化する時、PDF を再解析する必要がなくなる。

---

## 12. DoD

Phase 3-H-2 全体は次を満たしたら完了とする。

- M1: `/api/documents` が feature flag ON の tenant 向けに PDF を受理し、`direct` 判定 PDF の chunk が Firestore に届く。`requires_masking` PDF は `curated` + `maskingPending: true` で停止する。
- M1: DocumentIR snapshot が GCS `raw/{docId}/document-ir/v1.json` に保存される。
- M1: `feature_flags/pdf-conversion-subtype-1` が dev tenant 先行で ON、それ以外 OFF。
- M2: `conversion_eval/{evalId}` に health stage 結果が append され、`documents/{docId}.latestConversionEvalId` から辿れる。
- M2: AuditEvent `document.convert` action が記録される。
- M3: subtype-1 の heuristic 閾値関数が実装され、`evalSafetyReadiness('heuristic')` が DLP を呼んで `maskableChunkRate` / `unmaskablePiiFindings` を算出する。
- M4: 4 fixture 分の `*.expected.json` が配置され、`semanticRetention.keyFieldRecall` / `missingExpectedFields` が算出される。
- M5: GitHub Actions に conversion eval ジョブが追加され、health gate が必須化される。
- M6: `docs/phase-3-h-3-direction.md` が起こされ、AuditEvent `inferenceDestination` 拡張仕様が固定される。
- `pnpm test` / `pnpm typecheck` / `pnpm build` がすべて通過する。
- 新規依存導入が CLAUDE.md `minimumReleaseAge: 4320` に違反していない。

---

## 関連ドキュメント

- [docs/phase-3-h-direction.md](phase-3-h-direction.md) — Phase 3-H Document Conversion PoC 方針（subtype 起点）
- [docs/phase-3-e-direction.md](phase-3-e-direction.md) — Document Conversion Eval 契約（6 軸 / 3 段階成熟度 / ロールアップ案B）
- [docs/phase-3-d-direction.md](phase-3-d-direction.md) — CI/CD + IAP + AuditEvent の正本
- [docs/decisions.md](decisions.md) — `D-P3-H` / `D-P3-H-2` / `D-P3-H-3` / `D-P3-H-4` / `D-P3-H-6`
- [docs/phase-3-h-3-direction.md](phase-3-h-3-direction.md) — Phase 3-H-3 subtype 2/3 足場（§9 引き継ぎ先）
- [docs/open-questions.md](open-questions.md) — Document Conversion Eval 関連の未決
- [docs/phase-3-h-2-monthly-review.md](phase-3-h-2-monthly-review.md) — Golden eval 月次レビュー手順（M5-A 手動 trigger）
- [docs/firestore-schema.md](firestore-schema.md) — Firestore document shape の正本
- [docs/architecture.md](architecture.md) — Upload pipeline / Masker pipeline 構造

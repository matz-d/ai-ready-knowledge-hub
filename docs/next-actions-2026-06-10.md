# Next Actions — 2026-06-10（2026-06-18 同期）

**目的**: Phase 4-UX / delivery E2E / UI refresh 後の次アクションを、提出前に効く順へ並べ直す。古い open questions は背景として残し、本書を直近の作業順の正本にする。

**前提**:
- Phase 4-UX MVP、async Context Package job、Production Hardening、delivery E2E は実装・検証済み。
- NotebookLM では単一 `.md` より **source 分割 bundle** が正しい渡し方だと実証済み。`exportContextPackageSourceBundle()` と UI zip 導線（P1-A/B）は実装済み。
- dashboard refresh で不要 UI/CSS の残りが見つかっているが、機能ブロッカーではない。
- P1-E first slice（PR #37-#41）で T1 preflight / row-window / page-group・table-manifest、T2 table fail-soft・scan visual table fallback、T3 label/value enrichment、scan OCR prompt guard + live drift workflow まで完了。
- 2026-06-13 の P1-D 実測で、born-digital official-doc-pdf（`pdf-parse` 経路）の field recall / table cell recall / locator が最弱領域だと判明。P1-E2 compare で hybrid table-assist を採用候補と判定済み。
- **2026-06-16**: P1-E Step 1 mainline wiring（D 戦略）完了。同期 upload は `tableAssistMode: 'disabled'`、gated 実行は `pdf-table-assist` flag + `tableAssistMode: 'async'` のみ（reprocess API / harness）。multi-file upload UI（最大 20 件キュー）完了。table-assist product reprocess（`POST /api/documents/:docId/table-assist`）完了。
- **2026-06-17**: P1-E Step 2 async ingest worker（PR #53）完了。official-doc-pdf upload 後の Cloud Tasks enqueue + worker `POST /api/documents/:docId/table-assist/run`。upload は同期完了のまま、enqueue は best-effort。`reprocessPdfWithTableAssist` を worker と共有。
- **2026-06-18**: table-assist async ingest production live smoke 完了（fresh PDF upload → worker 200 → queue empty、`health/pass`）。`/upload` multi-file queue も 10 files live smoke 完了。証跡は [table-assist-async-ingest-live-smoke-2026-06-18.md](table-assist-async-ingest-live-smoke-2026-06-18.md) / [upload-multi-file-live-smoke-2026-06-18.md](upload-multi-file-live-smoke-2026-06-18.md)。
- **2026-06-18**: P1-E+ scan-pdf golden sidecar refresh の false-green 経路を封鎖。`--refresh-expected` が curated `expectedFieldTiers`/`expectedValues`/`expectedTableCells` を黙って落とす挙動を `assertScanPdfExpectedRefreshDoesNotWeaken`（append-only guard）+ 回帰テストで塞ぎ、public blank-form は `preserve-reviewed`、synthetic は `append-live-fields` policy で現行 OCR に refresh。full live 3-run は `majorDriftCount` `3 → 0` で green。その後、NTA / MHLW / invoice の targeted product-quality follow-up も deterministic adapter 改善で実施済み。判断 [D-P1-E-PLUS-1](decisions.md)、証跡 [p1-e-plus-scan-pdf-quality-floor-2026-06-18.md](p1-e-plus-scan-pdf-quality-floor-2026-06-18.md)。

## 優先順位

| Priority | テーマ | 目的 | いまの状態 | Done |
|---|---|---|---|---|
| P0 | Phase 4-UX ブラウザ手動通し | README の「手動通し待ち」を潰し、提出前 evidence を作る | 完了。local synchronous UX は copy/download まで確認済み。async polling は Cloud Tasks / production smoke scope | [docs/phase-4-ux-manual-pass-2026-06-10.md](archive/phase-4-ux-manual-pass-2026-06-10.md) と `docs/phase-4-ux-evidence/2026-06-10/` に保存 |
| P1-A | NotebookLM source bundle API payload | 実証済みの勝ち筋を app の result payload に載せる | 完了。API result に `sourceBundle.files` を含め、excluded / human-review 本文が混入しないテストを固定済み | Context Package result に `sourceBundle.files` が含まれ、excluded / human-review 本文が混入しないテストが通る |
| P1-B | NotebookLM source bundle zip UI | P1-A の payload をユーザーが zip として落とせるようにする | 完了。`ContextPackageForm` に「NotebookLM 用 bundle をダウンロード」を追加。delivery E2E でも検証済み | `ContextPackageForm` に secondary export「NotebookLM用 bundle」を追加し、guide + included sources を zip download できる |
| P1-F | Async full-coverage strategist | async job が広い選択を実際に全件レビューできるようにする（**実行順は P1-C より先**） | 完了。Stage 2 本体実装済み。review 残タスクは [docs/p1-f-review-follow-up-tasks.md](p1-f-review-follow-up-tasks.md) に分離 | [docs/p1-f-full-coverage-strategist.md](p1-f-full-coverage-strategist.md) の Stage 2 Done 条件（batched strategist + missing/questions reduce、給与シナリオ再実行で truncation ゼロ） |
| P1-C | Demo / docs を bundle 前提へ更新 | デモの最後を product truth に合わせる | 完了。`docs/demo-scenario.md` と `docs/demo-runbook.md` を bundle 前提へ更新 | デモシナリオが「NotebookLM には source bundle を渡す」に更新される |
| P1-D | Extraction & Masking Quality Gate | 「安全に止める」だけでなく「止めすぎない」「構造化データ精度が十分」を示す | 完了（PR #35）。stable quality gate（schema v4、CI blocker）、live masker drift check（`piiLeakCount = 0`）、P1-E handoff doc。recall metrics は report-only。scan-pdf sidecar は raw OCR baseline のまま | curator over-restriction は live-only。stable `falseMaskedTokenCount` は sidecar hygiene check。P1-E へ table/locator/大容量症状を handoff 済み |
| P1-E | 大きなファイルの事前分割 / table fallback / locator enrichment | token limit failure を減らし、巨大 chunk / 表構造欠落 / label-value 分断を改善する | **first slice 完了**（PR #37-#41）。T1 preflight + row-window / page-group・table-manifest、T2 official-PDF table fail-soft + scan visual table fallback、T3 label/value enrichment、scan OCR prompt guard + `pnpm eval:scan-pdf:ocr-live-drift` workflow。証跡は [docs/p1-e-large-file-pre-splitting.md](p1-e-large-file-pre-splitting.md) §6、[docs/scan-pdf-ocr-live-drift-evidence-2026-06-13.md](scan-pdf-ocr-live-drift-evidence-2026-06-13.md)、[docs/scan-pdf-ocr-live-drift-evidence-pr41-2026-06-13.md](scan-pdf-ocr-live-drift-evidence-pr41-2026-06-13.md) | large table / PDF は sheet・row window・page-group / table-manifest で Curator 入力を bounded 化し Masker は全文を維持。P1-D handoff の employment-form / invoice scan は stable eval で改善確認済み |
| P1-E+ | scan-pdf quality floor / product-quality follow-up | PII prompt guard 後の accepted live drift floor を下げ、提出説明可能な品質証跡を固める | **drift floor + targeted product-quality follow-up 済み（2026-06-18、作業ツリー）**。refresh safety guard を land し、public blank-form は `preserve-reviewed`、synthetic は `append-live-fields` policy で現行 OCR に refresh。さらに invoice expected hygiene、MHLW inline unit fallback、NTA known public form template supplement を追加。MHLW / NTA / invoice は stable report-only metrics がすべて 1.0。global OCR prompt 強化は副作用ありで戻し、deterministic fallback に限定した（[D-P1-E-PLUS-1](decisions.md)） | **残**: full live all-fixture `--ci` は Vertex 429 で一度だけ全体完走できず。MHLW / NTA / invoice / unmaskable は同 run または focused run で green、429 の `synthetic-employment-form-scan` は focused retry green。PR で単一 full artifact が必要なら quota が静かな時間に再実行。証跡 [docs/p1-e-plus-scan-pdf-quality-floor-2026-06-18.md](p1-e-plus-scan-pdf-quality-floor-2026-06-18.md)、workflow 正本 [docs/scan-pdf-ocr-live-drift-workflow.md](scan-pdf-ocr-live-drift-workflow.md) |
| P1-E2 | born-digital PDF Gemini layout/table compare | official-doc-pdf の table / heading / locator 弱点を、Gemini layout/table enrichment で改善できるかを負債なく判定する | **実装・検証済み**。既存 compare harness に `gemini` / `pdf-parse+gemini-tables` arm を追加。page-group / table-only / grounding filter / hallucination-candidate check を実測。table-assist 専用 golden も追加済み | 採用判断: full Gemini 置換はしない。`pdf-parse` primary + grounded Gemini table-assist を PoC 最善とする。証跡は [docs/p1-e-large-file-pre-splitting.md](p1-e-large-file-pre-splitting.md) §6 |
| P1-E3 | table-assist mainline wiring + product reprocess + async ingest worker | compare 勝ち筋を本線 dispatcher に接続し、同期 upload では走らせない。opt-in reprocess と upload 後の async worker で gated 実行 | **完了（2026-06-18 live smoke 済み）**。Step 1（2026-06-16）: dispatcher + reprocess API + mainline harness。Step 2（PR #53）: `pdfTableAssistIngestEnqueuer`、worker route、`reprocessPdfWithTableAssist` 共有。production smoke は fresh PDF → worker 200 → queue empty | 同期 upload は `disabled` 固定。gated 実行は flag + `async` のみ（reprocess API / worker）。enqueue audit (#51) と cost guard (#52) は後続。正本: [docs/p1-e-large-file-pre-splitting.md](p1-e-large-file-pre-splitting.md) §6「2026-06-16」「2026-06-17」、[docs/decisions.md](decisions.md) `D-P1-E-TA-1` / `D-P1-E-TA-2`、[docs/table-assist-async-ingest-live-smoke-2026-06-18.md](table-assist-async-ingest-live-smoke-2026-06-18.md) |
| P1-ING1 | Multi-file upload UI | 散らばった資料を `/upload` から複数選択で投入できるようにする | **完了（2026-06-18 live smoke 済み）**。`UploadForm` + `uploadQueue.ts`（最大 20 件、`UPLOAD_CONCURRENCY=1`、失敗後も継続、per-file status）。本番 `/upload` で 10 files が 10/10 完了 | ディレクトリ一括 / zip 一括は未対応（P3 Ingest 判断）。現 smoke は「複数ファイル選択キュー」の検証であり、directory picker ではない。証跡: [docs/upload-multi-file-live-smoke-2026-06-18.md](upload-multi-file-live-smoke-2026-06-18.md) |
| P2 | Phase 3-F デモ polish | 動画シナリオを現状の product truth に合わせる | **完了**。`demo-scenario.md` / `demo-runbook.md` を multi-file upload、Dashboard / Pipeline Funnel、候補文書、生成前の安全確認、source bundle 前提に更新 | 動画カットとナレーションが現 UI / bundle 導線と一致する |
| P2 | 提出前の軽い運用補強 | 「まわす」説明力を上げる | **完了**。alert / sweeper / TTL に加え、UI submit 重複 guard と簡易 SLO を追記済み | `ContextPackageForm` の in-flight lock、`operate-deliver-readiness.md` §E |
| P3 | 不要 CSS / UI 残骸 cleanup | 保守性を上げ、次の UI 変更を軽くする | 旧 heatmap / risk-callout / status badge modifier / sensitivity 重複などが残る | 挙動変更なしで未使用 CSS と古い `inventory-demo-*` naming を整理 |
| P3 | Ingest 拡張判断 | 次の product expansion を決める | Drive folder bulk / local directory batch / standalone images が候補 | 提出前は Drive folder bulk か local directory batch のどちらかを選定。standalone images は OCR/PII/eval 設計が重いので後続寄り |

## P0: Phase 4-UX ブラウザ手動通し

**なぜ先か**: 実装済み機能の証跡化で、最短で README の残タスクを潰せる。バグが見つかった場合も、zip UI やデモ polish の前に直せる。

**通す流れ**:
1. `/context-package` を localhost または本番 IAP で開く。
2. purpose を入力する。
3. candidates API の結果を確認する。
4. 「候補を表示」で候補文書を確認し、生成前の安全確認を見る。
5. 生成前プレビューの確認チェックを見る。
6. async 生成に入り、polling `queued/running/succeeded` を確認する。
7. result を表示し、Markdown copy と download を確認する。

**記録先**:
- `docs/phase-4-ux-manual-pass-YYYY-MM-DD.md`
- スクショを残す場合は `docs/phase-4-ux-evidence/YYYY-MM-DD/`

**合格条件**:
- UI 操作だけで purpose 起点の生成が一巡する。
- restricted / needs review / missing / questions が UI 上で確認できる。
- async job が成功し、result の copy/download が動く。

## P1 分割方針

P1 は範囲が広いため、提出価値に直結する delivery 導線と、品質評価・大容量耐性を分けて進める。

1. **P1-A: source bundle API payload** — まず server result に source bundle を安全に含める。zip UI より先に、excluded / human-review 本文が payload に混ざらないことをテストで固定する。
2. **P1-B: source bundle zip UI** — P1-A の payload をブラウザで zip 化して download する。ここで UI と browser evidence を作る。
3. **P1-C: demo/docs update** — デモの最後を「NotebookLM には source bundle」に更新する。UI が入ってから短く閉じる。
4. **P1-D: Extraction & Masking Quality Gate** — safety / structure / over-mask の評価を切る。P1-A/B とは別の評価基盤作業として扱う。
5. **P1-E: large file pre-splitting / table fallback / locator enrichment** — first slice 完了（PR #37-#41）。残りは P1-E+ quality floor、P1-E2 born-digital Gemini compare、large mixed PDF qualitative follow-up。

## P1-A / P1-B: NotebookLM 用 source bundle zip UI

**実装方針**:
- 単一 `.md` は維持する。これは汎用 markdown / Gemini / RAG / copy 用の primary artifact。
- NotebookLM 向けには secondary export として「source bundle」を出す。
- source bundle の中身は `exportContextPackageSourceBundle(input)` の `files`:
  - `00-CONTEXT-PACKAGE-GUIDE.md`
  - included source files（本文のみ）
  - excluded / restricted / pending masking は source file として出さない。

**候補実装**:
- 公開3日以内の依存追加を避けるため、client zip は STORE method の最小 writer を自前実装する。
- 依存追加時は `pnpm` と `pnpm-workspace.yaml` の `minimumReleaseAge: 4320` を守る。
- 既存 API result は `markdown` だけなので、UI zip 化には次のどちらかが必要:
  - **P1-A の推奨**: API result に source bundle payload を追加する。
  - API result の元になる export input から bundle を server side で作り、result に files を含める。

**P1-A Done**:
- `buildContextPackageResponsePayload` 相当の result に `sourceBundle.files` を追加する。
- `sourceBundle.files` は `00-CONTEXT-PACKAGE-GUIDE.md` と included source files だけを含む。
- excluded / restricted / human-review / pending masking の本文が payload に入らないことを unit test で固定する。
- API payload サイズが過大になる場合の fallback 方針を記録する（P1-B 実装前に止める判断材料）。初期方針は、既存 async result offload と同じく job result 全体の GCS offload を使う。同期 route で payload 過大が見えた場合は、source bundle だけを別 endpoint / GCS object に逃がす設計へ切り替える。

**P1-B Done**:
- `ContextPackageForm` の result panel に「NotebookLM用 bundle をダウンロード」を追加。
- zip 内ファイル名が sanitize / dedupe される。
- excluded / human-review 文書の本文が zip に含まれないことをテストする。
- Chrome または in-app browser + filesystem 確認で zip download を検証する。

**P1-C Done**:
- `docs/demo-scenario.md` の Export シーンを bundle 前提へ更新する。
- 単一 `.md` は汎用 artifact、NotebookLM は source bundle という説明に揃える。

## P1-D: Extraction & Masking Quality Gate

**狙い**: UI polish よりも、「AI に渡してよい Context Package の品質」を示す。安全側に倒すだけではなく、公開文書を過剰に止めないこと、重要項目が `DocumentIR` / `KnowledgeChunk` として正しく構造化されること、大きめ/混在資料で壊れないことを測る。

**この Gate に含める構造化データ精度チェック**:
- 重要項目が抽出されているか（field recall）
- 値が正しい粒度で保持されているか（value precision）
- 表の行・列・セル関係が壊れていないか（table structure / cell recall）
- ページ・表・行などの根拠 locator を追えるか（locator coverage）
- Context Package にしたとき、下流 QA で正答できるか（task-level correctness）

### 1. 公開文書 over-mask eval

**Fixture 候補**:
- 厚労省 / 国税庁 / 年金機構などの空欄様式
- モデル規程、公開ガイド、テンプレート

**期待値**:
- `Public/direct`
- `[REDACTED:*]` が増えない
- Context Package に採用可能

**Metrics**:
- `publicDirectRate`
- `falseMaskedTokenCount`
- `overRestrictedCount`

### 2. 日本式公的文書 structured key-field eval

**例**: 労働条件通知書
- 契約期間
- 就業場所
- 業務内容
- 始業終業
- 賃金
- 退職
- 社会保険

**Metrics**:
- key field recall
- value precision
- table cell recall
- locator coverage

**注意**: 単純 substring だけでは甘い。項目ごとに `present / value / page locator / table row` を見る。既存 `semanticRetention` の substring recall は入口として使えるが、構造化データ精度の合格判定は `DocumentIR` block、`KnowledgeChunk` text / structureType / locator、表セル単位の保持を確認する。

### 3. 大きめ・混在資料 eval

**ケース**:
- near-limit PDF
- 表多め PDF
- 画像化 PDF
- テキスト + 表 + 画像混在 PDF
- 複数 sheet XLSX
- 大きめ CSV

**Metrics**:
- conversion success rate
- page / sheet 欠落
- empty chunk
- 巨大 chunk
- 処理時間
- DocumentIR / KnowledgeChunk の構造保持率
- Context Package QA 正答率

### 4. 下流 QA eval

**質問例**:
- 料金
- 期限
- 提出書類
- 対象者
- 除外された旧版を使わない

**位置づけ**: NotebookLM E2E の 5問テストを、変換精度・抽出精度の評価にも拡張する。

## P1-E: 大きなファイルの事前分割 / table fallback / locator enrichment

**first slice 完了**（PR #37-#41）:
- **T1**: CSV / XLSX / official PDF preflight + large-table row-window chunking。large PDF / table は page-group / table-manifest で Curator 入力を bounded 化（Masker は全文維持、`requires_masking` fail-closed）。
- **T2**: official-PDF `getTable()` fail-soft。scan-pdf visual table fallback（`image_text` 行から table chunk 合成）。
- **T3**: scan-pdf label/value enrichment（同一行の隣接 value を label chunk へ複製、`scanLabelValueLink` 記録）。
- **scan OCR**: prompt PII guard + `pnpm eval:scan-pdf:ocr-live-drift` workflow。PR #41 で live drift evidence 付き。

**残タスク（P1-E+ quality floor / product quality）**:
- **提出前判断**: ハッカソン本編デモでは scan-pdf を主役にしない限り着手しない。提出前は Context Package の判断 UX / source bundle / multi-file upload / NotebookLM 導線を優先する。
- **2026-06-18 進捗（[D-P1-E-PLUS-1](decisions.md)）**: refresh safety guard を land。`--refresh-expected` が curated `expectedFieldTiers`/`expectedValues`/`expectedTableCells` を黙って落とす false-green 経路を `assertScanPdfExpectedRefreshDoesNotWeaken`（append-only）+ 回帰テストで封鎖。public blank-form は `preserve-reviewed` policy で未レビュー OCR 文字列を expected に足さず、synthetic は `append-live-fields` policy で現行 OCR に refresh。full live 3-run は `majorDriftCount=0` で green。証跡 [docs/p1-e-plus-scan-pdf-quality-floor-2026-06-18.md](p1-e-plus-scan-pdf-quality-floor-2026-06-18.md)。
- PII direction / deterministic zero / extraction failures は green。full live `--ci` は **drift gate** として維持できる。ただし stable report-only metrics は低下しており、これは stale baseline を正直化した結果であって product extraction 改善ではない。
- **2026-06-18 follow-up**: product-quality の主要残（NTA table-cell / locator、MHLW `休憩時間 / 分`、synthetic invoice expected hygiene）は作業ツリー上で解消。MHLW / NTA / invoice の stable report-only metrics は all 1.0。global OCR prompt 強化は synthetic employment への副作用があったため戻し、MHLW inline unit fallback と NTA known public form template supplement の deterministic adapter 改善に限定した。
- 残る注意は live evidence の運用面のみ。full live all-fixture `--ci` は Vertex 429 で一度全体完走できなかったが、失敗 fixture は focused retry green。単一 full live artifact が必要なら quota が静かな時間に再実行する。
- 正本: [docs/scan-pdf-ocr-live-drift-workflow.md](scan-pdf-ocr-live-drift-workflow.md)、[docs/scan-pdf-ocr-live-drift-evidence-2026-06-13.md](scan-pdf-ocr-live-drift-evidence-2026-06-13.md)、[docs/p1-e-large-file-pre-splitting.md](p1-e-large-file-pre-splitting.md) §6 の review follow-ups。

**まだ scope 外**:
- large mixed PDF（local-only）の table extraction 根本改善。golden がないため table cell recall は測らず、committed official-doc-pdf 3件で Gemini 比較の定量判定を先に行う。
- non-amount 表への scan visual table fallback 拡張。
- `curatorInputMode` の structured Firestore 永続化。

## P1-E2: born-digital PDF Gemini layout/table compare

**なぜ次に見るか**:
- `tmp/p1d-quality-report-current.json` では、実文書寄りの born-digital official-doc-pdf 3件が field recall / table cell recall / locator の最弱領域。
- `valuePrecision = 1` なので、問題は「拾えた値の対応」ではなく、項目・表・根拠 locator を拾えないこと。
- scan/slide 側は Gemini 系経路で stable metric が高く、born-digital PDF に Gemini layout/table understanding を当てる仮説の限界効用が大きい。

**実装境界**:
- 同期 upload path では table-assist を発火しない（`tableAssistMode: 'disabled'` 明示）。
- compare harness の Gemini arms は PoC / eval-only（本線 product path とは別）。
- 新規 `scripts/runPdfGeminiComparison.ts` は作らない。
- 既存 `poc/document-conversion/official-doc-pdf/compare/runCompare.ts` の converter arm に `gemini` を足す。
- 既存の `runOfficialDocPipeline({ converter })`、`DocumentIR → KnowledgeChunk → eval`、`renderCompareReport` を再利用する。
- `GOOGLE_CLOUD_LOCATION=global` 前提。新しいコスト会計は作らず、既存 Gemini model / token cost 設定の流用を優先する。

**評価対象**:
- committed official-doc-pdf fixtures を先に対象にする。
- large mixed PDF (`local-data/annual-report-doc-2025-viewing-ja.pdf`) は後続の定性トラック。golden がないため table cell recall ではなく、`getTable()` 例外回避、表らしさ、hallucination 候補を確認する。

**採用基準**:
- table cell recall が `pdf-parse` より明確に改善する。
- field / core recall と locator coverage が改善する。
- value precision が落ちない。
- Gemini が出した値のうち、`pdf-parse` 全文に出現しないものを hallucination candidate として機械的に洗い出せる。
- 失敗時は `pdf-parse` baseline へ戻れる。

## P1-E3: table-assist mainline wiring + product reprocess + async ingest worker（完了 2026-06-17）

**なぜ D 戦略か**（`D-P1-E-TA-1`）:
- async document ingest worker のフル構築は context-package job 基盤相当になり、提出前スコープと競合する。
- 先に dispatcher 配線と opt-in reprocess を land し、同期 upload のレイテンシ・マスキング境界を守る。async トリガは Step 2（PR #53）で後続 land。

**Step 1 完了内容（2026-06-16）**:
- `pdfExtractionDispatcher` に `tableAssistMode: 'disabled' | 'async'` と `augmentOfficialDocWithTableAssist` を配線。
- 二重ゲート: tenant-scoped `pdf-table-assist` flag（default off）**かつ** `tableAssistMode: 'async'`。
- 同期 `POST /api/documents` は `tableAssistMode: 'disabled'` を明示。
- Product reprocess: `POST /api/documents/:docId/table-assist` → `reprocessPdfWithTableAssist`（lease、chunks / masked object 更新、fail-soft）。
- Masker 前段 merge 不変（WU-6a: `pdfTableAssistMaskingRegression.test.ts`）。
- Mainline harness 証跡: [docs/official-doc-table-assist-mainline-harness-2026-06-16.md](official-doc-table-assist-mainline-harness-2026-06-16.md)。

**Step 2 完了内容（PR #53、2026-06-17）**:
- `pdfTableAssistIngestEnqueuer`: official-doc-pdf upload 成功後、flag ON かつ restricted 以外なら Cloud Tasks を best-effort enqueue。queue / signing 未設定は upload 成功を壊さない。
- Worker: `POST /api/documents/:docId/table-assist/run` → `reprocessPdfWithTableAssist`（manual reprocess と同一 invariants）。
- Env: `PDF_TABLE_ASSIST_*` 優先、`CONTEXT_PACKAGE_*` fallback。dispatch deadline 600s。
- 決定ログ: [docs/decisions.md](decisions.md) `D-P1-E-TA-2`。

**Production live smoke（2026-06-18）**:
- Fresh `synthetic-official-doc-table-assist-golden.pdf` upload returned HTTP `200` and enqueued the worker.
- Cloud Tasks worker returned HTTP `200`; queue drained to empty; conversion eval `health/pass`.
- Cloud Run env is `FIRESTORE_PREFER_REST=false` and timeout `600s`; this avoids the prior Firestore REST serializer failure (`toProto3JSON: don't know how to convert value 2`) and aligns with table-assist dispatch deadline.
- Evidence: [docs/table-assist-async-ingest-live-smoke-2026-06-18.md](table-assist-async-ingest-live-smoke-2026-06-18.md)。

**後続 issue 候補**:
- [#51](https://github.com/matz-d/ai-ready-knowledge-hub/issues/51) table-assist enqueue audit: `document.convert` 実行結果だけでなく、「table-assist worker を enqueue した」事実を AuditEvent または dedicated operational event に載せる。
- [#52](https://github.com/matz-d/ai-ready-knowledge-hub/issues/52) table-assist cost guard: `pdf-table-assist` flag ON の official-doc-pdf 全件ではなく、table extraction summary / conversion eval を見て必要な文書だけ enqueue する。提出前は restricted 終端の enqueue skip までで十分。

**まだ scope 外**:
- Document detail UI からの table-assist ボタン（API / worker は利用可能）。
- post-terminal enrichment（terminal document / masked chunks への後付け merge）。
- upload API の 202 + polling や document ingest 全体の async 化（table-assist 専用 worker のみ land 済み）。

## P1-ING1: Multi-file upload UI（完了）

**完了内容**:
- `/upload` の `UploadForm` が複数ファイル選択キュー（`uploadQueue.ts`）。
- 最大 `MAX_UPLOAD_FILES=20`、`UPLOAD_CONCURRENCY=1`（Curator 同期 Gemini のため）。
- 1 ファイル失敗後も残りを継続。per-file status（待機中 / アップロード中 / 完了 / 失敗）と retry。
- サーバ ingest は 1 リクエスト = 1 ファイルのまま。table-assist は同期 upload では走らない。
- 2026-06-18 production live smoke: `sample-data/accounting-office/` 10 files を本番 `/upload` で複数選択し、10/10 完了。1 件は期待どおり `restricted`、残りは継続処理。証跡: [docs/upload-multi-file-live-smoke-2026-06-18.md](upload-multi-file-live-smoke-2026-06-18.md)。

**まだ scope 外**:
- ディレクトリ一括、zip 一括（P3 Ingest 判断）。

## P2: Phase 3-F デモ polish

**更新対象**: `docs/demo-scenario.md`, `docs/demo-runbook.md`

**完了内容**:
- Export は「NotebookLM には source bundle の全ファイルを source 追加」、単一 `.md` は Gemini / RAG / copy 用 primary artifact として説明。
- Dashboard refresh 後の画面構成に合わせ、旧 heatmap ではなく Pipeline Funnel / KPI / 文書一覧を見せる流れへ更新。
- `/upload` の multi-file キュー（最大 20 件、per-file status）をデモに反映。
- `/context-package` の purpose → 「候補を表示」→ 生成前の安全確認 → 生成前プレビュー → result panel の撮影順を runbook に追加。
- official-doc-pdf table-assist reprocess は任意カットとして分離し、本編では必須にしない。

## P2: 提出前の軽い運用補強

**enqueue 二重 submit**（完了）:
- 通常クリックは既存 disabled state、同一 tick の二重 submit は submit in-flight lock で `POST /api/context-package` が1回だけになるよう固定。
- Cloud Tasks enqueue は task name に `jobId` を使い、同一 job の重複 enqueue を抑止済み。
- network retry が同じ semantic request を別 job として作る問題は post-submit の request idempotency key 候補として残す。

**簡易 SLO**（完了）:
- `operate-deliver-readiness.md` §E に提出向けの最小 SLO / error budget を追記。
- dev tenant / 小規模運用の目標として、async accepted response p95、worker completion p95、job success rate、stale-running recovery、retention を定義。

## P3: 不要 CSS / UI 残骸 cleanup

**残っている候補**:
- old dashboard heatmap / insight / risk-callout CSS
- 未使用 status badge modifiers
- sensitivity color rules の重複
- pre-refresh header layout CSS
- `inventory-demo-*` naming

**方針**:
- 挙動変更なし。
- CSS 削除前後で `rg` と browser screenshot を確認。
- 提出前に余力があれば実施。ブロッカーではない。

## P3: Ingest 拡張判断

**提出前に実装するなら**:
1. Drive folder bulk
2. local directory batch

**後続寄り**:
- standalone images

**理由**:
- Drive folder bulk / local directory batch は「散らばった社内資料を集める」価値に直結する。
- standalone images は価値があるが、OCR・PII・eval・サイズ制御の設計が増えるため、Extraction & Masking Quality Gate 後が安全。

## 今すぐの推奨順

1. P1-A NotebookLM source bundle API payload を実装する。（完了）
2. P1-B NotebookLM source bundle zip UI を実装し、download evidence を取る。（完了。確認中に P1-F のバグが露出）
3. P1-F async full-coverage strategist を実装する（[docs/p1-f-full-coverage-strategist.md](p1-f-full-coverage-strategist.md)）。（完了。review 残タスクは [docs/p1-f-review-follow-up-tasks.md](p1-f-review-follow-up-tasks.md) に残す）
4. P1-C demo scenario を bundle 前提へ更新する。（完了）
5. P1-D Extraction & Masking Quality Gate の成熟化。（完了。PR #35、証跡は [docs/p1-d-evidence-2026-06-11.md](p1-d-evidence-2026-06-11.md)）
6. **P1-E** large file pre-splitting / table fallback / locator enrichment の first slice。（完了。PR #37-#41）
7. **P1-E+** scan-pdf quality floor 方針決定 + refresh safety guard land（2026-06-18）。（refresh の false-green 経路を封鎖し、public blank-form `preserve-reviewed` refresh まで実施。full live 3-run は `majorDriftCount=0`。targeted product-quality follow-up も作業ツリー上で完了。[D-P1-E-PLUS-1](decisions.md)）
8. **P1-E2** born-digital PDF Gemini layout/table compare を既存 compare ハーネスに追加する。（完了。full Gemini 置換は不採用、`pdf-parse` primary + grounded Gemini table-assist を採用候補）
9. **P1-E3** table-assist mainline wiring + product reprocess + async ingest worker。（完了 2026-06-17。Step 1: dispatcher / reprocess API。Step 2 PR #53: Cloud Tasks enqueue + worker route。同期 upload は disabled のまま）
10. **P1-ING1** multi-file upload UI。（完了。最大 20 件キュー、per-file `POST /api/documents`）
11. **P2** 提出補強: Phase 3-F デモ polish と enqueue / SLO。（完了）
12. **P1-E+ follow-up PR**: targeted product-quality follow-up 済み。必要なら quota が静かな時間に full live all-fixture `--ci` を再実行し、単一 artifact を追加する。
13. table-assist hardening: [#51](https://github.com/matz-d/ai-ready-knowledge-hub/issues/51) enqueue audit、[#52](https://github.com/matz-d/ai-ready-knowledge-hub/issues/52) cost guard。
14. P3 CSS cleanup と Ingest 拡張判断に進む。

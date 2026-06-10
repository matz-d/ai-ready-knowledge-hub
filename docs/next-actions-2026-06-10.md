# Next Actions — 2026-06-10

**目的**: Phase 4-UX / delivery E2E / UI refresh 後の次アクションを、提出前に効く順へ並べ直す。古い open questions は背景として残し、本書を直近の作業順の正本にする。

**前提**:
- Phase 4-UX MVP、async Context Package job、Production Hardening、delivery E2E は実装・検証済み。
- NotebookLM では単一 `.md` より **source 分割 bundle** が正しい渡し方だと実証済み。純関数 `exportContextPackageSourceBundle()` は実装済みで、UI zip 導線が未実装。
- dashboard refresh で不要 UI/CSS の残りが見つかっているが、機能ブロッカーではない。
- 大きな XLSX で Curator token limit failure が実データ上に見えており、大きめ/混在資料への耐性は次の品質テーマ。

## 優先順位

| Priority | テーマ | 目的 | いまの状態 | Done |
|---|---|---|---|---|
| P0 | Phase 4-UX ブラウザ手動通し | README の「手動通し待ち」を潰し、提出前 evidence を作る | 完了。local synchronous UX は copy/download まで確認済み。async polling は Cloud Tasks / production smoke scope | [docs/phase-4-ux-manual-pass-2026-06-10.md](phase-4-ux-manual-pass-2026-06-10.md) と `docs/phase-4-ux-evidence/2026-06-10/` に保存 |
| P1-A | NotebookLM source bundle API payload | 実証済みの勝ち筋を app の result payload に載せる | `exportContextPackageSourceBundle()` は実装済み。API result は単一 markdown のみ | Context Package result に `sourceBundle.files` が含まれ、excluded / human-review 本文が混入しないテストが通る |
| P1-B | NotebookLM source bundle zip UI | P1-A の payload をユーザーが zip として落とせるようにする | UI は単一 markdown copy/download のみ | `ContextPackageForm` に secondary export「NotebookLM用 bundle」を追加し、guide + included sources を zip download できる |
| P1-F | Async full-coverage strategist | async job が広い選択を実際に全件レビューできるようにする（**実行順は P1-C より先**） | P1-B 確認で露出: async job は `enforceSyncBudget:false` でも `inputBudget` が DEFAULT のまま（5文書/80chunk）。30文書選択で safe 400 chunk が dropped、zip が3ファイルに。実装後 review の残タスクは [docs/p1-f-review-follow-up-tasks.md](p1-f-review-follow-up-tasks.md) に分離 | [docs/p1-f-full-coverage-strategist.md](p1-f-full-coverage-strategist.md) の Stage 2 Done 条件（batched strategist + missing/questions reduce、給与シナリオ再実行で truncation ゼロ） |
| P1-C | Demo / docs を bundle 前提へ更新 | デモの最後を product truth に合わせる | `docs/demo-scenario.md` は単一 `.md` export の見せ方が古い | デモシナリオが「NotebookLM には source bundle を渡す」に更新される |
| P1-D | Extraction & Masking Quality Gate | 「安全に止める」だけでなく「止めすぎない」「構造化データ精度が十分」を示す | Curator public/direct は測定済み。DLP/Masker over-mask と DocumentIR / KnowledgeChunk の key-field / table / locator precision は薄い | 公開文書 over-mask eval、日本式公的文書 structured key-field eval、大きめ/混在資料 eval の最小セットが `pnpm` script または doc-runbook で回る |
| P1-E | 大きなファイルの事前分割 | token limit failure を減らし、巨大 chunk / 全体失敗を避ける | upload は 5 MiB 上限。XLSX 大ファイルで失敗が可視化済み | extractor / Curator 前に分割または sampling plan を作り、sheet / page / row group 単位で安全に処理できる |
| P2 | Phase 3-F デモ polish | 動画シナリオを現状の product truth に合わせる | `docs/demo-scenario.md` は単一 `.md` export の見せ方が古い | 最後の Export は「NotebookLM には source bundle を渡す」に更新 |
| P2 | 提出前の軽い運用補強 | 「まわす」説明力を上げる | alert / sweeper / TTL は済み。enqueue 二重 submit と SLO が未整理 | 二重 submit の挙動確認、簡易 SLO 1枚を `operate-deliver-readiness.md` へ追記 |
| P3 | 不要 CSS / UI 残骸 cleanup | 保守性を上げ、次の UI 変更を軽くする | 旧 heatmap / risk-callout / status badge modifier / sensitivity 重複などが残る | 挙動変更なしで未使用 CSS と古い `inventory-demo-*` naming を整理 |
| P3 | Ingest 拡張判断 | 次の product expansion を決める | Drive folder bulk / local directory batch / standalone images が候補 | 提出前は Drive folder bulk か local directory batch のどちらかを選定。standalone images は OCR/PII/eval 設計が重いので後続寄り |

## P0: Phase 4-UX ブラウザ手動通し

**なぜ先か**: 実装済み機能の証跡化で、最短で README の残タスクを潰せる。バグが見つかった場合も、zip UI やデモ polish の前に直せる。

**通す流れ**:
1. `/context-package` を localhost または本番 IAP で開く。
2. purpose を入力する。
3. candidates API の結果を確認する。
4. Safety Review と candidate selection を確認する。
5. Preview acknowledgement を確認する。
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
5. **P1-E: large file pre-splitting** — P1-D で露出した失敗ケースを入力にして、XLSX / CSV / PDF の分割方針を実装する。

## P1-A / P1-B: NotebookLM 用 source bundle zip UI

**実装方針**:
- 単一 `.md` は維持する。これは汎用 markdown / Gemini / RAG / copy 用の primary artifact。
- NotebookLM 向けには secondary export として「source bundle」を出す。
- source bundle の中身は `exportContextPackageSourceBundle(input)` の `files`:
  - `00-CONTEXT-PACKAGE-GUIDE.md`
  - included source files（本文のみ）
  - excluded / restricted / pending masking は source file として出さない。

**候補実装**:
- `fflate` などの client zip library を使う。
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

## P1-E: 大きなファイルの事前分割

**問題**:
- 大きな XLSX / PDF で Curator token limit failure が起きる。
- 1文書を丸ごと Curator に渡すと、失敗時に全体が失敗する。
- sheet / page / table の局所構造を保った分割がないと、Context Package 側でも巨大 chunk になりやすい。

**方向性**:
- XLSX: sheet ごと、必要なら row group ごとに summary / chunk 化する。
- CSV: header + row window で chunk 化し、列意味とサンプル行を分ける。
- PDF: page group / detected section ごとに DocumentIR を分ける。
- Curator は全文分類ではなく、document-level metadata + chunk-level evidence の二段にする。

**最初の実装候補**:
1. XLSX の large sheet preflight: used range / sheet count / estimated chars を計測。
2. threshold 超過時は sheet-level summary + row-window chunks へ分割。
3. Curator token limit を起こした文書を `failed` で終わらせるだけでなく、「分割推奨 / 部分処理可能」として記録する。

## P2: Phase 3-F デモ polish

**更新対象**: `docs/demo-scenario.md`

**変えること**:
- 最後の Export は「単一 `.md` を NotebookLM に投入」ではなく、「NotebookLM には source bundle の全ファイルを source 追加」にする。
- 単一 `.md` は汎用 artifact として残す。
- Dashboard refresh 後の画面構成に合わせて Knowledge Inventory / live funnel の見せ方を更新する。

## P2: 提出前の軽い運用補強

**enqueue 二重 submit**:
- UI の disabled / active job guard で重複 job が立たないか確認。
- browser double-click と network retry の観点を分ける。
- 必要なら idempotency key を検討する。

**簡易 SLO**:
- 例:
  - Context Package async job success rate: 95%+
  - async accepted response p95: 3s 以下
  - worker completion p95: 60s 以下（デモ tenant / sample workload）
  - stale-running recovery: 30分以内
- 提出用には「現状の実測と運用上の目標」を1枚で足りる。

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
3. P1-F async full-coverage strategist を実装する（[docs/p1-f-full-coverage-strategist.md](p1-f-full-coverage-strategist.md)）。review 残タスクは [docs/p1-f-review-follow-up-tasks.md](p1-f-review-follow-up-tasks.md) に残す。
4. P1-C demo scenario を bundle 前提へ更新する。
5. P1-D Extraction & Masking Quality Gate の最小 eval を切る。
6. P1-E large file pre-splitting を、eval で露出した失敗ケースから実装する。
7. P2 enqueue/SLO を提出資料向けに薄く固める。
8. P3 CSS cleanup と Ingest 拡張判断に進む。

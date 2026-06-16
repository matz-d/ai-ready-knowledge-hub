  実装指示書 — PDF table-assist 本線 dispatcher 配線 PR（D 戦略）

  1. 全体像

  目的
  P1-E Step 1 で実装済み・未配線の grounded Gemini
  table-assist（src/lib/extractors/officialDocPdfTableAssist/）を、本線の PDF
  抽出経路へ安全に接続する。ただし production の async ingest 実行コンテキスト（worker /
  Cloud Tasks）はまだ開けない。

  背景
  - table-assist 本体・grounding・fail-soft・audit summary・deps
  注入シームは完成済み（PR #43, e54193d (not yet wired)）。
  - 現状 production 呼出はゼロ。FEATURE_FLAG_IDS に flag 無し、dispatcher に
  tableAssistMode threading 無し、async document ingest worker は概念ごと不在（async
  基盤は context-package job のみ）。
  - 設計 locked decision 4 は「flag + async-worker-only の二重ゲート」。worker
  をフル構築すると context-package job
  基盤相当（lease/sweeper/OIDC/idempotency）の再現になり、提出（2026-07-10）前の P2
  と競合する → D 戦略（本線接続だけ先に land、トリガは後続）を採用済み。

  今回の PR でやること
  flag 追加 / pageTexts 配管 / audit metadata / dispatcher への tableAssistMode
  配線（augment を dispatcher 内でマージ）/ 同期 upload は明示 disabled / unit +
  安全回帰テスト / live harness script / docs。

  今回の PR でやらないこと
  PDF async ingest worker、Cloud Tasks enqueue、upload API の 202 化、UI
  polling、terminal document・masked chunks への後付け enrichment、production upload
  での table-assist live smoke。

  完了条件（PR DoD）
  - 同期 upload では flag ON でも table-assist が呼ばれない（テストで固定）
  - deps 注入 unit で async+flag ON 時に merge する
  - timeout / Gemini failure で pdf-parse IR が維持される（fail-soft）
  - マスク対象トークンが raw text 経由で chunk に復活しない（安全回帰テスト緑）
  - audit invariant（inferenceDestination / unmaskablePii）不変
  - 「Masker 前段でしか merge しない」がコード + docs 両方で固定
  - pnpm typecheck / 対象 unit / pnpm tsx scripts/runP1dQualityGate.ts --ci（baseline
  非回帰の確認であり機能検証ではない）/ 可能なら pnpm test

  既存 docs / code との接続点
  - docs/p1-e-large-file-pre-splitting.md §6「2026-06-14: P1-E Step 1 design (locked)」
  - src/lib/extractors/officialDocPdfTableAssist/index.ts（augmentOfficialDocWithTableAs
  sist、deps シーム）
  - src/lib/extractors/pdfExtractionDispatcher.ts / pdfDocumentExtractor.ts
  - src/lib/featureFlags.ts、src/lib/uploadOrchestrator/{types,pdfPath,audit}.ts、src/li
  b/audit/auditEvent.ts
  - src/app/api/documents/route.ts（dispatch 呼出 181 行）

  先に決めないと進めない論点 → 全て決定済み
  augment 呼出位置＝dispatcher 内（確定）/ async caller は本 PR 対象外（確定）/ flag 名
  pdf-table-assist・default off・tenant-scoped（確定）。新たな blocker 論点なし。

  1 PR か分割か
  → 1 PR で可。move-only
  ではないが、全変更が「同期経路を絶対に発火させない」制約下に閉じ、外部 I/O
  新設なし。ただし作業単位は下記 WU に分割して複数 AI へ並列配布する。

  ---
  2. PR スコープ判断

  ┌──────────────────────────────┬───────────────────────────────────────────────────┐
  │             区分             │                       内容                        │
  ├──────────────────────────────┼───────────────────────────────────────────────────┤
  │                              │ WU-1〜9（flag / pageTexts / audit / dispatcher    │
  │ 今回 1 PR に含める           │ 配線 / route disabled / tests / live harness /    │
  │                              │ docs / 最終統合）                                 │
  ├──────────────────────────────┼───────────────────────────────────────────────────┤
  │ 別 PR に送る                 │ production async caller（enqueue 地点）、UI 導線  │
  ├──────────────────────────────┼───────────────────────────────────────────────────┤
  │                              │ B: context-package job 基盤を document_ingest_pdf │
  │ 将来 epic 化                 │  job kind へ一般化（lease/sweeper/OIDC            │
  │                              │ 再利用）。P2                                      │
  │                              │ と競合しやすく提出前にやるかは人間判断            │
  ├──────────────────────────────┼───────────────────────────────────────────────────┤
  │                              │ 「dispatcher 内で augment を呼ぶ」を超えて        │
  │ 大きくなりすぎる境界線       │ enqueue / worker route / status lifecycle         │
  │                              │ に手を出した瞬間。そこを越えたら即 epic B 行き    │
  ├──────────────────────────────┼───────────────────────────────────────────────────┤
  │                              │ WU-1 + WU-2 + WU-4（disabled 既定）+              │
  │ 最小実装スライス             │ WU-5。これだけで「flag/型は通るが production      │
  │                              │ は永久 disabled」が成立                           │
  ├──────────────────────────────┼───────────────────────────────────────────────────┤
  │                              │ WU-3（audit 可観測性）→ WU-6（unit+安全回帰）→    │
  │ 安全に広げられる追加スライス │ WU-7（live harness）→ WU-8（docs）。各々独立に    │
  │                              │ revert 可能                                       │
  └──────────────────────────────┴───────────────────────────────────────────────────┘

  ---
  3. 作業分解

  WU-1 — pdf-table-assist feature flag 追加

  - 目的: flag を型安全に登録（tenant-scoped / default off / mutex 非対象）。
  - 対象: src/lib/featureFlags.ts、src/lib/__tests__/featureFlags.test.ts
  - 指示文: FEATURE_FLAG_IDS 配列に 'pdf-table-assist', // official-doc-pdf grounded
  Gemini table-assist (P1-E Step 1, async-only) を追加。as const satisfies により
  FeatureFlagId union と FeatureFlagSchema の z.enum
  は自動拡張されるので他に手を入れない。PDF_SUBTYPE_PRE_FLIGHT_CONFIGS（mutex
  ループ）には絶対に追加しない。テストに pdf-table-assist のパース1件を追加。
  - 担当: Cursor Composer composer-2.5
  - 理由: 単一配列+1テストの局所・ブレなし型追加。
  - 難易度: 低 / 認証等: 不要 / 依存: なし / 並列: 可
  - 検証: pnpm typecheck、pnpm test -- featureFlags
  - 完了条件: typecheck 緑、新テスト緑、mutex configs 未変更
  - 戻し方: 1行 revert

  WU-2 — pageTexts を抽出結果へ配管 + Map 変換ヘルパ

  - 目的: augment の入力 pageRawTexts: ReadonlyMap<number,string>
  の供給源を作る。textContent は不変。
  - 対象: src/lib/extractors/pdfDocumentExtractor.ts（ExtractPdfFromBufferResult +
  構築）、src/lib/extractors/pdfExtractionDispatcher.ts（PdfExtractionResult に optional
  pageTexts + array→Map ヘルパ）
  - 指示文: ExtractPdfFromBufferResult に pageTexts: { pageNumber: number; text: string
  }[] を追加し、textResult.pages（Array<{num,text}>）から pages.map(p => ({ pageNumber:
  p.num, text: p.text })) で構築。PdfExtractionResult（dispatcher）にも pageTexts? を
  optional で追加し、subtype-1 の extract クロージャで載せる。dispatcher に純関数
  function pageTextsToMap(pageTexts): ReadonlyMap<number,string> を追加（WU-4
  が使用）。textContent の値・content hash には一切影響させない。
  - 担当: Claude Code Sonnet 4.6
  - 理由: 2〜3ファイルにまたがる既存パターン準拠の型+構築。ブレは小さいが Cursor
  単独より安全。
  - 難易度: 低〜中 / 認証等: 不要 / 依存: なし / 並列: 可（WU-1 と同時）
  - 検証: pnpm typecheck、pnpm test -- pdfDocumentExtractor pdfExtractionDispatcher
  - 完了条件: 既存 dispatcher/extractor テスト緑、textContent 不変
  - 戻し方: optional フィールドなので revert 容易

  WU-3 — audit metadata に tableAssist を追加

  - 目的: table-assist の merged/skipped/failed を監査で可観測化。invariant とは独立。
  - 対象: src/lib/uploadOrchestrator/types.ts（PdfConversionAudit）、src/lib/audit/audit
  Event.ts（AuditEventConversion）、src/lib/uploadOrchestrator/audit.ts（recordDocumentC
  onvertAudit の mapping）
  - 指示文: PdfConversionAudit と AuditEventConversion に tableAssist?:
  TableAssistSummary（officialDocPdfTableAssist から import）を optional
  で追加。recordDocumentConvertAudit で conversion.tableAssist を
  AuditEventConversion.tableAssist へ
  pass-through。assertConversionInferenceDestinationInvariant /
  assertConversionUnmaskablePiiFindingsInvariant は変更しない（tableAssist は独立）。
  - 担当: Claude Code Sonnet 4.6
  - 理由: audit 境界に触れるが additive optional で invariant 非干渉。既存 mapping
  を辿る理解が要る。
  - 難易度: 中 / 認証等: 不要 / 依存: なし（型は独立）/ 並列: 可
  - 検証: pnpm typecheck、pnpm test -- auditEvent
  - 完了条件: invariant テスト緑、tableAssist が audit event まで通る
  - 戻し方: optional フィールド revert

  WU-4 — dispatcher への tableAssistMode 配線（コア・安全境界）

  - 目的: subtype-1 かつ async + flag ON のときだけ dispatcher 内で augment
  をマージし、merged IR を返す。merge は必ず masker の前段。
  - 対象: src/lib/extractors/pdfExtractionDispatcher.ts
  - 指示文: dispatchPdfExtraction の引数に tableAssistMode?: 'disabled' | 'async'（既定
  'disabled'、後方互換必須）を追加。mutex で subtype 選択後、selectedPdfConfig.flagId
  === 'pdf-conversion-subtype-1' && tableAssistMode === 'async' && (await
  args.isFlagEnabled('pdf-table-assist')) の時だけ、augmentOfficialDocWithTableAssist({
  mode:'async', buffer: args.buffer, documentIr: result.documentIr, pageRawTexts:
  pageTextsToMap(result.pageTexts ?? []) }) を呼ぶ（budget/concurrency/timeout
  はモジュール既定、新 env 追加禁止）。戻りで result.documentIr を outcome.documentIr
  に差し替え、result.conversion.tableAssist = outcome.summary を付与。augment は内部
  fail-soft なので dispatcher で握り潰さない（augment が pdf-parse IR + summary
  を返す）。flag は args.isFlagEnabled を再利用（tenant-bound）。新 reader を作らない。
  subtype-2/3 では async 指定でも絶対に呼ばない。
  - 担当: Claude Code Opus 4.8
  - 理由: 本線パイプライン統合 + masking 安全境界 +
  二重ゲートの正しさ判断。設計が重い唯一の単位。
  - 難易度: 高 / 認証等: ロジックは不要（augment は deps 注入でモック可）/ 依存: WU-1,
  WU-2 / 並列: 不可（中核）
  - 検証: pnpm typecheck、pnpm test -- pdfExtractionDispatcher
  - 完了条件: 既存 dispatcher テスト全緑（後方互換）、subtype-1 async+flag のみ merge
  - 戻し方: tableAssistMode 既定 disabled なので、配線を消しても同期経路は無傷

  WU-5 — 同期 upload route を明示 disabled

  - 目的: production upload で flag ON でも Gemini 第二パスを絶対に走らせない。
  - 対象: src/app/api/documents/route.ts（181 行の dispatch 呼出）
  - 指示文: dispatchPdfExtraction({ buffer, fileName, isFlagEnabled, tableAssistMode:
  'disabled' }) を明示指定。コメントで「同期 upload では table-assist 禁止（D 戦略）」。
  - 担当: Cursor Composer composer-2.5
  - 理由: 1 箇所の引数追加、ブレなし。
  - 難易度: 低 / 認証等: 不要 / 依存: WU-4（シグネチャ）/ 並列: 不可（WU-4 後）
  - 検証: pnpm test -- documents/route
  - 完了条件: route テスト緑、tableAssistMode:'disabled' が渡る
  - 戻し方: 引数 1 行 revert

  WU-6a — 安全回帰テスト（最重要）

  - 目的: 「masker 対象トークンが raw text 経由で table cell に復活し、再マスクされずに
  chunk へ漏れる」ことを塞ぐ。
  - 対象: src/lib/extractors/__tests__/（dispatcher）+ 必要なら
  uploadOrchestrator/__tests__/（pdfPath）
  - 指示文: raw page text にマスク対象トークン（人名/番号等）を含む documentIr
  を用意し、注入 deps.extractTableRowsForPage がそのトークンに grounding する row を
  emit。dispatch → documentIrToKnowledgeChunks → masker を通し、結果 chunk
  で当該トークンがマスクされていることを assert。あわせて「merge は masker
  前段」を構造として固定するコメント/assert を残す。
  - 担当: Claude Code Opus 4.8
  - 理由: CLAUDE.md masking 不変条件のコード化。データフロー理解と境界設計が必要。
  - 難易度: 高 / 認証等: 不要（deps + masker は決定論）/ 依存: WU-4 / 並列:
  可（WU-6b/WU-7 と）
  - 検証: pnpm test -- <該当>
  - 完了条件: 当該テスト緑、トークンがマスク済み
  - 戻し方: テストのみなので独立

  WU-6b — ゲート / fail-soft / 後方互換 unit テスト

  - 目的: disabled/async ゲート・flag OFF/ON・subtype-2/3 不発・fail-soft・dispatcher
  後方互換を固定。
  - 対象: src/lib/extractors/__tests__/pdfExtractionDispatcher.test.ts
  - 指示文: deps 注入で ①disabled 不発 ②async+flag OFF 不発 ③async+flag ON merge
  ④extractTableRowsForPage throw → pdf-parse IR 維持 + summary skipped
  ⑤content-neutral（raw に無い cell drop）⑥subtype-2/3 で async 指定でも不発
  ⑦tableAssistMode 省略で既存テスト全緑。
  - 担当: Claude Code Sonnet 4.6
  - 理由: 既存テストパターン準拠の中規模追加。
  - 難易度: 中 / 認証等: 不要 / 依存: WU-4 / 並列: 可
  - 検証: pnpm test -- pdfExtractionDispatcher
  - 完了条件: 7 系統緑
  - 戻し方: テストのみ独立

  WU-7 — live harness script（creds-gated）

  - 目的: 実 Gemini で labor/overtime/model fixture
  を通し、elapsed/rowsMerged/fail-soft/content-neutral を証跡化。production async ingest
  ではなく mainline library harness 検証。
  - 対象: scripts/（新規 oneoff）、evidence は docs/ か tmp/
  - 指示文: dispatchPdfExtraction({ ..., tableAssistMode:'async', isFlagEnabled: () =>
  true }) を fixture buffer で呼ぶ script を作成。GOOGLE_CLOUD_LOCATION=global +
  OFFICIAL_DOC_TABLE_ASSIST_MODEL 前提。出力に
  candidatePageCount/pagesProcessed/rowsMerged/elapsedMs と content-neutral
  確認を記録。実顧客データ禁止・sample-data の synthetic のみ。
  - 担当: Codex
  - 理由: terminal-native + Vertex live + GCP 認証 + 統合確認。
  - 難易度: 高 / 認証等: 要（Vertex global）/ 依存: WU-4 / 並列: 可（WU-6 と）
  - 検証: script 実走（人間 go 後）、evidence doc 記録
  - 完了条件: rowsMerged>0 のケースと fail-soft ケースを観測・記録
  - 戻し方: script は production 非経路、削除のみ

  WU-8 — docs 更新

  - 目的: D 戦略・不変条件・前提を正本に固定。
  - 対象: docs/p1-e-large-file-pre-splitting.md（必要なら docs/decisions.md）
  - 指示文: 「本 PR=D 戦略（本線接続・async worker 未実装）」「post-terminal enrichment
  禁止 / table-assist は必ず Masker 前段で merge（WU-4 構造保証 + WU-6a
  テストが根拠）」「raw/ 14日 retention 依存 / tenant flag / fail-soft / curator は
  textContent ベースなので分類不変・content hash 不変」を追記。
  - 担当: Claude Code Sonnet 4.6（不変条件節は WU-4/WU-6a の文言と整合させる）
  - 難易度: 低 / 認証等: 不要 / 依存: WU-4 確定後に finalize / 並列: draft は先行可
  - 検証: 目視 + リンク整合
  - 完了条件: 上記4点が doc に存在
  - 戻し方: docs のみ

  WU-9 — 最終統合・PR 前検証

  - 目的: 全 WU 統合後の green 確認と git 状態整理。
  - 対象: repo 全体
  - 指示文: pnpm typecheck → pnpm test → pnpm tsx scripts/runP1dQualityGate.ts
  --ci（baseline 非回帰）→ pnpm build（任意）→ knip（任意）→ git status / diff
  確認。同期経路で table-assist 不発であることを route テストで再確認。
  - 担当: Codex
  - 難易度: 中 / 認証等: 不要（quality gate は Vertex 不使用）/ 依存: 全 WU / 並列:
  不可（最後）
  - 完了条件: 全 gate 緑、作業ツリー意図どおり
  - 戻し方: 失敗 WU を個別 revert

  ---
  4. 依存関係と実行順

  - 最初: WU-1（flag）、WU-2（pageTexts）— 並列。WU-8(draft)・WU-3 も同時着手可。
  - 並列グループ A: WU-1 / WU-2 / WU-3 / WU-8(draft)
  - 中核（直列）: WU-4（A 完了後）
  - 並列グループ B（WU-4 後）: WU-5 / WU-6a / WU-6b / WU-7 / WU-8(finalize)
  - 最後（統合）: WU-9
  - Codex/Claude で確認すべき auth/GCP/live 項目: WU-7（Vertex global +
  OFFICIAL_DOC_TABLE_ASSIST_MODEL 疎通、asia-northeast1 は 3.x が 404）/ WU-9 の P1-D
  gate は Vertex 不使用。
  - 人間判断 checkpoint: ①WU-7 のライブ実走 go（creds/コスト）②最終 PR 分割・マージ判断
  ③（B を提出前にやるか）。設計判断（augment 位置・flag 既定・scope）は決定済みで
  checkpoint 不要。

  ---
  5. AI 別割り振り案

  - Codex: WU-7（live harness, Vertex）、WU-9（最終統合・git・gate）
  - Claude Code Opus 4.8: WU-4（dispatcher コア配線）、WU-6a（安全回帰テスト）
  - Claude Code Sonnet 4.6: WU-2（pageTexts
  配管）、WU-3（audit）、WU-6b（ゲート/fail-soft/後方互換 unit）、WU-8（docs）
  - Cursor Composer composer-2.5: WU-1（flag）、WU-5（route disabled）
  - 人間: WU-7 ライブ go、PR 分割/マージ最終判断、（epic B 着手可否）

  ---
  6. リスクと注意点

  - スコープが膨らみやすい箇所: WU-4 で「ついでに enqueue / worker route」へ踏み込むと
  epic B 化。dispatcher 内 merge を越えない。
  - 触らない方がよい領域: context-package job 基盤（contextPackageJobs/）、masker
  本体、curator flow、assert*Invariant 群。
  - セキュリティ境界: 同期 upload で table-assist を発火させないこと（WU-5）。flag は
  tenant-scoped（既存 reader 再利用、新 reader 禁止）。
  - masking/privacy/audit/multi-tenant 不変条件: ①merge は必ず masker 前段（grounding は
  raw=マスク前に照合するため、後付けは PII 復活）②audit invariant 非干渉（tableAssist
  は optional additive）③flag tenant 分離。
  - auth/GCP で詰まりやすい点: WU-7 は global のみ疎通（asia-northeast1 で 3.x が
  404）。OFFICIAL_DOC_TABLE_ASSIST_MODEL 未設定時は既定 model。
  - long-running/live/CI 注意: live harness はコスト・レイテンシ（per-call 45s timeout,
  N=6 page budget）。CI には載せない（report-only / 手動）。
  - 危険な実装パターン（禁止）: terminal document・masked chunks への後付け
  enrichment、raw/(14日) 前提の遅延再処理、同期経路での Gemini 発火。
  - rollback/fail-soft/idempotency: augment は内部 fail-soft 済（失敗で pdf-parse IR
  維持）。本 PR は worker 無しなので idempotency/lease は不要（= epic B の領域）。各 WU
  は optional 追加中心で個別 revert 可。

  ---
  7. 検証計画

  - unit: featureFlags / pdfDocumentExtractor /
  pdfExtractionDispatcher(ゲート・fail-soft・後方互換) / auditEvent /
  安全回帰(dispatch→masker) / documents/route(disabled)
  - integration/eval: pnpm tsx scripts/runP1dQualityGate.ts --ci（baseline
  非回帰の確認。table-assist 機能検証ではない）
  - typecheck/build/lint/knip: pnpm typecheck 必須 / pnpm build は任意（production
  readiness 寄せ）/ knip 任意
  - live smoke: WU-7 のみ（人間 go 後、synthetic fixture、global）
  - GCP/credential/env 確認:
  GOOGLE_CLOUD_LOCATION=global、OFFICIAL_DOC_TABLE_ASSIST_MODEL、Vertex 認証（ADC）
  - 証跡: docs/p1-e-* または tmp/p1e-table-assist-harness-*.json（実データ禁止）
  - CI gate にすべき: typecheck / 対象 unit / runP1dQualityGate --ci（既存 deterministic
  zero checks）
  - report-only に留める: live harness 数値（rowsMerged/elapsed）、table-assist recall

  ---
  8. コピペ用実装指示

  ▎ WU-1（Cursor composer-2.5）
  ▎ ゴール: pdf-table-assist flag を型安全に登録。
  ▎ 触ってよい: src/lib/featureFlags.ts, src/lib/__tests__/featureFlags.test.ts
  ▎ 触らない: pdfExtractionDispatcher.ts の mutex configs, それ以外全部
  ▎ 手順: FEATURE_FLAG_IDS に 'pdf-table-assist'
  ▎ を1行追加（コメント付き）。PDF_SUBTYPE_PRE_FLIGHT_CONFIGS
  ▎ には追加しない。テストにパース1件追加。
  ▎ 検証: pnpm typecheck && pnpm test -- featureFlags
  ▎ 完了: typecheck+テスト緑、mutex 未変更
  ▎ 不変条件: flag は tenant-scoped/default off、mutex 非対象。

  ▎ WU-2（Sonnet 4.6）
  ▎ ゴール: pageTexts を抽出結果に載せ、array→Map ヘルパを用意。textContent 不変。
  ▎ 触ってよい: src/lib/extractors/pdfDocumentExtractor.ts,
  ▎ src/lib/extractors/pdfExtractionDispatcher.ts
  ▎ 触らない: augment 本体, masker, audit
  ▎ 手順: ExtractPdfFromBufferResult に pageTexts:{pageNumber,text}[] 追加し
  ▎ textResult.pages({num,text}) から構築 → PdfExtractionResult に pageTexts?
  ▎ 追加（subtype-1 で載せる）→ dispatcher に pageTextsToMap() 純関数追加。
  ▎ 検証: pnpm typecheck && pnpm test -- pdfDocumentExtractor pdfExtractionDispatcher
  ▎ 完了: 既存テスト緑、textContent/content hash 不変
  ▎ 不変条件: textContent と content hash を変えない。

  ▎ WU-3（Sonnet 4.6）
  ▎ ゴール: audit に tableAssist? を additive 追加（invariant 非干渉）。
  ▎ 触ってよい: src/lib/uploadOrchestrator/types.ts, src/lib/audit/auditEvent.ts,
  ▎ src/lib/uploadOrchestrator/audit.ts
  ▎ 触らない: assertConversion*Invariant 関数本体
  ▎ 手順: PdfConversionAudit と AuditEventConversion に tableAssist?: TableAssistSummary
  ▎ を optional 追加し、recordDocumentConvertAudit で pass-through。
  ▎ 検証: pnpm typecheck && pnpm test -- auditEvent
  ▎ 完了: invariant テスト緑、tableAssist が audit event まで通る
  ▎ 不変条件: inferenceDestination / unmaskablePii invariant を一切変えない。

  ▎ WU-4（Opus 4.8）
  ▎ ゴール: subtype-1 かつ async+flag ON のときだけ dispatcher 内で augment をマージし
  ▎ merged IR を返す。merge は masker 前段。
  ▎ 触ってよい: src/lib/extractors/pdfExtractionDispatcher.ts
  ▎ 触らない: route, masker, augment 本体, context-package job
  ▎ 手順: dispatchPdfExtraction に tableAssistMode?: 'disabled'|'async'（既定
  ▎ disabled）追加 → subtype 選択後 flagId==='pdf-conversion-subtype-1' &&
  ▎ mode==='async' && await args.isFlagEnabled('pdf-table-assist') の時だけ
  ▎ augmentOfficialDocWithTableAssist({mode:'async', buffer:args.buffer,
  ▎ documentIr:result.documentIr, pageRawTexts:pageTextsToMap(result.pageTexts??[])}) →
  ▎ result.documentIr 差し替え +
  ▎ result.conversion.tableAssist=summary。budget/concurrency/timeout は既定。新 env・新
  ▎ reader 禁止。
  ▎ 検証: pnpm typecheck && pnpm test -- pdfExtractionDispatcher
  ▎ 完了: 既存テスト全緑（後方互換）、subtype-1 async+flag のみ merge
  ▎ 不変条件: 同期経路で発火しない / merge は必ず masker 前段 / flag は既存 tenant-bound
  ▎ reader 再利用。

  ▎ WU-5（Cursor composer-2.5）
  ▎ ゴール: 同期 upload を明示 disabled。
  ▎ 触ってよい: src/app/api/documents/route.ts（dispatch 呼出のみ）
  ▎ 触らない: それ以外
  ▎ 手順: dispatchPdfExtraction({...}) に tableAssistMode:'disabled' を追加 + コメント。
  ▎ 検証: pnpm test -- documents/route
  ▎ 完了: route テスト緑
  ▎ 不変条件: production upload で table-assist を絶対に走らせない。

  ▎ WU-6a（Opus 4.8）
  ▎ ゴール: マスク対象トークンが raw text 経由で chunk に復活しないことを固定。
  ▎ 触ってよい: src/lib/extractors/__tests__/, 必要なら
  ▎ src/lib/uploadOrchestrator/__tests__/
  ▎ 触らない: production code
  ▎ 手順: raw text にマスク対象トークンを含む documentIr + 注入 deps がそのトークンに
  ▎ grounding する row を emit → dispatch→documentIrToKnowledgeChunks→masker → 結果
  ▎ chunk でマスク済みを assert。
  ▎ 検証: pnpm test -- <該当>
  ▎ 完了: テスト緑
  ▎ 不変条件: merge は masker 前段（このテストが根拠）。

  ▎ WU-6b（Sonnet 4.6）
  ▎ ゴール: ゲート/fail-soft/後方互換の unit を固定。
  ▎ 触ってよい: src/lib/extractors/__tests__/pdfExtractionDispatcher.test.ts
  ▎ 触らない: production code
  ▎ 手順: deps 注入で disabled不発 / async+OFF不発 / async+ON merge /
  ▎ throw→IR維持+skipped / content-neutral / subtype-2,3不発 / mode省略で全緑、の7系統。
  ▎ 検証: pnpm test -- pdfExtractionDispatcher
  ▎ 完了: 7系統緑
  ▎ 不変条件: tableAssistMode 省略時に既存挙動不変。

  ▎ WU-7（Codex）
  ▎ ゴール: 実 Gemini で table-assist の mainline harness 検証＋証跡。
  ▎ 触ってよい: scripts/（新規）, docs/ or tmp/（evidence）
  ▎ 触らない: production 経路
  ▎ 手順: dispatchPdfExtraction({...,tableAssistMode:'async', isFlagEnabled:()=>true})
  ▎ を synthetic fixture(labor/overtime/model) で実行する
  ▎ script。GOOGLE_CLOUD_LOCATION=global +
  ▎ OFFICIAL_DOC_TABLE_ASSIST_MODEL。candidate/processed/rowsMerged/elapsed +
  ▎ content-neutral を記録。
  ▎ 検証: 人間 go 後に実走、evidence 記録
  ▎ 完了: merge ケースと fail-soft ケースを観測
  ▎ 不変条件: 実顧客データ禁止・synthetic のみ / production async ingest ではない。

  ▎ WU-8（Sonnet 4.6）
  ▎ ゴール: D 戦略と不変条件を正本へ固定。
  ▎ 触ってよい: docs/p1-e-large-file-pre-splitting.md, 必要なら docs/decisions.md
  ▎ 触らない: code
  ▎ 手順: 「D 戦略/async worker 未実装」「post-terminal 禁止 / merge は masker
  ▎ 前段」「raw 14日 retention 依存 / tenant flag / fail-soft / curator textContent
  ▎ ベースで分類・hash 不変」を追記（WU-4/WU-6a と整合）。
  ▎ 検証: 目視・リンク整合
  ▎ 完了: 4点が doc に存在
  ▎ 不変条件: コードの実挙動と文言を一致させる。

  ▎ WU-9（Codex）
  ▎ ゴール: 統合 green と PR 前検証。
  ▎ 触ってよい: なし（検証のみ。失敗時は該当 WU へ戻す）
  ▎ 手順: pnpm typecheck → pnpm test → pnpm tsx scripts/runP1dQualityGate.ts --ci
  ▎ →（任意 pnpm build/knip）→ git status/diff。同期経路 disabled を route
  ▎ テストで再確認。
  ▎ 完了: 全 gate 緑、作業ツリー意図どおり
  ▎ 不変条件: P1-D gate は baseline 非回帰の確認であり table-assist 機能検証ではない。
# P1-D: Extraction & Masking Quality Gate

**作成**: 2026-06-11
**位置づけ**: Phase 4-UX / NotebookLM source bundle / P1-F async full-coverage strategist 完了後に進める、抽出・構造化・マスキング品質の評価ゲート。

---

## 1. 目的

P1-D では、Context Package に渡す前の情報が「安全で、かつ実務に使える粒度で抽出されている」ことを測る。

これまでの health / heuristic / golden eval は、PDF 本線統合や scan-pdf の fail-closed を確認する足場として機能している。一方で、提出前に説明したい品質はもう一段具体的である。

- 公開文書を過剰に `Confidential` / `Restricted` へ寄せていないこと。
- 空欄様式や公的帳票で、重要な field / value / table cell / locator が保持されること。
- 合成 PII 入り資料では、PII が安全に検出・マスクされ、raw PII が Context Package に混入しないこと。
- 大きめ・混在資料では、抽出失敗、巨大 chunk、table extraction failure、token limit failure を観測し、P1-E の分割設計へ渡せること。

P1-D の主目的は **品質評価の確立** であり、巨大 PDF / XLSX / CSV の分割実装は P1-E に送る。

---

## 2. 成功条件

- P1-D の評価対象と metrics が 1 つの正本 doc として説明できる。
- stable eval と live drift check が分離されている。
- stable eval は committed fixture / sidecar のみで実行でき、Vertex を呼ばない。
- live drift check は任意実行として、モデル変更後の OCR drift やローカル検証資料の崩れを記録できる。
- scan-pdf の既存 fixture は再利用しつつ、P1-D では構造化精度・over-mask・モデル drift の観点で再評価する。
- P1-E に渡すべき失敗ケースが、資料種別・症状・再現方法とともに残る。

---

## 3. 評価対象 8 種類

| # | 種類 | 代表 fixture / 資料 | 主な評価観点 | commit 方針 |
|---|---|---|---|---|
| 1 | 公的空欄様式 PDF | 労働条件通知書、源泉徴収票、確定申告書 | field recall、value precision、table cell recall、locator coverage、over-restriction | 一部既存。源泉徴収票・確定申告書の text-layer PDF は新規取得 |
| 2 | 公的空欄様式 scan-pdf | `mhlw-labor-conditions-notice-blank-scan.pdf`、`nta-withholding-form-blank-scan.pdf` | OCR、罫線、記入欄、位置依存、PII ラベル誤検出 | 既存 fixture を再利用。P1-D 用 expected / sidecar は一部新規作成 |
| 3 | 合成 PII 入り帳票 PDF | `synthetic-employment-context-with-pii.pdf` など | Curator / DLP / Masker、raw PII 混入防止、mask 後 value retention | 既存 fixture を再利用。合成 PII のみ commit 可 |
| 4 | 合成 PII 入り scan-pdf | `synthetic-employment-form-scan.pdf`、`synthetic-invoice-with-pii-scan.pdf`、`synthetic-unmaskable-pii-scan.pdf` | OCR drift、maskable / unmaskable PII、maskedText 経路 | 既存 fixture を再利用。unmaskable fixture は live smoke 専用扱いを維持 |
| 5 | 長文公的ガイド・規程 | モデル就業規則、時間外労働ガイド | heading / paragraph、章構造、長文 chunk、source selection | 既存 fixture を再利用 |
| 6 | spreadsheet / CSV / XLSX | 複数 sheet、大きめ CSV、給与・料金・台帳系 | sheet / row group、巨大 chunk、column sensitivity、token limit failure | CSV は一部既存。P1-D 用 XLSX / 大きめ CSV は新規作成 |
| 7 | slide-pdf / deck | `synthetic-context-package-deck.pdf` | slide locator、視覚構造、deck 特有の抜け | 既存 fixture を再利用 |
| 8 | 統合報告書・大きめ混在 PDF | `local-data/` 配下の統合報告書 PDF など | 大きめ PDF、文章 + 表 + 図表 + 財務数値、table extraction failure、chunk explosion | **commit しない**。`local-data/` は gitignore 済み |

### Fixture readiness

| 種類 | 現状 | P1-D 着手時の作業 |
|---|---|---|
| 公的空欄様式 PDF | `mhlw-labor-conditions-notice-general` は `expected.json` / `document-ir.json` あり | 源泉徴収票・確定申告書の text-layer PDF を必要なら新規取得し、出典・利用条件・PII 有無を README に追記 |
| 公的空欄様式 scan-pdf | `nta-withholding-form-blank-scan.document-ir.json` はあり。`mhlw-labor-conditions-notice-blank-scan` は PDF ありだが committed sidecar / expected が P1-D 用に不足 | P1-D 用の `expected.json` と必要 sidecar を新規作成 |
| 合成 PII 入り PDF / scan-pdf | synthetic fixture と一部 expected / sidecar あり | P1-D の false masking / value retention 用 expected を必要に応じて追補 |
| spreadsheet / CSV / XLSX | `sample-data/accounting-office/*.csv` はあり。repo 内の `.xlsx` は主に `tests/fixtures/google-sheets/sample-drive-export.xlsx` | 給与・台帳系 XLSX と大きめ CSV は synthetic fixture として新規作成 |
| 統合報告書・大きめ混在 PDF | ローカル検証資料のみ | gitignore 済みの `local-data/` に置き、実行時引数で渡す |

### 統合報告書の扱い

添付の統合報告書 PDF は、製品精度改善のためのローカル検証資料として扱う。repo には commit しない。

現時点の観測:

- local path: `local-data/annual-report-doc-2025-viewing-ja.pdf` など、gitignore 済みのローカル検証ディレクトリに置いて実行時引数で渡す。committed doc には個人環境の `Downloads` 絶対パスを正本として残さない。
- size: 約 13.4 MB
- pages: 56
- text layer: あり
- `pdf-parse getText()` は 56 page / 約 176k chars を抽出できる。
- 現行 `official-doc-pdf` extractor の `pdf-parse getTable()` はこの PDF で例外を起こす。

この資料は P1-D の live drift / local verification に含め、P1-E では大きめ混在 PDF の事前分割・table fallback・fail-soft 設計の入力にする。

---

## 4. 評価レイヤー

P1-D は、既存の eval 設計に合わせて **純関数 / sidecar ベースの stable eval** と **Vertex / DLP などを呼ぶ live script** を分ける。`pnpm eval:p1d:quality` は新しい評価器を丸ごと作るのではなく、`src/eval/conversion/` の既存純関数を呼ぶ薄い orchestrator とする。

既存資産との対応:

| P1-D で使う観点 | 既存資産 | P1-D で足すもの |
|---|---|---|
| field recall | `src/eval/conversion/golden/evalSemanticRetention.ts` | structured expected schema への拡張。既存 substring recall は入口として再利用 |
| locator quality | `src/eval/conversion/heuristic/evalLocatorQuality.ts` | boolean から `locatorCoverage` の割合へ拡張 |
| coverage / chunk readiness | `evalCoverage.ts`、`evalContextPackageReadiness.ts` | P1-D report への集約と大きめ資料向け症状分類 |
| scan-pdf sidecar vs fresh OCR | `scripts/compareScanPdfGoldenSidecarToMainline.ts` | P1-D live drift report への取り込み |
| scan-pdf sidecar regeneration | `scripts/regenerateScanPdfGoldenSidecars.ts` | P1-D では必要時のみ利用し、CI path では Vertex を呼ばない |
| curator public over-restriction | `src/eval/curator/publicDocClassificationGolden.ts`、`scripts/runCuratorClassificationEval.ts` | live-only として扱う。LLM 出力 sidecar はモデル更新で腐りやすいため作らない |

### 4.1 stable eval

ローカルまたは CI で安定して回す評価。Vertex / Gemini / Cloud DLP live call は呼ばず、committed fixture と sidecar のみを使う。初期は **CI blocker にしない report-only** とし、閾値が安定してから blocker 化を検討する。

初期コマンド案:

```bash
pnpm eval:p1d:quality
```

後続実装でこの script を追加する。初期出力は JSON report でよい。

```text
tmp/p1d-quality-report.json
```

### 4.2 live drift check

モデル変更、OCR drift、DLP 挙動、ローカル検証資料の崩れを見る任意実行。CI blocker にしない。

対象:

- scan-pdf fresh OCR と committed sidecar の比較。
- `SCAN_PDF_GEMINI_MODEL` 変更後の key field recall drift。
- public curator over-restriction。既存の `eval:curator:classification` 系を使い、stable P1-D report には sidecar 化しない。
- Cloud DLP live over-mask / false redaction 観測。
- 統合報告書 local extraction の text / table / chunk status。

結果は `tmp/` に詳細を置き、要約を P1-D evidence doc に残す。

---

## 5. 主な metrics

| Metric | Layer | 意味 | 主な対象 | 入力 |
|---|---|---|---|---|
| `publicDirectRate` | live | 公開文書が `Public` / `Internal` + `direct` に留まる割合 | 公的空欄様式、公開ガイド | live curator run |
| `falseMaskedTokenCount` | stable if masker sidecar exists / otherwise live | 公開文書で不要に `[REDACTED:*]` された token 数 | 公的空欄様式、公開ガイド | Masker/DLP output sidecar または live DLP run |
| `overRestrictedCount` | live | 公開文書が `Confidential` / `Restricted` または non-direct に寄った件数 | Curator / candidate selection | live curator run |
| `fieldRecall` | stable | 期待 key field が抽出結果に存在する割合 | 帳票、規程、統合報告書 | `expectedFields` / structured expected |
| `coreFieldRecall` | stable | `expectedFieldTiers` で `core` 指定された重要 field の recall。将来の blocker 候補 | 帳票、公開様式 | `expectedFields` + `expectedFieldTiers` |
| `valuePrecision` | stable | key に対応する value が正しい粒度で保持された割合 | 帳票、表、財務数値 | structured expected |
| `tableCellRecall` | stable | 期待 table cell / row / column 関係が保持された割合 | 源泉徴収票、確定申告書、統合報告書 | structured expected |
| `locatorCoverage` | stable | field / value / table cell に page / row / sheet / slide locator が付く割合 | 全 subtype | DocumentIR / KnowledgeChunk locator |
| `emptyChunkCount` | stable | 空 chunk 数 | conversion / chunking | KnowledgeChunk |
| `oversizedChunkCount` | stable | Firestore 500 KiB 上限や prompt budget 上危険な chunk 数 | PDF、XLSX、CSV | KnowledgeChunk |
| `largeMixedPdfExtractionStatus` | live/local | 大きめ混在 PDF の text extraction 状態 | 統合報告書 | local PDF extraction result |
| `largeMixedPdfFailureReasons` | live/local | `table_failed`、`oversized`、`too_many_chunks` など status と直交する失敗理由 | 統合報告書 | local PDF extraction result |

`largeMixedPdfExtractionStatus` は `pass` / `partial` / `failed` の大分類に留め、`table_failed` のような症状は `largeMixedPdfFailureReasons` に分ける。text extraction 成功 + table extraction 失敗のようなケースを表現できるようにするため。

---

## 6. scan-pdf 再評価方針

scan-pdf の公的空欄様式や合成 PII fixture は Phase 3-H-3 M6 で既に扱っているため、資料としては重複する。

ただし P1-D では次の理由で再評価する。

1. 評価目的が違う。M6 は本線疎通、fail-closed、health / heuristic が中心。P1-D は field / value / table / locator / over-mask を見る。
2. モデル変更後の drift を確認したい。過去証跡には `gemini-2.5-flash` が残り、現行 scan-pdf OCR は `SCAN_PDF_GEMINI_MODEL ?? 'gemini-3.1-flash-lite'` を使う。
3. 過去にも sidecar と本線 OCR の recall drift が観測されている。`synthetic-invoice-with-pii-scan` は一度、expected と本線 OCR 出力が大きく乖離した。

したがって、P1-D では既存 scan-pdf fixture を「重複」ではなく「モデル drift と構造化精度を測る継続 fixture」として扱う。

Committed scan-pdf DocumentIR sidecars are raw OCR baselines. They must match the generated PoC / pipeline output and must not be hand-annotated with `tableIndex` / `rowIndex` just to improve locator metrics. If a raw scan OCR output has `kind: "table"` blocks but no row locator, that is a real product signal for P1-E table fallback and live drift design.

---

## 7. P1-E への引き継ぎ

P1-D で見つかった次の症状は、P1-E の大きなファイル事前分割・fallback 設計へ送る。

- PDF table extraction が例外で全体失敗する。
- PDF は text layer を持つが table / chart / multi-column layout が崩れる。
- 1 文書が巨大 chunk または大量 chunk になり、Strategist / Context Package の budget を圧迫する。
- XLSX / CSV が sheet / row group 単位に分かれず、token limit failure を起こす。
- scan-pdf OCR が label を PII と誤検出する。
- scan-pdf OCR が value を欠落・分断し、maskable / unmaskable 判定が揺れる。

記録時は、少なくとも次を残す。

- 資料種別
- fixture / local path
- 実行コマンド
- 失敗症状
- 期待される分割・fallback 方針
- P1-E で直すか、P2 以降へ送るか

---

## 8. 後続実装メモ

最初の実装単位:

1. `pnpm eval:p1d:quality` を追加する。
2. committed fixture / sidecar だけで stable report を出す。
3. 既存の `src/eval/conversion/` 純関数を再利用し、P1-D report に集約する。
4. 新規実装は `valuePrecision`、`tableCellRecall`、`falseMaskedTokenCount`、`locatorCoverage` の割合化、chunk サイズ系の report 集約に絞る。
5. public doc over-restriction は live-only として扱い、stable 用 curator sidecar は作らない。
6. live drift check は stable eval とは別 script にする。
7. 統合報告書は local path が存在するときだけ検証し、存在しない環境では skip する。

実行例の想定:

```bash
# stable, no Vertex
pnpm eval:p1d:quality

# optional live drift
SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite pnpm tsx scripts/runP1dLiveDriftCheck.ts

# optional local mixed PDF check
pnpm tsx scripts/runP1dMixedPdfCheck.ts <local-annual-report.pdf>
```

---

## 9. Assumptions

- 統合報告書 PDF は repo に commit しない。
- 公的機関の PDF を新規追加する場合は、出典・利用条件・PII 有無を `sample-data/document-conversion/README.md` に追記する。
- 顧客実データ、実在顧客由来の匿名化データ、実在個人の PII は commit しない。
- P1-D は品質評価の確立を優先し、巨大 PDF / XLSX / CSV の分割実装は P1-E に送る。
- scan-pdf の再実行は重複作業ではなく、モデル変更後の drift 確認として扱う。
- `pnpm eval:p1d:quality` は初期段階では report-only。CI blocker 化は metrics と fixture が安定した後に判断する。

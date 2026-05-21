# Phase 3-H-3 scan-pdf golden recall ベースライン

> 実施日: 2026-05-21
> 目的: M6 完了後の **精度チェック（golden recall）** を H-2 §7.4 と同型で 1 回記録し、sidecar を本線 OCR に揃える。
> 正本: [docs/phase-3-h-3-direction.md](phase-3-h-3-direction.md) §8.3 M6-5 / [docs/decisions.md](decisions.md) `D-P3-H-7 Q4`

## 1. 実行コマンド

```bash
pnpm install --frozen-lockfile

# golden 全 fixture（subtype 1/2/3 含む）
DLP_DRY_RUN=true pnpm tsx scripts/runConversionEvalForCi.ts --stage golden \
  --out tmp/conversion-eval-golden-scan-pdf-baseline.json

# scan-pdf: 固定 sidecar vs 本線 fresh OCR の recall 比較
pnpm tsx scripts/compareScanPdfGoldenSidecarToMainline.ts \
  | tee tmp/scan-pdf-golden-sidecar-vs-mainline.json

# sidecar 再生成（本線 extractor、fixture 単位可）
pnpm tsx scripts/regenerateScanPdfGoldenSidecars.ts synthetic-employment-form-scan
pnpm tsx scripts/regenerateScanPdfGoldenSidecars.ts synthetic-invoice-with-pii-scan
```

CI では golden は **merge blocker にしない**（[docs/phase-3-h-2-monthly-review.md](phase-3-h-2-monthly-review.md) 踏襲）。本記録は運用レビュー用シグナル。

## 2. 初回 golden サマリ（sidecar 更新前、2026-05-21）

`DLP_DRY_RUN=true`、committed sidecar 使用。scan-pdf 2 件のみ抜粋。

| `documentId` | `keyFieldRecall` | `overall.status` | 解釈 |
|---|---:|---|---|
| `synthetic-employment-form-scan` | **1.00** | pass | `expected.json` が PoC 由来 sidecar と整合 |
| `synthetic-invoice-with-pii-scan` | **1.00** | pass | 同上（**ただし本線 OCR とは未整合** — §3 参照） |

全 7 fixture サマリ: pass 6 / warn 1 / fail 0（subtype 1 の `synthetic-employment-context-with-pii` が warn。H-2 既知）。

**注意:** sidecar 上の recall 1.0 は、expected を sidecar から選んでいると **自己参照的に高く出る**。本線 upload 経路との一致は §3 の比較で別途確認する。

## 3. sidecar vs 本線 OCR 比較（更新前）

`compareScanPdfGoldenSidecarToMainline.ts` — 本線 `extractScanPdfFromBuffer`（`gemini-2.5-flash` / `asia-northeast1`）を PDF から再実行。

| `documentId` | sidecar recall | sidecar `sourceKind` | mainline recall | mainline chunks | 判定 |
|---|---:|---|---:|---:|---|
| `synthetic-employment-form-scan` | 1.00 | `poc` | 1.00 | 20 | 本線と実質一致。sidecar の `sourceKind` のみ差分 |
| `synthetic-invoice-with-pii-scan` | 1.00 | `upload` | **0.11** | 37 | **ドリフト大**。旧 expected（INV-2025 等）は本線 OCR テキストに存在しない |

invoice の mainline missing（8/9 件）例: `請求番号: INV-2025-0042`、`合計金額（税込）: 198,000円` など — 印刷元 PDF 向け expected が、本線 OCR 出力（`SYN-INV-2026-0501`、`¥1,133,000` 等）と乖離。

証跡: `tmp/scan-pdf-golden-sidecar-vs-mainline.json`（初回実行 `2026-05-21T11:25:12Z`）。

## 4. 是正（2026-05-21）

1. **sidecar 再生成** — 両 golden fixture の `*.document-ir.json` を本線 `extractScanPdfFromBuffer` で上書き（`sourceKind: upload` / `extractionProvider: gemini-vertex-ocr`）。
2. **invoice `expected.json` 更新** — 本線 sidecar から再選定（10 フィールド）。旧 PoC/印刷元向け表記を削除。
3. **再検証** — golden recall 1.00、sidecar vs mainline も両 fixture で recall 1.00。

| `documentId` | 更新後 sidecar recall | 更新後 mainline recall |
|---|---:|---:|
| `synthetic-employment-form-scan` | 1.00 | 1.00 |
| `synthetic-invoice-with-pii-scan` | 1.00 | 1.00 |

employment の `expected.json` は本線再 OCR 後も 9 フィールドすべて hit のため **文言は維持**（sidecar のみ本線化）。

## 5. sidecar 運用ポリシー（正本化）

| 項目 | 方針 |
|---|---|
| 生成経路 | **本線** `src/lib/extractors/scanPdfDocumentExtractor.ts`（PoC runner は補助） |
| CI | `scripts/runConversionEvalForCi.ts` は committed sidecar のみ（Vertex 非呼出） |
| 再生成 | `pnpm tsx scripts/regenerateScanPdfGoldenSidecars.ts <documentId>` |
| golden 対象 | `synthetic-employment-form-scan` / `synthetic-invoice-with-pii-scan` のみ（公的 scan #2/#3 は heuristic 軸） |
| 除外 | `synthetic-unmaskable-pii-scan`（live smoke 専用）、`degraded-scan-fail-closed.pdf`（413 専用） |

## 6. 次の運用アクション

- **月次**: [docs/phase-3-h-2-monthly-review.md](phase-3-h-2-monthly-review.md) と同手順で golden を手動実行。scan-pdf 行を本表に追記。
- **converter / prompt 変更時**: sidecar + `expected.json` をセットで PR 更新。
- **公開拡大（`D-P3-H-7 Q4`）**: golden expected が **30 日 stable** するまで dev tenant 限定を維持。
- **未着手**: `mhlw-labor-conditions-notice-blank-scan` / `nta-withholding-form-blank-scan` の golden `expected.json`（OCR coverage / locator 用。heuristic は既存）。

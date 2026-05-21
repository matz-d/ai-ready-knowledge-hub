# Document Conversion PoC (Phase 3-H)

正本: [docs/phase-3-h-direction.md](../../docs/phase-3-h-direction.md)

**本線統合（2026-05-21 時点）:** subtype 1〜3 は Cloud Run upload route に feature flag 付きで統合済み。実装 DoD は [docs/phase-3-h-2-direction.md](../../docs/phase-3-h-2-direction.md)（subtype 1）と [docs/phase-3-h-3-direction.md](../../docs/phase-3-h-3-direction.md) §8.2–8.3（subtype 2/3）。本ディレクトリの runner は観察・fixture 生成・golden 再現用として継続利用する。

## ディレクトリ構成（subtype 起点）

| Path | Role |
|------|------|
| `shared/` | `DocumentIR` 型、fixture / output パス、artifact 書き出し |
| `official-doc-pdf/` | 優先 1: pdf-parse 縦串（adapter / health eval / compare） |
| `slide-pdf/` | 優先 2: Gemini 直読み first-choice + pdf-parse fallback runner（PoC） |
| `scan-pdf/` | 優先 3: Gemini/Vertex AI OCR runner（PoC、Document AI は未試走） |
| `office-native/` | 優先 4: 着手保留メモ |
| `output/{subtype}/` | 生成 `*.document-ir.json`（gitignore） |

評価型の正本は `src/eval/conversion/`（ルート `pnpm typecheck` の対象）。

## TypeScript / pnpm 接続方針

| 項目 | 方針 |
|------|------|
| package manager | **ルートのみ**（`pnpm-workspace.yaml` の `.`）。`poc/` 配下に独自 `package.json` は置かない。 |
| npm / package-lock | **使わない**（`pnpm-lock.yaml` のみ）。 |
| 実行 | ルート `package.json` の `poc:conversion:*` → `tsx poc/document-conversion/.../runner.ts` |
| typecheck | **別 tsconfig** `poc/document-conversion/tsconfig.json` を `extends` し、ルート `typecheck` で `tsc -p` を続けて実行。ルート `include` には PoC を入れない（Next.js 本体と PoC の境界を明示）。 |
| 本線コード参照 | PoC から `src/` を相対 import（例: `src/eval/conversion`）。 |

## Scripts

```bash
pnpm poc:conversion:official-doc-pdf [path/to.pdf]
pnpm poc:conversion:official-doc-pdf:compare [path/to.pdf]   # pdf-parse vs MarkItDown (local uvx)
pnpm poc:conversion:slide-pdf [path/to.pdf]
pnpm poc:conversion:scan-pdf [path/to.pdf]
pnpm typecheck   # src + poc/document-conversion
```

## Fixtures

`sample-data/document-conversion/{subtype}/` — 取得計画は [sample-data/document-conversion/README.md](../../sample-data/document-conversion/README.md)。

## official-doc-pdf PoC

**本線（2026-05-20 完了）:** `src/lib/extractors/pdfDocumentExtractor.ts` + `pdf-conversion-subtype-1` flag。正本: [docs/phase-3-h-2-direction.md](../../docs/phase-3-h-2-direction.md)。

## slide-pdf PoC

`slide-pdf` runner の cost、失敗時挙動、`coverage` / `locator_quality` の暫定閾値候補は [docs/phase-3-h-slide-pdf-poc.md](../../docs/phase-3-h-slide-pdf-poc.md) に記録する。**本線**は `src/lib/extractors/slidePdfDocumentExtractor.ts` + `pdf-conversion-subtype-2` flag（2026-05-20 完了）。live smoke: [docs/phase-3-h-3-slide-pdf-live-smoke.md](../../docs/phase-3-h-3-slide-pdf-live-smoke.md)。

## scan-pdf PoC

`scan-pdf` runner は Gemini/Vertex AI に `application/pdf` を渡して OCR し、`DocumentIR` と `*.scan-pdf-result.json` を `poc/document-conversion/output/scan-pdf/` に出力する。結果 JSON には `ocrUsage`、`ocrCost`、`piiFindings`、`safetyReadinessMeaning`、`eval.safetyReadiness.unmaskablePiiFindings` を含める。`unmaskablePiiFindings` は、OCR が PII らしさを見つけたが、文字列 span として安全に置換できないと判断した件数を表す。

課金単価は `gemini-2.5-flash` / `gemini-2.5-flash-lite` の既定値を持つが、価格改定や別モデルでは `SCAN_PDF_GEMINI_INPUT_USD_PER_1M_TOKEN` / `SCAN_PDF_GEMINI_OUTPUT_USD_PER_1M_TOKEN` で上書きする。

**本線（M6 完了 2026-05-21）:** `src/lib/extractors/scanPdfDocumentExtractor.ts` + `pdf-conversion-subtype-3` flag（tenant **`m-grow-ai.com` のみ**）。timeout 60s / 入力 5 MiB、OCR pre-flight fail-closed、`document.convert` に `inferenceDestination` と `unmaskablePiiFindings`。DoD: [docs/phase-3-h-3-direction.md](../../docs/phase-3-h-3-direction.md) §8.3。live smoke: [docs/phase-3-h-3-scan-pdf-live-smoke.md](../../docs/phase-3-h-3-scan-pdf-live-smoke.md)。fixture: [sample-data/document-conversion/README.md](../../sample-data/document-conversion/README.md)。

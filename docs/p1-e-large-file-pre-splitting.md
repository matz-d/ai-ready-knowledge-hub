# P1-E: Large File Pre-Splitting / Table Fallback / Locator Enrichment

**作成**: 2026-06-12
**位置づけ**: P1-D Extraction & Masking Quality Gate で見えた失敗症状を、巨大ファイル対策だけに押し込めず、抽出 fallback と chunk/locator 表現の改善へ分解する direction doc。

---

## 1. 目的

P1-E は、AI に渡す前の変換結果が「大きすぎる」「表が壊れる」「field/value の関係を追えない」ことで Context Package の品質が落ちる問題を扱う。

名前は従来の「大きなファイルの事前分割」を引き継ぐが、P1-D で観測された症状のうち一部は分割では解けない。したがって P1-E は次の 3 トラックとして扱う。

| Track | 主対象 | 代表症状 | 方針 |
|---|---|---|---|
| T1: preflight + pre-splitting | XLSX / CSV / 大きめ PDF | token limit、巨大 chunk、page/sheet 数過多 | sheet / row group / page group 単位で処理計画を作る |
| T2: table extraction fallback | official-doc-pdf / scan-pdf | `getTable()` 例外、視覚表が `image_text` 化し `tableCellRecall = 0` | text fail-soft を維持しつつ table fallback と scan OCR prompt 改修を設計する |
| T3: chunk boundary / locator enrichment | scan-pdf / form-like docs | label/value が別 chunk、table row locator 不在 | chunk 表現と locator を強化し、field/value/table 関係を追えるようにする |

P1-D の raw OCR baseline 原則は維持する。sidecar に手で `tableIndex` / `rowIndex` を足して recall を上げるのではなく、T2/T3 の実装で本線出力を改善する。

---

## 2. P1-D からの Handoff

### H1: Large mixed PDF table extraction failure

- materialType: `large-mixed-pdf`
- fixtureOrLocalPath: `local-data/annual-report-doc-2025-viewing-ja.pdf`
- commit policy: local-only。repo に commit しない。
- reproduction:

```bash
pnpm eval:p1d:mixed-pdf -- local-data/annual-report-doc-2025-viewing-ja.pdf --out tmp/p1d-mixed-pdf-check.json
```

- observedSymptoms:
  - text extraction は成功: `56` pages / `176746` chars
  - table extraction は `Cannot read properties of undefined (reading 'from')` で失敗
  - overall status は `partial`
- expectedFallback:
  - table extraction が失敗しても text extraction を失敗扱いにしない
  - `largeMixedPdfFailureReasons` に `table_failed` を残す
  - table/chart-heavy page は fallback strategy に回す
- targetTrack: T1 + T2

### H2: Scan invoice visual table lost as image text

- materialType: `scan-pdf`
- fixtureOrLocalPath: `sample-data/document-conversion/scan-pdf/synthetic-invoice-with-pii-scan.document-ir.json`
- reproduction:

```bash
pnpm eval:p1d:quality -- --out tmp/p1d-quality-report.json
```

- observedSymptoms:
  - invoice line items are emitted as `image_text` blocks
  - `synthetic-invoice-with-pii-scan` field/core recall is `1`
  - invoice line-item `tableCellRecall` is `0`
- expectedFallback:
  - scan OCR prompt / postprocess should emit table-like rows for clear invoice line items
  - until fixed, committed sidecar remains raw OCR baseline and recall stays low
- targetTrack: T2
- interlock:
  - scan OCR prompt changes can shift model behavior. Run P1-D live drift check before/after prompt changes and record the summary in P1-D evidence.

### H3: Scan form label/value split across chunks

- materialType: `scan-pdf`
- fixtureOrLocalPath: `sample-data/document-conversion/scan-pdf/synthetic-employment-form-scan.document-ir.json`
- reproduction:

```bash
pnpm eval:p1d:quality -- --out tmp/p1d-quality-report.json
```

- observedSymptoms:
  - labels such as `Employee name`, `Address`, `Phone` and values such as `XXXX Taro`, `1-2-3 XXXX-cho...`, `090-1234-5678` are separate chunks
  - field/core recall is `1`
  - `valuePrecision` is `0` because `evaluateExpectedValues` requires field and value in the same chunk
- expectedFallback:
  - preserve adjacent label/value relationships during DocumentIR -> KnowledgeChunk conversion, or enrich locator/evidence links enough for valuePrecision to prove the relationship
  - do not loosen P1-D matching rules just to pass this fixture
- targetTrack: T3

### H4: Scan table row locator missing

- materialType: `scan-pdf`
- fixtureOrLocalPath: public blank-form scan sidecars under `sample-data/document-conversion/scan-pdf/`
- reproduction:

```bash
pnpm eval:p1d:quality -- --out tmp/p1d-quality-report.json
```

- observedSymptoms:
  - raw scan OCR can emit `kind: "table"` blocks without table row locator detail
  - P1-D intentionally does not hand-add locator metadata
- expectedFallback:
  - improve scan OCR / postprocess to emit row-level evidence when the source has table-like structure
  - keep sidecars raw until the extractor emits the locator naturally
- targetTrack: T2 + T3

---

## 3. Implementation Order

1. T1 preflight report only
   - Add PDF/XLSX/CSV preflight measurements before changing production behavior.
   - Minimum output: file type, pages/sheets/rows, estimated chars, chunk estimate, recommended split unit.

2. T2 table fail-soft
   - Ensure official PDF text extraction can still produce usable chunks when table extraction fails.
   - Preserve failure reasons separately from overall extraction status.

3. T3 label/value relationship representation
   - Prototype a form-like chunk boundary or evidence-link representation for scan-pdf.
   - Re-run P1-D stable eval and confirm valuePrecision changes because the structure improved, not because expectations were weakened.

4. T2 scan OCR table prompt/postprocess
   - Improve scan OCR table output only with before/after drift evidence.
   - Re-run P1-D live drift check around model/prompt changes.

---

## 4. Non-Goals

- Do not hand-edit committed DocumentIR sidecars to add locators or table rows.
- Do not lower P1-D matching strictness to hide label/value or table structure gaps.
- Do not commit local customer/proprietary PDFs used for large mixed PDF checks.
- Do not make recall-style metrics CI blockers in P1-E; P1-D keeps recall report-only until fixture meaning is stable.

---

## 5. Verification

Minimum verification for P1-E changes:

```bash
pnpm typecheck
pnpm test
pnpm eval:p1d:quality -- --out tmp/p1d-quality-report.json
```

For local-only large mixed PDFs:

```bash
pnpm eval:p1d:mixed-pdf -- local-data/annual-report-doc-2025-viewing-ja.pdf --out tmp/p1d-mixed-pdf-check.json
```

For scan OCR prompt/model behavior changes, also run the P1-D live drift check defined by the masker/OCR drift workstream and summarize the result in `docs/p1-d-evidence-2026-06-11.md`.

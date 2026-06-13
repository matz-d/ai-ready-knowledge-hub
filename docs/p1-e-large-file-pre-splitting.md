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

---

## 6. Implementation Notes

### 2026-06-12: First slice started

- T1 report-only preflight was added for CSV / XLSX / official PDF extractors.
  - CSV: row count, column count, estimated chars, chunk estimate, recommended split unit.
  - XLSX: sheet count, total rows, max sheet rows, max columns, estimated chars, chunk estimate, recommended split unit.
  - PDF: page count, estimated chars, chunk estimate, recommended split unit.
- Small CSV / XLSX inputs keep the existing chunking behavior; large table inputs receive a `preflight:` extraction warning and a structured `preflightReport`.
- T2 official PDF table fail-soft was started: `getTable()` failure no longer discards successful `getText()` output. The extractor returns `tableExtraction: { ok: false, error }` separately so callers can treat the result as partial rather than failed.
- Follow-up slice: CSV / XLSX large-table extraction now uses the preflight result to produce a sheet/file summary chunk plus row-window chunks (`500` data rows per window). Window locators use the actual data row range, for example `A2:B501`, while the header is repeated in chunk text as context.
- Follow-up slice: official PDF extraction now builds a page-group split plan for large PDFs (`25` pages per group). Production upload keeps the full extracted text for chunk hashing / Masker input, but sends a bounded page-group manifest to Curator through `pdfCuratorContent` to reduce token-limit failures. Because the manifest is sampled, its `direct` classification is not trusted: `page_group_manifest` input mode forces `Confidential / requires_masking`, so Masker still sees the full extracted text before any AI-readable terminal.
- Resolved T1 gap: CSV / XLSX chunk extraction uses row windows, and upload-time Curator input now uses a bounded table manifest when preflight recommends `row_group` / `sheet`. The full source remains the Masker input. Sampled `table_manifest` direct classifications are forced to `Confidential / requires_masking`, matching the PDF page-group fail-closed rule.
  - Google Sheets import uses the same table-manifest Curator path for large exported workbooks; the byte-size import guard remains separate from token / classification input control.
- T3 first slice: scan-pdf `DocumentIR -> KnowledgeChunk` conversion now duplicates an adjacent same-line form value onto the label chunk when both blocks have bbox evidence. The original value chunk remains unchanged, and the label chunk records `scanLabelValueLink=<blockId>` in `extractionWarnings`.
  - This fixed the P1-D `synthetic-employment-form-scan` label/value handoff case without weakening P1-D matching rules or editing committed sidecars.
  - `pnpm eval:p1d:quality -- --out tmp/p1d-quality-report.json` now reports `synthetic-employment-form-scan` `valuePrecision = 1` (`7/7`).
- T2 scan visual table fallback first slice: scan-pdf `DocumentIR -> KnowledgeChunk` conversion now synthesizes additional `table` chunks from bbox-aligned `image_text` rows when OCR did not emit native table blocks. The original OCR chunks remain unchanged, and synthesized rows record `scanTableFallback=visual image_text rows synthesized as table chunk`.
  - This fixed the P1-D `synthetic-invoice-with-pii-scan` invoice handoff case without changing the Gemini OCR prompt or regenerating committed sidecars.
  - `pnpm eval:p1d:quality -- --out tmp/p1d-quality-report.json` now reports `synthetic-invoice-with-pii-scan` `valuePrecision = 1` (`5/5`) and `tableCellRecall = 1` (`4/4`).
- Not yet changed: scan OCR prompt/model behavior. Keep prompt changes as a separate PR because they require before/after live drift evidence.

### Review follow-ups before scan OCR prompt changes

Non-blocking items to keep visible for the team:

- PR note: CSV chunk IDs now include spreadsheet range (`docId:csv:Sheet1:A1:B3`) instead of the previous whole-sheet form (`docId:csv:Sheet1`). `replaceChunksForDoc` delete-then-write avoids orphan chunks, but any ID-comparison tooling will see regenerated CSV chunks as new.
- Provenance follow-up: `page_group_manifest` fail-closed override is currently visible in curator rationale, but `curatorInputMode` is not persisted as a structured Firestore field. If the team wants to measure how often manifest classification forced `requires_masking`, add a structured provenance field in a later production-readiness slice.
- Cleanup follow-up: `csvExtractor` still has a defensive non-spreadsheet branch that current callers never hit, and CSV/XLSX row-window generation has duplicated summary/window-loop logic. Keep this for Phase 5 cleanup unless it starts obscuring P1-E review.
- T2/P2 follow-up: scan visual table fallback now runs even when native table blocks exist on the same page, and skips only data rows already emitted as native table rows. It is still anchored to amount-like headers and does not fully solve non-amount tables.

Recommended PR boundary:

- Cut a PR before scan OCR prompt changes. The current slice contains T1 preflight, CSV/XLSX row-window chunking, PDF page-group curator manifest, T2 official-PDF table fail-soft with fail-closed compensation, local T3 label/value enrichment, and local T2 scan visual table fallback. These conversion-adapter changes do not call Gemini or regenerate scan sidecars. Scan OCR prompt/model changes should be a follow-up PR because they affect model output and require separate P1-D live drift evidence.

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

### 2026-06-13: born-digital PDF Gemini comparison before more production work

Current P1-D stable metrics show that the weakest structured conversion area is
not scan-pdf anymore. It is born-digital official-doc-pdf through the `pdf-parse`
path:

- `mhlw-labor-conditions-notice-general`: field recall `0.06`, core `0.50`,
  table `1.0`, locator `0.21`
- `mhlw-overtime-limit-guide`: field recall `0.19`, core `0.75`,
  table `0`, locator `0.26`
- `mhlw-r07-model-work-rules`: field recall `0.05`, core `0.29`,
  table `0`, locator `0.14`
- measured value precision is already `1.0`, so the issue is recall, table
  structure, and locator evidence rather than field/value pairing.

Do not start by adding a new comparison script or wiring Gemini into production.
Use the existing PoC compare harness:

- Extend `poc/document-conversion/official-doc-pdf/compare/runCompare.ts` with a
  third converter arm: `gemini`.
- Reuse `runOfficialDocPipeline({ converter })`, `DocumentIR -> KnowledgeChunk`,
  and `renderCompareReport` so the report stays comparable with the existing
  `pdf-parse` / MarkItDown arms.
- Keep this eval-only. No upload route, no feature flag, no sidecar regeneration,
  and no production fallback until the comparison says it is worth doing.
- Use committed official-doc-pdf fixtures first because they have golden
  expectations. `local-data/annual-report-doc-2025-viewing-ja.pdf` stays
  local-only and qualitative because it has no expected sidecar.
- For hallucination screening, compare Gemini-emitted field/value/table cell text
  against the `pdf-parse` full text as a cheap ground proxy. Values absent from
  the full text should be surfaced as hallucination candidates before any human
  review.

Adoption criteria for a later production design:

- table cell recall improves clearly over `pdf-parse`
- field/core recall and locator coverage improve
- value precision does not regress
- Gemini failures remain fail-soft in the compare harness and can fall back to
  the `pdf-parse` baseline
- large mixed PDFs are evaluated separately as a qualitative table/layout
  fallback track, not as a table-cell-recall benchmark without golden data

First eval-only comparison result:

- `mhlw-labor-conditions-notice-general` (4 pages): Gemini succeeded, but matched
  `pdf-parse` on the measured quality metrics: field/core `1.0`, value `0.333`,
  table `0`, locator `0.872`, hallucination candidates `0`.
- `mhlw-overtime-limit-guide` (24 pages / 13 MB): Gemini succeeded on retry and
  preserved value precision `1.0`, but did not improve table cell recall
  (`0`). Field recall was lower than fresh `pdf-parse` (`0.906` vs `1.0`) and
  locator coverage was lower (`0.868` vs `0.947`). hallucination candidates `0`.
- `mhlw-r07-model-work-rules` (94 pages): Gemini full-document direct read
  returned empty output/text in the compare harness. This stays fail-soft.

Interpretation:

- The current Gemini full-document arm is useful as a comparison harness, but is
  not production-adoptable yet.
- It does not yet validate the table-recall hypothesis. The next useful
  experiment is page-grouped or table-focused Gemini extraction, not direct
  whole-document replacement.
- The comparison results are from fresh converter output. They should not be
  confused with committed P1-D sidecar baseline metrics, which measure the
  currently committed fixtures/sidecars.

Page-grouped Gemini follow-up:

- The Gemini arm now supports Ghostscript-based page grouping for eval-only
  comparison. Defaults: `OFFICIAL_DOC_PDF_GEMINI_PAGE_GROUP_SIZE=1`,
  `OFFICIAL_DOC_PDF_GEMINI_CONCURRENCY=4`,
  `OFFICIAL_DOC_PDF_GEMINI_GROUP_ATTEMPTS=2`.
- Page-grouping must not trust model-emitted page numbers. The harness remaps
  each group result back to the source page range deterministically.
- Table locators are also normalized deterministically in the Gemini arm because
  model-emitted `tableIndex` values were unstable.

Observed page-group results:

- `mhlw-labor-conditions-notice-general` with `pageGroupSize=1`: Gemini kept
  page coverage `1.0`, improved table cell recall from `0` to `0.333`, and
  improved locator coverage from `0.872` to `0.897`. The remaining missing table
  cells are blank-form sidecar values (`○○事業所`, `事務職`) that are not visibly
  present in the public blank form.
- `mhlw-overtime-limit-guide` with `pageGroupSize=1`: page coverage recovered to
  `1.0`, but field recall dropped to `0.563`, value precision to `0.75`, locator
  coverage to `0.553`, and table cell recall stayed `0`. `pageGroupSize=2`
  was worse on this fixture: field `0.5`, value `0.75`, locator `0.5`, table
  `0`.
- `mhlw-r07-model-work-rules` with `pageGroupSize=4`: full-document Gemini's
  empty output was avoided. Gemini produced 91 IR pages out of 94 source pages
  (`eval.coverage.pageCoverage=0.968`), field/core recall `1.0`, value `0`,
  table `0`, locator `0.860`. This is operationally better than empty output,
  but not better than fresh `pdf-parse` on quality.
- This means page grouping helps coverage and prevents whole-document empty
  output, but it is not a quality win for all official PDFs. It should be treated
  as a bounded extraction strategy, not a drop-in replacement for `pdf-parse`.

Hybrid table-assist follow-up:

- The compare harness now includes `pdf-parse+gemini-tables`: use `pdf-parse` as
  the primary extractor, run Gemini in table-only mode as a second pass, and
  merge only table rows grounded in the same page's `pdf-parse` text.
- The grounding filter is required. Before filtering, Gemini table-only produced
  at least one table row on `mhlw-overtime-limit-guide` page 3 that was clearly
  from an unrelated agricultural document. Ungrounded table rows are not merged.
- `mhlw-labor-conditions-notice-general` with `pageGroupSize=1`: hybrid
  preserves pdf-parse field/core/value metrics and improves table recall from
  `0` to `0.333` and locator from `0.872` to `0.897`.
- `mhlw-overtime-limit-guide` with `pageGroupSize=1`: hybrid preserves
  pdf-parse field/core/value/locator (`1.0 / 1.0 / 1.0 / 0.947`) but table recall
  remains `0`. It increases grounded table candidates (`116 -> 193`) without
  improving the current golden cells.
- `mhlw-r07-model-work-rules` with `pageGroupSize=4`: hybrid preserves
  pdf-parse field/core/value/locator (`1.0 / 1.0 / 0 / 0.860`) and increases
  table candidates (`78 -> 298`), but table recall remains `0`.

Table-assist golden result:

- Added `synthetic-official-doc-table-assist-golden.pdf` as a compare-only,
  PII-free official-doc-pdf fixture. It is intentionally not listed in
  `scripts/runP1dQualityGate.ts` `STABLE_FIXTURES` because stable P1-D must not
  depend on live Gemini calls.
- The fixture is generated by
  `poc/document-conversion/official-doc-pdf/fixtures/generate-table-assist-golden.ts`
  and has a sidecar
  `sample-data/document-conversion/official-doc-pdf/synthetic-official-doc-table-assist-golden.expected.json`.
- Fresh compare result on 2026-06-13:

| Fixture | Arm | table cell recall | table candidates | locator coverage | hallucination candidates |
|---|---|---:|---:|---:|---:|
| `synthetic-official-doc-table-assist-golden` | `pdf-parse` | `0` | `0` | `0` | n/a |
| `synthetic-official-doc-table-assist-golden` | `gemini` | `0` | `4` | `0` | `0` |
| `synthetic-official-doc-table-assist-golden` | `pdf-parse+gemini-tables` | `1.0` | `4` | `1.0` | `0` |
| `mhlw-labor-conditions-notice-general` | `pdf-parse` | `0` | `0` | `0.872` | n/a |
| `mhlw-labor-conditions-notice-general` | `gemini` | `0` | `11` | `0.872` | `0` |
| `mhlw-labor-conditions-notice-general` | `pdf-parse+gemini-tables` | `0.333` | `13` | `0.897` | `0` |

- Interpretation: full Gemini can emit table-shaped blocks, but its block /
  locator granularity is not reliable enough to adopt as a replacement. The
  table-only hybrid path preserves the `pdf-parse` baseline and improves the
  targeted golden fixture from `0/3` to `3/3`.
- The result supports a production design shaped as **bounded table assist**,
  not full-document Gemini replacement: run Gemini only for table extraction,
  merge only rows grounded in local text, and keep `pdf-parse` as the source of
  truth for page text and fallback behavior.

Current best decision:

- Do not replace `pdf-parse` with Gemini for official-doc-pdf.
- The best PoC direction is `pdf-parse` primary plus a gated Gemini table-assist
  second pass for documents/pages where table extraction is known weak.
- Treat table-assist output as untrusted until it is grounded against local
  extracted text. A production design would also need cost/latency controls and
  a better table-specific golden set because the current official-doc-pdf
  expected table cells do not show broad wins.
- Keep the synthetic table-assist golden as the regression check for this
  behavior before wiring any production path.

Local mixed PDF qualitative result:

- `local-data/annual-report-doc-2025-viewing-ja.pdf` (56 pages / local-only /
  no golden): `pdf-parse.getTable()` still throws on this document, so the PoC
  extractor now keeps text extraction and falls back to empty tables for the
  compare harness.
- `pdf-parse`: 56 IR pages, 56 chunks, table candidates `0`, page coverage `1`.
- MarkItDown: 1 IR page, 4209 chunks, table candidates `1707`, page coverage
  `0.018`.
- Gemini direct full-document: succeeded but returned only 7 IR pages, 56
  chunks, table candidates `5`, page coverage `0.125`.
- Gemini page-grouped (`pageGroupSize=1`): 56 IR pages, 1749 chunks, table
  candidates `459`, page coverage `1.0`, no hallucination candidates from the
  available expected-sidecar check. This took several minutes locally and has no
  golden table recall because the document is local-only.
- Hybrid `pdf-parse+gemini-tables` (`pageGroupSize=4`): 56 IR pages, 506 chunks,
  table candidates `450`, page coverage `1.0`. This keeps the pdf-parse page
  coverage and adds grounded table rows, making it the best qualitative result
  for this local mixed PDF.
- This confirms the local mixed PDF should not use full-document Gemini direct
  read as-is. Page-grouping is promising for coverage, but a production design
  would need cost/latency controls and a grounded table-focused second pass.

Table-assist hardening before production wiring:

- Added compare-only public PDF table-assist expected sets as
  `official-doc-pdf/*.table-assist.expected.json`. They are loaded only by the
  compare harness and are not added to stable P1-D `STABLE_FIXTURES`.
- The compare report now records `tableAssistGoldens`, Gemini runtime metadata
  (`elapsedMs`, `pageGroupCount`, `geminiCallCount`, group size, concurrency,
  attempts, model, region), and `pdfParseGeminiTablesGrounding` with raw,
  grounded, rejected, and example rejected rows.
- 2026-06-13 live compare spot checks:
  - `synthetic-official-doc-table-assist-golden`, `pageGroupSize=1`: hybrid
    table recall `1.0`, grounding rejected `0/4`.
  - `mhlw-labor-conditions-notice-general`, `pageGroupSize=1`: compare-only
    table-assist golden improved `pdf-parse 0/5` to hybrid `5/5`; grounding
    rejected `0/12`; table-assist elapsed `21552ms`, Gemini calls `4`.
  - `mhlw-overtime-limit-guide`, `pageGroupSize=4`: compare-only table-assist
    golden improved `pdf-parse 3/5` to hybrid `5/5`; grounding rejected
    `64/129`; table-assist elapsed `270230ms`, Gemini calls `6`.
  - `mhlw-r07-model-work-rules`, `pageGroupSize=16`: compare-only table-assist
    golden improved `pdf-parse 0/5` to hybrid `4/5`; grounding rejected
    `23/134`; table-assist elapsed `42200ms`, Gemini calls `6`.
- The overtime result makes cost/latency/timeout gating a production blocker:
  even with six page groups, table-assist took about 4.5 minutes in this run.

### 2026-06-14: P1-E Step 0 — official-doc sidecars regenerated from raw pdf-parse

Finding: the born-digital "weak field recall" signal (labor `0.06`, overtime
`0.19`, model-work-rules `0.05`) was a **stale-sidecar measurement artifact**, not
an extractor weakness. The committed `*.document-ir.json` sidecars were small
hand-authored stubs (May 20); `*.expected.json` was later broadened to the full
real-document field list (Jun 11). The stable gate was grading a tiny stub
against a large golden (labor `2/33 = 0.0606`, core `2/4 = 0.50` — exact match).

Action: regenerated the 3 public MHLW sidecars from the mainline pdf-parse path
(`extractPdf` → `buildDocumentIr`) via the new committed regenerator
`pnpm fixtures:official-doc-pdf:sidecars`, matching the scan-pdf raw-baseline
policy. `*.expected.json` files were left intact (document-level truth).
`synthetic-employment-context-with-pii` is excluded (hand-authored PII
value-retention fixture; declares `expectedTableCells: not_applicable`).

Stable-gate before → after (the gate now measures the real extractor):

| fixture | field | core | value | table | locator |
|---|---|---|---|---|---|
| labor notice | 0.06 → **1.00** | 0.50 → **1.00** | 1.00 → 0.33 | 1.00 → 0.00 | 0.21 → **0.87** |
| overtime guide | 0.19 → **1.00** | 0.75 → **1.00** | 1.00 → 1.00 | 0.00 → 0.00 | 0.26 → **0.95** |
| model work rules | 0.05 → **1.00** | 0.29 → **1.00** | 1.00 → 0.00 | 0.00 → 0.00 | 0.14 → **0.86** |

Interpretation: field/core recall is now `1.0` everywhere — the extractor was
never the field-recall problem. The real, now-honest born-digital gaps are:

- **value precision** (labor `0.33`, model-work-rules `0.00`): label/value
  linearized apart — the Step 2 / T3 label-value enrichment target.
- **table cell recall** (`0` on all 3, despite `116`/`78` pdf-parse table
  candidates on overtime/model-work-rules and `0` on labor): pdf-parse emits
  table noise but not the specific legal-limit / rule cells — the Step 1 grounded
  Gemini table-assist target.

Deterministic CI blockers stay green (`emptyChunkCount=0`, `oversizedChunkCount=0`,
`falseMaskedTokenCount=0`); the src adapter is one-chunk-per-block, skips empty
blocks, and auto-splits oversized chunks, so large-doc regeneration is safe.
Verification: `pnpm typecheck`, full `pnpm test` (897 green), `pnpm eval:p1d:quality -- --ci` exit 0.
`heuristic.fixtures.test.ts` was updated to the measured reality (overtime
`tableCandidates 3→116`, model `2→78`, labor `4→0` + `hasTableLocators false`).

Baseline-fixed-values caveat: the pinned counts (`116 / 78 / 0`) are the
**pdf-parse extractor baseline**, not "true" document table counts. If a
pdf-parse upgrade or a DocumentIR-adapter change moves them, treat it as
"baseline regeneration needed" (`pnpm fixtures:official-doc-pdf:sidecars`), not a
broken test. The same applies to the regenerated `*.document-ir.json` sidecars.

### 2026-06-14: P1-E Step 1 design (locked) — production grounded Gemini table-assist

Goal: convert the PoC table-assist win (public table-assist `3/15 → 14/15`) into
bounded production behavior on the born-digital `official-doc-pdf` path, without
the 270s whole-document latency.

Locked decisions:

1. **Gating = table-suspect ∧ under-served + per-document page budget `N=6`.**
   Per page, score "table-suspect" from row-like raw-text lines and tier the page
   by how well pdf-parse already covered it. Priority order:
   `no_pdf_table` (0 pdf-parse table rows + suspect) > `sparse_pdf_table`
   (few rows + suspect) > `uncaptured_cells` (many rows but suspect content). Take
   the top `N=6`. Started at `6` (not 8) specifically to cap the overtime case.
   Rationale: the heuristic only decides *which ≤6 pages* spend a Gemini call;
   correctness is enforced by grounding and cost by the budget.
2. **Cell-level grounding (mandatory).** Keep only cells whose normalized text
   appears in the same page's pdf-parse text; rebuild the row from surviving
   cells; drop the row if `< 2` cells survive (and require ≥1 substantive cell).
   This makes table-assist **content-neutral**: every emitted character was
   already in pdf-parse output, so it adds no new PII surface and flows through
   the existing Masker unchanged — no new safety gate needed.
3. **Page splitting via `pdf-lib` (pure JS), not Ghostscript.** The Cloud Run
   image (`node:22-bookworm-slim`) has no `gs`; avoid adding a native binary.
   New dependency must respect `minimumReleaseAge: 4320` + lockfile review.
4. **Activation = new Firestore feature flag `pdf-table-assist` (off by default)
   AND async-worker-only execution context (double gate)**, with fail-soft.
   Implementation: thread an explicit `tableAssistMode: 'disabled' | 'async'`
   into the dispatcher so a flag alone can never run it on the synchronous
   upload path. Any failure / timeout / budget-exceeded returns the unchanged
   pdf-parse `documentIr` and records a `tableAssist` audit summary.

Module layout (`src` cannot import `poc`, so reimplemented here):
`src/lib/extractors/officialDocPdfTableAssist/` as a small, pure-function-heavy
pipeline: `selectCandidatePages` (pure) → `splitPages` (pdf-lib I/O) →
`extractTables` (Gemini I/O, mirrors `scanPdfGeminiOcr.ts`) → `groundCells`
(pure) → `mergeDocumentIr` (pure). First PR scope: the pure core + N=6 +
fail-soft + audit summary; quality tuning (esp. tier-3 "uncaptured" precision)
is a follow-up. The synthetic table-assist golden remains the regression check;
the stable P1-D gate stays pdf-parse-baseline (it documents the gap, by design).

### 2026-06-16: P1-E Step 1 mainline wiring (D strategy — locked)

**Scope (D strategy):** Connect grounded Gemini table-assist to the mainline
`pdfExtractionDispatcher` without building the production async document ingest
worker or Cloud Tasks enqueue. The synchronous upload route passes
`tableAssistMode: 'disabled'` explicitly, so production upload never fires
table-assist even when the tenant flag is on.

**Not in this PR:** PDF async ingest worker, Cloud Tasks enqueue, upload API
202 + polling, UI status lifecycle, post-terminal enrichment on terminal
documents or masked chunks, production live smoke on the sync path.

**Locked invariants:**

1. **Double gate (tenant flag + async context).** Activation requires the
   tenant-scoped feature flag `pdf-table-assist` (default off) **and**
   `tableAssistMode: 'async'`. A flag alone must never run table-assist on the
   synchronous upload path. See [decisions.md](decisions.md) `D-P1-E-TA-1`.

2. **Merge before Masker — post-terminal enrichment forbidden.** Table-assist
   merge runs **only** inside `dispatchPdfExtraction`, strictly before
   `documentIrToKnowledgeChunks` and the Masker. Grounding compares Gemini
   cells against the same page's **pre-mask** pdf-parse text; merged table rows
   re-surface characters that already existed in raw text. Writing merged IR or
   chunks onto terminal documents or masked chunks after masking would let those
   tokens bypass the Masker. This is forbidden.

   - **Structural guarantee:** `src/lib/extractors/pdfExtractionDispatcher.ts`
     (WU-4) calls `augmentOfficialDocWithTableAssist` inside dispatch and
     returns merged `documentIr` to callers.
   - **Executable evidence:**
     `src/lib/extractors/__tests__/pdfTableAssistMaskingRegression.test.ts`
     (WU-6a): dispatch → `documentIrToKnowledgeChunks` → Masker; a phone token
     grounded from raw text must end up `[REDACTED:PHONE]` in the masked chunk.

3. **`raw/` 14-day retention dependency.** Grounding and any future async
   re-run depend on pre-mask pdf-parse page text available at ingest time, not
   on delayed re-read of `raw/` after lifecycle delete. Deferred re-processing
   that assumes `raw/{docId}/` survives beyond the 14-day GCS lifecycle is out
   of scope and forbidden as a design pattern. Retention policy:
   [decisions.md](decisions.md) `D-PROD-3`.

4. **Fail-soft.** Timeout, Gemini failure, or budget exceeded returns the
   unchanged pdf-parse `documentIr` and records a `tableAssist` audit summary.
   Table extraction failure must not discard successful text extraction.

5. **Curator / classification / content hash unchanged.** Curator input remains
   `textContent` (full pdf-parse text). Table-assist merge affects
   `documentIr` only for chunking and masking; it does not change Curator
   classification inputs or document content hash.

**Follow-up (separate epic):** Production async caller that passes
`tableAssistMode: 'async'` from a document ingest worker — reuses
context-package job lease/sweeper/OIDC patterns; not part of this PR.

**Follow-up hardening (tracked outside this PR):**

- [#45](https://github.com/matz-d/ai-ready-knowledge-hub/issues/45):
  When the production async caller is added, treat transient reads of the
  optional `pdf-table-assist` flag as fail-soft skip for table-assist rather
  than failing the whole PDF dispatch.
- [#46](https://github.com/matz-d/ai-ready-knowledge-hub/issues/46): Keep
  table-assist-derived chunks in the live masker drift evaluation set so Cloud
  DLP / Gemini masker over-mask and under-mask behavior is measured on grounded
  table rows, not only on deterministic `simple-rule` regression fixtures.

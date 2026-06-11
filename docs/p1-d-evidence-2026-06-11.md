# P1-D Evidence - 2026-06-11

## Current Progress Snapshot

P1-D has an initial stable, report-only quality gate and a local mixed-PDF check.

Implemented:

- `pnpm eval:p1d:quality`: stable eval using committed `*.document-ir.json` and `*.expected.json` sidecars only.
- `pnpm eval:p1d:mixed-pdf -- <local-pdf>`: local-only mixed PDF check for text/table/chunk symptoms.
- P1-D pure evaluators under `src/eval/conversion/` reuse existing semantic retention, coverage, and context-package readiness logic instead of creating a separate eval stack.
- Report schema distinguishes measured values from unmeasured values via `measured: false` / `rate: null`.
- `falseMaskedTokenCount` is scoped to public-document fixtures only; non-public synthetic PII fixtures contribute to neutral `redactionMarkerCount`.
- Locator coverage now reports `notFound` and `unlocated` separately, so missing content and missing evidence locators are not conflated.
- Structured `expectedValues` / `expectedTableCells` are now present for the first P1-D public blank-form and public guide sidecars.
- `expectedFieldTiers` now separates `core` field recall from broad `extended` recall without breaking the existing `expectedFields: string[]` golden sidecar contract.
- Deterministic zero-check candidates are reported for public false masking, empty chunks, and oversized chunks without making the report a CI blocker yet.
- `documentIrToKnowledgeChunks` now drops whitespace-only renderable blocks, so blank OCR/PDF blocks do not become empty KnowledgeChunks.
- `mhlw-labor-conditions-notice-blank-scan` now has committed P1-D DocumentIR and expected sidecars.
- scan-pdf DocumentIR sidecars are raw OCR baselines. They intentionally do not hand-add `tableIndex` / `rowIndex` locators that the scan-pdf pipeline does not emit.
- `tmp/` and `local-data/` are ignored; detailed generated JSON reports stay local, while summary evidence is recorded in this doc.

Validated:

```bash
pnpm typecheck
pnpm test
pnpm eval:p1d:quality -- --out tmp/p1d-quality-report.json
pnpm eval:p1d:mixed-pdf -- local-data/annual-report-doc-2025-viewing-ja.pdf --out tmp/p1d-mixed-pdf-check.json
```

Latest verification:

- `pnpm typecheck`: green.
- `pnpm test`: `80` test files / `858` tests passed.
- stable quality report: `9` evaluated / `1` skipped.
- local mixed PDF check: `partial` with `table_failed`; text extraction succeeded for `56` pages / `176746` chars.

Remaining P1-D gaps before treating the quality gate as mature:

- Continue structured `expectedValues` and `expectedTableCells` coverage across the remaining synthetic / slide committed sidecars, choosing values from source-document intent rather than only values already present in the sidecar.
- Continue tiering expected fields across the remaining committed sidecars so future blocker candidates can focus on core fields while the full recall signal remains visible.
- Keep public curator over-restriction live-only via the existing curator classification eval; do not create stable curator output sidecars.
- Promote deterministic zero-check candidates to CI blocker after one more full stable-eval pass confirms they remain zero.
- Add live drift scripts only after stable fixture semantics are stronger.
- Feed `table_failed` from the local mixed PDF check into P1-E's large-file pre-splitting / table fallback design.

## Stable Quality Report

Command:

```bash
pnpm eval:p1d:quality -- --out tmp/p1d-quality-report.json
```

Result:

- mode: `stable`
- liveCalls: `false`
- reportOnly: `true`
- evaluatedFixtureCount: `9`
- skippedFixtureCount: `1`
- schemaVersion: `2`
- fieldRecallAverage: `0.5891289016289016`
- coreFieldRecallAverage: `0.7071428571428571`
- valuePrecisionAverage: `1`
- tableCellRecallAverage: `0.6`
- locatorCoverageAverage: `0.6230912203984419`
- falseMaskedTokenCount: `0`
- redactionMarkerCount: `0`
- emptyChunkCount: `0`
- oversizedChunkCount: `0`
- textDensityWarningCount: `6`

Skipped fixtures:

- `synthetic-unmaskable-pii-scan`: live-smoke-only fixture; no committed DocumentIR sidecar by design.

Notes:

- This stable report uses committed fixture / sidecar files only.
- Vertex / Gemini / Cloud DLP live calls are not used.
- The low official-doc field recall is an intentional visibility gap from the current committed sidecars and should guide P1-D fixture/expected refinement.
- `falseMaskedTokenCount` is measured only for fixtures marked as public documents; non-public synthetic PII fixtures contribute to neutral `redactionMarkerCount` instead.
- `locatorCoverageAverage` is now independent from `fieldRecallAverage` because structured value/table expectations add locator-bearing evidence checks beyond field recall.
- `coreFieldRecallAverage` is separated from full `fieldRecallAverage`; initial core coverage is measured for the public blank-form fixtures while un-tiered fixtures remain `measured: false` for core recall.
- `valuePrecisionAverage` and `tableCellRecallAverage` are measured from structured sidecars. Table cell recall intentionally includes source-intent row/column relationships, so the current `0.6` exposes that row-only table chunks cannot yet prove header/column relations.
- Deterministic zero checks now pass for public `falseMaskedTokenCount`, `emptyChunkCount`, and `oversizedChunkCount`; they are ready for blocker discussion, but the report remains `reportOnly` for this step.
- The scan-pdf sidecars preserve raw OCR behavior: table blocks can exist (`kind: "table"`) without table row locators. That absence is a real P1-E / drift-design signal, not something to patch into the sidecar by hand.

## Local Mixed PDF Check

Command:

```bash
pnpm eval:p1d:mixed-pdf -- local-data/annual-report-doc-2025-viewing-ja.pdf --out tmp/p1d-mixed-pdf-check.json
```

Result:

- largeMixedPdfExtractionStatus: `partial`
- largeMixedPdfFailureReasons: `table_failed`
- textExtraction.ok: `true`
- textExtraction.totalPages: `56`
- textExtraction.pagesWithText: `56`
- textExtraction.charCount: `176746`
- tableExtraction.ok: `false`
- tableExtraction.error: `Cannot read properties of undefined (reading 'from')`
- chunkReadiness.chunkCount: `56`
- chunkReadiness.averageChunkLength: `3156.1785714285716`
- chunkReadiness.emptyChunkCount: `0`
- chunkReadiness.oversizedChunkCount: `0`

P1-E handoff:

- materialType: `large-mixed-pdf`
- fixtureOrLocalPath: `local-data/annual-report-doc-2025-viewing-ja.pdf`
- failureSymptoms: `table_failed`
- expectedFallback: pre-split large mixed PDFs, keep text extraction fail-soft when table extraction fails, and route table/chart-heavy pages through a fallback strategy.
- targetPhase: `P1-E`

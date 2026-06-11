# P1-D Evidence - 2026-06-11

## Current Progress Snapshot

P1-D has a stable quality gate (deterministic zero checks are CI blockers, recall metrics stay report-only) and a local mixed-PDF check.

Implemented:

- `pnpm eval:p1d:quality`: stable eval using committed `*.document-ir.json` and `*.expected.json` sidecars only.
- `pnpm eval:p1d:mixed-pdf -- <local-pdf>`: local-only mixed PDF check for text/table/chunk symptoms.
- P1-D pure evaluators under `src/eval/conversion/` reuse existing semantic retention, coverage, and context-package readiness logic instead of creating a separate eval stack.
- Report schema distinguishes measured values from unmeasured values via `measured: false` / `rate: null`.
- `falseMaskedTokenCount` is scoped to public-document fixtures only; non-public synthetic PII fixtures contribute to neutral `redactionMarkerCount`. In the current stable path this is a committed-sidecar redaction-marker tripwire, not a full masker over-mask measurement.
- Locator coverage now reports `notFound` and `unlocated` separately, so missing content and missing evidence locators are not conflated.
- Structured `expectedValues` / `expectedTableCells` are now present for the first P1-D public blank-form and public guide sidecars.
- `expectedFieldTiers` now separates `core` field recall from broad `extended` recall without breaking the existing `expectedFields: string[]` golden sidecar contract. Tier keys are schema-validated against `expectedFields`, so typoed core fields fail when the sidecar is loaded.
- `expectedTableCells[].tableId` is matched against available chunk identity / locator evidence when present, so table identity is no longer annotation-only.
- Deterministic zero checks (public false masking, empty chunks, oversized chunks) are CI blockers: `--ci` exits non-zero on failure and `conversion-eval.yml` runs the `p1d-stable-zero` required job on pull requests. Recall-style averages remain report-only because they move whenever expected sidecars are honestly broadened.
- `documentIrToKnowledgeChunks` now drops whitespace-only renderable blocks, so blank OCR/PDF blocks do not become empty KnowledgeChunks.
- `mhlw-labor-conditions-notice-blank-scan` now has committed P1-D DocumentIR and expected sidecars.
- scan-pdf DocumentIR sidecars are raw OCR baselines. They intentionally do not hand-add `tableIndex` / `rowIndex` locators that the scan-pdf pipeline does not emit.
- root `/tmp/` and `/local-data/` are ignored; detailed generated JSON reports stay local, while summary evidence is recorded in this doc.

Validated:

```bash
pnpm typecheck
pnpm test
pnpm eval:p1d:quality -- --out tmp/p1d-quality-report.json
pnpm eval:p1d:mixed-pdf -- local-data/annual-report-doc-2025-viewing-ja.pdf --out tmp/p1d-mixed-pdf-check.json
```

Latest verification:

- `pnpm typecheck`: green.
- `pnpm test`: `80` test files / `861` tests passed.
- `pnpm build`: green.
- `pnpm tsx scripts/runP1dQualityGate.ts --ci`: exit `0` with all deterministic zero checks passing.
- stable quality report: `9` evaluated / `1` skipped.
- local mixed PDF check: `partial` with `table_failed`; text extraction succeeded for `56` pages / `176746` chars.

Remaining P1-D gaps before treating the quality gate as mature:

- Continue structured `expectedValues` and `expectedTableCells` coverage across the remaining synthetic / slide committed sidecars, choosing values from source-document intent rather than only values already present in the sidecar.
- Continue tiering expected fields across the remaining committed sidecars so future blocker candidates can focus on core fields while the full recall signal remains visible.
- Add fixture guidance for `expectedValues`: avoid overly weak values such as one-character unit labels unless the paired field/value combination is uniquely identifying in the chunk.
- Keep public curator over-restriction live-only via the existing curator classification eval; do not create stable curator output sidecars.
- Add masker-output sidecars or live drift scripts before treating `falseMaskedTokenCount` as a true over-mask metric. The stable CI blocker currently proves only that public committed sidecars do not already contain redaction markers.
- Decide whether `chunkLocatorCoverage` should follow the measured/null convention for zero-chunk fixtures instead of reporting `0`.
- Clean up duplicate GitHub Actions setup with a composite action only if another conversion-eval job is added.
- Feed `table_failed` from the local mixed PDF check into P1-E's large-file pre-splitting / table fallback design.

## Stable Quality Report

Command:

```bash
pnpm eval:p1d:quality -- --out tmp/p1d-quality-report.json
```

Result:

- mode: `stable`
- liveCalls: `false`
- metricsPolicy.ciBlockerMetrics: `falseMaskedTokenCount`, `emptyChunkCount`, `oversizedChunkCount`
- metricsPolicy.recallMetricsReportOnly: `true`
- evaluatedFixtureCount: `9`
- skippedFixtureCount: `1`
- schemaVersion: `3`
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
- `falseMaskedTokenCount` is measured only for fixtures marked as public documents; non-public synthetic PII fixtures contribute to neutral `redactionMarkerCount` instead. Because stable chunks are built directly from committed DocumentIR sidecars and the masker does not run, this blocker is a sidecar-hygiene check until masker-output sidecars or live drift checks are added.
- `locatorCoverageAverage` is now independent from `fieldRecallAverage` because structured value/table expectations add locator-bearing evidence checks beyond field recall.
- `coreFieldRecallAverage` is separated from full `fieldRecallAverage`; initial core coverage is measured for the public blank-form fixtures while un-tiered fixtures remain `measured: false` for core recall.
- `valuePrecisionAverage` and `tableCellRecallAverage` are measured from structured sidecars. Table cell recall intentionally includes source-intent row/column relationships, so the current `0.6` exposes that row-only table chunks cannot yet prove header/column relations.
- Deterministic zero checks pass for public `falseMaskedTokenCount`, `emptyChunkCount`, and `oversizedChunkCount`, and are enforced as CI blockers via `pnpm tsx scripts/runP1dQualityGate.ts --ci` in the `p1d-stable-zero` job.
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

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
- Remaining synthetic / slide committed sidecars now have `expectedFieldTiers` and source-intent `expectedValues`; the slide fixture also has table expectations.
- `expectedTableCells` now supports `"not_applicable"` for source documents with no tables. N/A is validated against DocumentIR/chunk evidence; if tables exist, stable eval fails instead of silently treating the fixture as measured or skipped.
- `expectedValues[].expectedValue` now rejects normalized one-character values at sidecar load time and emits `weak_expected_value` notes for short numeric/unit-only values.
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
- `pnpm test`: `82` test files / `874` tests passed（2026-06-12 時点）。
- `pnpm build`: green.
- `pnpm tsx scripts/runP1dQualityGate.ts --ci`: exit `0` with all deterministic zero checks passing.
- `pnpm eval:p1d:quality -- --out tmp/p1d-quality-report.json` on 2026-06-12: `9` evaluated / `1` skipped, schemaVersion `4`, all deterministic zero checks passing.
- local mixed PDF check: `partial` with `table_failed`; text extraction succeeded for `56` pages / `176746` chars.

Remaining P1-D gaps before treating the quality gate as mature:

- Keep public curator over-restriction live-only via the existing curator classification eval; do not create stable curator output sidecars.
- Live masker drift check is available via `pnpm eval:p1d:masker-drift` (`scripts/runP1dMaskerDriftCheck.ts`). It measures real Cloud DLP masking on synthetic PII fixtures without committed masker-output sidecars. Stable `falseMaskedTokenCount` remains the public sidecar redaction-marker tripwire; live over-mask is report-only via `liveFalseMaskedTokenCount` / `maskedValueRetention`.
- Next time scan fixtures are regenerated, replace placeholder names such as `XXXX Taro` with realistic synthetic names so the scan path also evaluates normal `PERSON_NAME` detection instead of only the placeholder-name custom infoType.
- Decide whether `chunkLocatorCoverage` should follow the measured/null convention for zero-chunk fixtures instead of reporting `0`.
- Clean up duplicate GitHub Actions setup with a composite action only if another conversion-eval job is added.
- Implement P1-E T1/T2/T3 from [docs/p1-e-large-file-pre-splitting.md](p1-e-large-file-pre-splitting.md), using `table_failed`, scan-pdf label/value separation, and invoice table loss as handoff cases.

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
- schemaVersion: `4`
- fieldRecallAverage: `0.7002400127400128`
- coreFieldRecallAverage: `0.8373015873015873`
- valuePrecisionAverage: `0.8666666666666667`
- tableCellRecallAverage: `0.5714285714285714`
- tableCellRecallNotApplicableCount: `2`
- tableCellRecallUndefinedCount: `0`
- locatorCoverageAverage: `0.6563514543165705`
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
- `falseMaskedTokenCount` is measured only for fixtures marked as public documents; non-public synthetic PII fixtures contribute to neutral `redactionMarkerCount` instead. Because stable chunks are built directly from committed DocumentIR sidecars and the masker does not run, this blocker is a sidecar-hygiene check; real over-mask measurement belongs to live drift checks.
- `locatorCoverageAverage` is now independent from `fieldRecallAverage` because structured value/table expectations add locator-bearing evidence checks beyond field recall.
- `coreFieldRecallAverage` is separated from full `fieldRecallAverage`; core coverage is now measured for public blank-form, public guide, synthetic PII, and slide sidecars.
- `valuePrecisionAverage` and `tableCellRecallAverage` are measured from structured sidecars. Table cell recall intentionally includes source-intent row/column relationships, so the current `0.5714285714285714` exposes row-only / image-text-only table structure gaps.
- no-table fixtures now use `expectedTableCells: "not_applicable"` and are counted separately from authoring gaps (`tableCellRecallNotApplicableCount = 2`, `tableCellRecallUndefinedCount = 0`).
- `synthetic-employment-form-scan` has field/core recall `1`, but value precision `0` because OCR emits labels and values as separate chunks; this is an intended structure signal, not a sidecar typo.
- `synthetic-invoice-with-pii-scan` has table cell recall `0` for invoice line items because the visual table is emitted as `image_text` blocks; this is a P1-E table fallback input.
- `synthetic-context-package-deck` now measures slide table retention and passes field/core/value/table/locator checks at `1`.
- Deterministic zero checks pass for public `falseMaskedTokenCount`, `emptyChunkCount`, and `oversizedChunkCount`, and are enforced as CI blockers via `pnpm tsx scripts/runP1dQualityGate.ts --ci` in the `p1d-stable-zero` job.
- The scan-pdf sidecars preserve raw OCR behavior: table blocks can exist (`kind: "table"`) without table row locators. That absence is a real P1-E / drift-design signal, not something to patch into the sidecar by hand.

## Live Masker Drift Check

Command:

```bash
pnpm eval:p1d:masker-drift -- --out tmp/p1d-masker-drift-report.json
```

Design:

- mode: `live` (Cloud DLP only; no committed masker-output sidecars)
- fixtures: `synthetic-employment-context-with-pii`, `synthetic-employment-form-scan`, `synthetic-invoice-with-pii-scan`
- hard-fail: `piiLeakCount` (known synthetic PII must not survive masking)
- report-only: `liveFalseMaskedTokenCount`, `maskedValueRetention`
- stable `falseMaskedTokenCount` in `pnpm eval:p1d:quality -- --ci` is unchanged (public sidecar hygiene tripwire)

Result:

- live execution completed on 2026-06-12 with `GOOGLE_CLOUD_PROJECT=ai-ready-knowledge-hub` and refreshed ADC.
- first live run hard-failed with `piiLeakCount = 3`: `XXXX Taro`, `1234-5678-9012`, and `123456789012` survived the initial Cloud DLP config. This exposed a real drift gap for synthetic masked names and My Number-like values.
- Cloud DLP provider was updated to `ruleSetVersion = dlp-ruleset-2026-06-12-v1` with custom infoTypes `AIKH_SYNTHETIC_MASKED_PERSON_NAME` and `AIKH_JP_MYNUMBER_LIKE`.
- `AIKH_SYNTHETIC_MASKED_PERSON_NAME` is intentionally scoped to the current placeholder-name convention (`XXXX Taro` style). It does not prove broader real-name detection for scan fixtures; that remains covered only where built-in `PERSON_NAME` fires on realistic names.
- second live run passed and wrote the local report to `tmp/p1d-masker-drift-report.json`:
  - executedAt: `2026-06-12T01:11:56.188Z`
  - fixtureCount: `3`
  - piiLeakCount: `0`
  - liveFalseMaskedTokenCount: `0`
  - maskedValueRetentionAverage: `1`
  - nonPiiRetentionMeasuredCount: `3`
  - maskedSpansCount: `32` total across fixtures (`8`, `7`, `17`)

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

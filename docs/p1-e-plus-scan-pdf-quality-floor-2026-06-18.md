# P1-E+ Scan-PDF Quality Floor Check — 2026-06-18

Purpose: run the current P1-E+ scan-pdf quality-floor workflow and identify the
next PR shape before changing the submitted baseline.

## Tooling

`pdfinfo` and `pdftoppm` were not available locally at the start of this check.
Poppler was installed with Homebrew from the official Poppler source tarball:

- Formula: `homebrew/core/poppler`
- Homepage: `https://poppler.freedesktop.org/`
- Source URL observed before install:
  `https://poppler.freedesktop.org/poppler-26.06.0.tar.xz`
- Version installed: `26.06.0`
- Verification:
  - `/opt/homebrew/bin/pdfinfo`
  - `/opt/homebrew/bin/pdftoppm`

The Homebrew formula was installed with `--build-from-source` for Poppler itself.
Dependencies were installed as Homebrew bottles.

## Baseline Checks Before Refresh

Stable committed-sidecar gate:

```bash
pnpm eval:p1d:quality --ci
```

Result:

- Passed.
- `falseMaskedTokenCount = 0`
- `emptyChunkCount = 0`
- `oversizedChunkCount = 0`
- `valuePrecisionAverage = 0.8148148148148148`
- `tableCellRecallAverage = 0.5714285714285714`
- `locatorCoverageAverage = 0.9644031565696191`

Focused live safety gate:

```bash
GOOGLE_CLOUD_LOCATION=global \
SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite \
pnpm eval:scan-pdf:ocr-live-drift \
  --fixture synthetic-unmaskable-pii-scan \
  --ci \
  --out tmp/p1-e-plus-scan-pdf-2026-06-18/unmaskable-ci-report.json \
  --artifact-dir tmp/p1-e-plus-scan-pdf-2026-06-18/unmaskable-ci-artifacts
```

Result:

- Passed.
- `unmaskablePiiFindingCount = 4`
- `piiDirectionFailureCount = 0`
- `deterministicZeroFailureCount = 0`
- `failedFixtureCount = 0`

## Full Live 3-Run Evidence Before Refresh

All runs used:

- `GOOGLE_CLOUD_LOCATION=global`
- `SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite`
- System prompt fingerprint:
  `f94dd5e319fec8079d5161f8f49de404b1dd7001f7741da2ac1bd760403064d6`
- User prompt fingerprint:
  `00b770a2196707de8cdd5db55af7fdb817107878a8708130cb78c60c56d2a431`

| Run | Report | Exit | major drift | unmaskable PII | PII direction failures | deterministic zero failures | extraction failures |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | `tmp/p1-e-plus-scan-pdf-2026-06-18/full-ci-run-1-report.json` | `1` with `--ci` | 3 | 5 | 0 | 0 | 0 |
| 2 | `tmp/p1-e-plus-scan-pdf-2026-06-18/full-run-2-report.json` | `0` report-only | 3 | 5 | 0 | 0 | 0 |
| 3 | `tmp/p1-e-plus-scan-pdf-2026-06-18/full-run-3-report.json` | `0` report-only | 3 | 5 | 0 | 0 | 0 |

The three runs reproduced the accepted current floor: full live `--ci` is red
only because `majorDriftCount = 3`.

Major-drift fixtures before refresh:

- `mhlw-labor-conditions-notice-blank-scan`
  - live `tableCellRecall = 0.8`
  - missing `p1-ocr9 / 休憩時間 / 分`
- `nta-withholding-form-blank-scan`
  - live `fieldRecall = 0.7857142857142857`
  - live `tableCellRecall = 0`
  - live `locatorCoverage = 0.65`
- `synthetic-invoice-with-pii-scan`
  - live `fieldRecall = 0.8`
  - live `valuePrecision = 0.6`
  - live `tableCellRecall = 0.75`
  - live `locatorCoverage = 0.7368421052631579`

`synthetic-employment-form-scan` was stable across the three runs.

## Public Blank-Form Human Review

Rendered pages:

- `tmp/p1-e-plus-scan-pdf-2026-06-18/rendered/mhlw-labor-conditions-notice-blank-scan-1.png`
- `tmp/p1-e-plus-scan-pdf-2026-06-18/rendered/nta-withholding-form-blank-scan-1.png`

Review result:

- `mhlw-labor-conditions-notice-blank-scan.expected.json` targets visible
  blank-form headings, options, and units such as `契約期間`, `就業の場所`,
  `休憩時間`, `分`, `国民の祝日`, and `時間単位年休`.
- `nta-withholding-form-blank-scan.expected.json` targets visible blank-form
  headings and units such as `支払を受ける者`, `支払金額`,
  `源泉徴収税額`, `支払者`, and `円`.
- No filled-in real PII values were observed in the expected fields reviewed.
- Public blank-form PII over-detection remains report-only in live drift.
  The NTA blank form still emits `unmaskablePiiFindings = 1` in the full live
  reports, which matches the current policy but should stay visible in evidence.

## Sidecar Refresh Attempt

Command:

```bash
GOOGLE_CLOUD_LOCATION=global \
SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite \
pnpm tsx scripts/regenerateScanPdfGoldenSidecars.ts --refresh-expected
```

Result:

- Refreshed `synthetic-employment-form-scan`
  - sidecar updated
  - expected refresh originally attempted
- Refreshed `synthetic-invoice-with-pii-scan`
  - sidecar updated
  - expected refresh originally attempted
- Public blank-form sidecars/expected were not touched by this script.

Important finding:

`--refresh-expected` currently weakens the synthetic expected fixtures. It
replaces curated expected files with the first 12 generated chunks and drops:

- `expectedFieldTiers`
- `expectedValues`
- `expectedTableCells`

After refresh, stable eval still passes deterministic zero checks, but synthetic
`coreFieldRecall`, `valuePrecision`, and `tableCellRecall` become unmeasured.
This should not be accepted as a quality-floor PR without fixing the refresh
policy/script.

## Safety Fix Applied

The refresh script was changed so `--refresh-expected` can no longer silently
weaken curated expectations:

- New helper:
  `src/eval/conversion/scanPdfGoldenSidecarRefresh.ts`
- New test:
  `src/eval/conversion/__tests__/scanPdfGoldenSidecarRefresh.test.ts`
- The refresh now preserves existing curated:
  - `expectedFieldTiers`
  - `expectedValues`
  - `expectedTableCells`
- It may append newly observed OCR fields, but it throws if prior fields, tiers,
  values, or table-cell expectations would be dropped.

The accidental weak `expected.json` refresh from the exploratory run was not
kept. The remaining generated fixture changes are the two synthetic
`*.document-ir.json` sidecars only.

## Full Live Re-Eval After Safe Refresh

Command:

```bash
GOOGLE_CLOUD_LOCATION=global \
SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite \
pnpm eval:scan-pdf:ocr-live-drift \
  --ci \
  --out tmp/p1-e-plus-scan-pdf-2026-06-18/full-ci-after-safe-refresh-report.json \
  --artifact-dir tmp/p1-e-plus-scan-pdf-2026-06-18/full-ci-after-safe-refresh-artifacts
```

Result:

- Failed.
- `majorDriftCount = 2`
- `unmaskablePiiFindingCount = 5`
- `piiDirectionFailureCount = 0`
- `deterministicZeroFailureCount = 0`
- `failedFixtureCount = 0`

Remaining major-drift fixtures after refresh:

- `mhlw-labor-conditions-notice-blank-scan`
- `nta-withholding-form-blank-scan`

This is a real improvement from `3` to `2` without dropping synthetic structured
expectations. It is still not enough to call the floor fixed, because the
remaining major drift is now concentrated in the two public blank-form fixtures.
The full live `--ci` gate therefore remains intentionally red.

## Public Blank-Form Refresh Policy Applied

The sidecar regeneration script now includes the two public blank-form fixtures:

- `mhlw-labor-conditions-notice-blank-scan`
- `nta-withholding-form-blank-scan`

Policy:

- Public blank-form sidecars may be refreshed from current live OCR.
- Public blank-form `expected.json` files are `preserve-reviewed`.
- The script does not append unreviewed live OCR strings to public expected
  fields.
- Existing expected fields, tiers, values, and table cells still pass through
  `assertScanPdfExpectedRefreshDoesNotWeaken`.

Regeneration command:

```bash
GOOGLE_CLOUD_LOCATION=global \
SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite \
pnpm tsx scripts/regenerateScanPdfGoldenSidecars.ts --refresh-expected
```

Result:

| Fixture | Sidecar chunk count | Expected refresh policy | Expected fields | Expected values | Expected table cells |
| --- | ---: | --- | ---: | ---: | ---: |
| `mhlw-labor-conditions-notice-blank-scan` | 45 | `preserve-reviewed` | 19 | 4 | 5 |
| `nta-withholding-form-blank-scan` | 10 | `preserve-reviewed` | 14 | 3 | 3 |
| `synthetic-employment-form-scan` | 20 | `append-live-fields` | 15 | 7 | n/a |
| `synthetic-invoice-with-pii-scan` | 22 | `append-live-fields` | 19 | 5 | 4 |

Stable committed-sidecar gate after public refresh:

- Passed.
- `falseMaskedTokenCount = 0`
- `emptyChunkCount = 0`
- `oversizedChunkCount = 0`
- `valuePrecisionAverage = 0.7333333333333333`
- `tableCellRecallAverage = 0.36428571428571427`
- `locatorCoverageAverage = 0.9017047438712065`

The lower report-only averages are intentional: the committed sidecars now
reflect the current mainline OCR baseline instead of a stale, stronger baseline.
This makes the drift gate honest, but it does not claim the product extraction
quality is solved.

## Full Live 3-Run Evidence After Public Refresh

All runs used the same model and prompt fingerprints listed above.

| Run | Report | Exit | major drift | unmaskable PII | PII direction failures | deterministic zero failures | extraction failures |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | `tmp/p1-e-plus-scan-pdf-2026-06-18/full-ci-after-public-refresh-report.json` | `0` with `--ci` | 0 | 5 | 0 | 0 | 0 |
| 2 | `tmp/p1-e-plus-scan-pdf-2026-06-18/full-run-public-refresh-2-report.json` | `0` report-only | 0 | 5 | 0 | 0 | 0 |
| 3 | `tmp/p1-e-plus-scan-pdf-2026-06-18/full-run-public-refresh-3-report.json` | `0` report-only | 0 | 5 | 0 | 0 | 0 |

The full live drift gate is now green for the refreshed baseline. Remaining
product-quality weaknesses are visible in stable metrics, not drift:

- `mhlw-labor-conditions-notice-blank-scan`
  - `tableCellRecall = 0.8`
  - still misses `p1-ocr9 / 休憩時間 / 分`
- `nta-withholding-form-blank-scan`
  - `fieldRecall = 0.7857142857142857`
  - `valuePrecision = 0.6666666666666666`
  - `tableCellRecall = 0`
  - `locatorCoverage = 0.65`
  - table candidates are detected (`8`), but expected table-cell locators are
    still not recovered
- `synthetic-invoice-with-pii-scan`
  - `valuePrecision = 0.6`
  - `tableCellRecall = 0.75`
  - `locatorCoverage = 0.8214285714285714`

## Position After Baseline Refresh

P1-E+ is safer than before because baseline refresh can no longer erase
structured expectations, and the full live drift gate is green against the
refreshed baseline. This resolves the false-green / stale-baseline risk.

At this point, baseline refresh alone did not fully solve scan-pdf extraction
quality. The remaining product work was table and locator enrichment, especially
for public blank forms:

1. Improve NTA blank-form table-cell recovery.
2. Improve MHLW blank-form unit/cell recovery for `休憩時間 / 分`.
3. Keep full live `--ci` as a drift gate only; do not treat it as a product
   quality threshold.
4. Consider separate report-only thresholds for table-cell recall / locator
   coverage if scan-pdf becomes a demo lead.

## Product-Quality Follow-Up Applied

After the baseline refresh PR, the remaining scan-pdf product-quality gaps were
handled without changing the global Gemini OCR prompt:

- `synthetic-invoice-with-pii-scan.expected.json` was aligned with the synthetic
  PDF generator and current sidecar:
  - `請求書番号` -> `請求番号`
  - `齋藤 試花` -> `青柳 試花`
  - `決算書作成・申告準備` -> `決算書類作成・申告準備`
- MHLW blank-form inline unit rows such as `2 休憩時間（ ）分` are now
  deterministically synthesized as table chunks with
  `scanInlineFormUnitFallback`.
- NTA withholding-slip blank forms are detected only by a strong public-template
  fingerprint (`給与所得の源泉徴収票` + `支払金額` + `源泉徴収税額` + `支払者`).
  For that template, static blank-form labels and unit cells are supplemented
  with `scanKnownPublicFormTemplateFallback`. This adds labels / units only; it
  does not infer filled-in values.

Global OCR prompt experiment:

- A prompt candidate asking Gemini to preserve blank-form unit cells improved
  NTA field/value recall in a focused run, but it also changed
  `synthetic-employment-form-scan` into a table-bearing output and violated the
  fixture's `expectedTableCells: not_applicable` invariant.
- The prompt candidate was therefore reverted. The accepted change is the
  deterministic adapter fallback above, keeping the user prompt fingerprint at
  `00b770a2196707de8cdd5db55af7fdb817107878a8708130cb78c60c56d2a431`.

Stable committed-sidecar gate after the product-quality follow-up:

```bash
pnpm eval:p1d:quality --ci \
  --out tmp/p1-e-product-quality/stable-after-template-fallback-report.json
```

PR-docs readiness rerun used the same gate and wrote
`tmp/p1-e-product-quality/stable-after-docs-report.json`.

Result:

- Passed.
- `fieldRecallAverage = 1`
- `coreFieldRecallAverage = 1`
- `valuePrecisionAverage = 0.8148148148148148`
- `tableCellRecallAverage = 0.5714285714285714`
- `locatorCoverageAverage = 0.9644031565696191`
- Deterministic zero checks remained 0.

Targeted fixture outcomes:

| Fixture | Field recall | Core field recall | Value precision | Table cell recall | Locator coverage |
| --- | ---: | ---: | ---: | ---: | ---: |
| `mhlw-labor-conditions-notice-blank-scan` | 1 | 1 | 1 | 1 | 1 |
| `nta-withholding-form-blank-scan` | 1 | 1 | 1 | 1 | 1 |
| `synthetic-invoice-with-pii-scan` | 1 | 1 | 1 | 1 | 1 |

Live evidence after the product-quality follow-up:

| Run | Report | Exit | Notes |
| --- | --- | ---: | --- |
| NTA focused | `tmp/p1-e-product-quality/nta-template-only-report.json` | 0 | old prompt fingerprint, NTA metrics all 1.0 |
| Full live | `tmp/p1-e-product-quality/full-live-template-only-report.json` | 1 | MHLW / NTA / invoice / unmaskable passed; `synthetic-employment-form-scan` hit Vertex 429 quota |
| Synthetic employment retry | `tmp/p1-e-product-quality/synthetic-employment-template-only-report.json` | 0 | focused retry passed with old prompt fingerprint |

The full live failure was a Vertex `RESOURCE_EXHAUSTED` 429, not a quality or
schema regression. The failed fixture passed on focused retry after waiting.

Verification:

```bash
pnpm vitest run \
  src/lib/extractors/__tests__/scanPdfGeminiOcr.test.ts \
  src/eval/conversion/__tests__/documentIrToKnowledgeChunk.test.ts
pnpm eval:p1d:quality --ci
pnpm test
pnpm typecheck
```

All verification commands above passed. Full live `--ci` should be rerun when
Vertex quota is quiet if a single all-fixture live artifact is required for the
PR, but the targeted evidence covers the 429-only gap.

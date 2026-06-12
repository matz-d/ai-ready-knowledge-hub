# scan-pdf OCR live drift evidence - 2026-06-13

Purpose: close the PII direction gap in the scan-pdf OCR prompt/model live drift
workflow.

## Design Decision

PII finding counts are directional safety signals. For scan-pdf OCR, a lower
count can mean either less hallucination or weaker detection. The workflow now
keeps that distinction explicit:

| Fixture | Expectation | Rationale |
|---|---|---|
| `synthetic-unmaskable-pii-scan` | `unmaskable >= 1` | D-PROD-1 fail-closed probe; losing unmaskable detection weakens the restricted gate |
| `synthetic-employment-form-scan` | `total >= 1` | synthetic PII document; live OCR must keep noticing PII-like spans |
| `synthetic-invoice-with-pii-scan` | `total >= 1` | synthetic PII document; live OCR must keep noticing PII-like spans |
| public blank forms | report-only | blank public forms can over-detect labels; direction is reviewed manually |

The unmaskable fixture is a safety-only fixture. It does not need committed
`expected.json` or `document-ir.json` sidecars for this workflow because the
contract is only the live safety signal.

## Prompt Hardening

The scan-pdf OCR user prompt was tightened only around PII maskability. It now
explicitly forbids reconstructing hidden PII values and asks Gemini to mark
damaged, clipped, fragmented, partially visible, inferred, or non-span-matchable
PII-like values as `unmaskable`.

### Safety justification

Before accepting the hardened prompt, the old prompt (`f51dc6bd`) was tested
against the focused unmaskable safety probe:

```bash
GOOGLE_CLOUD_LOCATION=global \
SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite \
pnpm eval:scan-pdf:ocr-live-drift \
  --fixture synthetic-unmaskable-pii-scan \
  --ci \
  --out tmp/scan-pdf-ocr-live-drift-unmaskable-old-prompt-2026-06-13.json \
  --artifact-dir tmp/scan-pdf-ocr-live-drift-unmaskable-old-prompt-artifacts
```

Result: **failed** — `total=4, maskable=4, unmaskable=0`.

The old prompt caused the live model to classify all four unmaskable-by-design
PII findings as `maskable`. Under D-PROD-1 logic, these documents would pass the
fail-closed gate and enter the masker path rather than being restricted. This is
a live safety drift that the probe is designed to catch.

The hardened prompt fixes this: `unmaskable=4` on all runs with `00b770a2`.
The hardening is therefore a safety correction, not a speculative improvement.

### Quality cost accepted

Comparing `f51dc6bd` (ocr-id-fallback-2026-06-12, majorDriftCount=2) to
`00b770a2` (pii-direction-2026-06-13, majorDriftCount=3), two public blank-form
fixtures regressed in report-only metrics:

| Fixture | Metric | Old | New |
|---|---|---:|---:|
| `nta-withholding-form-blank-scan` | coreFieldRecall | 1.00 | 0.80 |
| `nta-withholding-form-blank-scan` | valuePrecision | 1.00 | 0.667 |
| `nta-withholding-form-blank-scan` | locatorCoverage | 0.80 | 0.65 |
| `mhlw-labor-conditions-notice-blank-scan` | tableCellRecall | 1.00 | 0.80 |

These are all report-only metrics on public blank-form fixtures. Under this
project's fail-closed principle, the safety correction takes priority and the
quality cost on public-document recall is explicitly accepted. The baseline floor
rises from `majorDriftCount=2` to `majorDriftCount=3` as a direct consequence.

Prompt fingerprints:

| Prompt | SHA-256 |
|---|---|
| system | `f94dd5e319fec8079d5161f8f49de404b1dd7001f7741da2ac1bd760403064d6` |
| user | `00b770a2196707de8cdd5db55af7fdb817107878a8708130cb78c60c56d2a431` |

## Focused Safety Verification

Command:

```bash
GOOGLE_CLOUD_LOCATION=global \
SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite \
pnpm eval:scan-pdf:ocr-live-drift \
  --fixture synthetic-unmaskable-pii-scan \
  --ci \
  --out tmp/scan-pdf-ocr-live-drift-unmaskable-ci-2026-06-13.json \
  --artifact-dir tmp/scan-pdf-ocr-live-drift-unmaskable-ci-artifacts
```

Result: passed.

| Metric | Result |
|---|---:|
| evaluated quality fixtures | 0 |
| safety-only fixtures | 1 |
| extraction failures | 0 |
| major drift fixtures | 0 |
| PII direction failures | 0 |
| deterministic zero failures | 0 |
| unmaskable PII findings | 4 |
| duration | 4.2s |

Observed direction check:

| Fixture | Expected | Observed |
|---|---|---|
| `synthetic-unmaskable-pii-scan` | `unmaskable >= 1` | `total=4`, `maskable=0`, `unmaskable=4` |

The older verifier also passed four consecutive mainline extractor trials:

```bash
GOOGLE_CLOUD_LOCATION=global \
SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite \
pnpm fixtures:scan-pdf:unmaskable:verify
```

Result: `4/4` trials passed with `piiTotal=4`, `piiMaskable=0`,
`piiUnmaskable=4`.

## Full Live Drift Noise Check

Commands:

```bash
GOOGLE_CLOUD_LOCATION=global \
SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite \
pnpm eval:scan-pdf:ocr-live-drift \
  --out tmp/scan-pdf-ocr-live-drift-pii-direction-run2-2026-06-13.json \
  --artifact-dir tmp/scan-pdf-ocr-live-drift-pii-direction-run2-artifacts

GOOGLE_CLOUD_LOCATION=global \
SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite \
pnpm eval:scan-pdf:ocr-live-drift \
  --out tmp/scan-pdf-ocr-live-drift-pii-direction-run3-2026-06-13.json \
  --artifact-dir tmp/scan-pdf-ocr-live-drift-pii-direction-run3-artifacts
```

Together with the first run
`tmp/scan-pdf-ocr-live-drift-pii-direction-2026-06-13.json`, the current prompt
produced the same high-level result three times:

| Run | Extraction failures | Major drift | PII direction failures | Deterministic zero failures | Unmaskable PII findings |
|---|---:|---:|---:|---:|---:|
| run 1 | 0 | 3 | 0 | 0 | 5 |
| run 2 | 0 | 3 | 0 | 0 | 5 |
| run 3 | 0 | 3 | 0 | 0 | 5 |

Per-fixture live metrics were stable across the three runs:

| Fixture | Major drift | Field | Core field | Value | Table cell | Locator | PII observed |
|---|---:|---:|---:|---:|---:|---:|---|
| `mhlw-labor-conditions-notice-blank-scan` | yes | 1.00 | 1.00 | 1.00 | 0.80 | 0.964 | `total=0` |
| `nta-withholding-form-blank-scan` | yes | 0.786 | 0.80 | 0.667 | 0.00 | 0.65 | `total=1`, `unmaskable=1` |
| `synthetic-employment-form-scan` | no | 1.00 | 1.00 | 1.00 | N/A | 1.00 | `total=7`, `maskable=7` |
| `synthetic-invoice-with-pii-scan` | yes | 0.80 | 0.875 | 0.60 | 0.75 | 0.737 | `total=8`, `maskable=8` |
| `synthetic-unmaskable-pii-scan` | safety-only | N/A | N/A | N/A | N/A | N/A | `total=4`, `unmaskable=4` |

Interpretation: the PII safety direction is stable and green. The quality floor
is still red against committed sidecars, with accepted current full-live
baseline `majorDriftCount = 3`. Candidate prompt/model changes should be judged
by report-to-report comparison against this floor until the scan-pdf sidecars
are intentionally regenerated.

## Stable P1-D Gate Snapshot

Command:

```bash
pnpm eval:p1d:quality -- --out tmp/p1d-quality-report-after-ocr-live-drift-2026-06-13.json
```

Summary:

| Metric | Value |
|---|---:|
| evaluated fixtures | 9 |
| skipped fixtures | 1 |
| valuePrecisionAverage | 1 |
| tableCellRecallAverage | 0.7142857142857143 |
| locatorCoverageAverage | 0.734202331509553 |
| falseMaskedTokenCount | 0 |
| emptyChunkCount | 0 |
| oversizedChunkCount | 0 |

The page-scoped `pN-ocrM` evaluator hardening changed report-only stable values
but did not change deterministic zero checks.

## Acceptance

- PII direction guard is now part of the live drift report and `--ci` failure
  logic.
- The safety-only unmaskable fixture passes as a focused live CI check.
- Full live `--ci` remains inappropriate as a default gate until the accepted
  scan-pdf sidecar drift floor is removed by a separate regeneration commit.

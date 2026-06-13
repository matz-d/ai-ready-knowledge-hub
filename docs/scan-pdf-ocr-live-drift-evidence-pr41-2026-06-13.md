# scan-pdf OCR live drift evidence - PR #41 - 2026-06-13

Purpose: attach live drift evidence to PR #41, which changes only the scan-pdf
Gemini OCR prompt's PII maskability guidance.

## Candidate Under Test

| Item | Value |
|---|---|
| PR | `#41` |
| Branch | `codex/scan-pdf-ocr-prompt-guard` |
| Commit | `d079ab1` |
| Base branch | `codex/scan-pdf-ocr-live-drift` |
| Model | `gemini-3.1-flash-lite` |
| Region | `global` |
| Mode | `live` |
| Generated at | `2026-06-12T23:26:24.077Z` |

Prompt fingerprints:

| Prompt | SHA-256 |
|---|---|
| system | `f94dd5e319fec8079d5161f8f49de404b1dd7001f7741da2ac1bd760403064d6` |
| user | `00b770a2196707de8cdd5db55af7fdb817107878a8708130cb78c60c56d2a431` |

## Command

```bash
GOOGLE_CLOUD_LOCATION=global \
SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite \
pnpm eval:scan-pdf:ocr-live-drift \
  --out tmp/scan-pdf-ocr-live-drift-pr41-report.json \
  --artifact-dir tmp/scan-pdf-ocr-live-drift-pr41-artifacts
```

Report path: `tmp/scan-pdf-ocr-live-drift-pr41-report.json`

Artifact directory: `tmp/scan-pdf-ocr-live-drift-pr41-artifacts/`

## Summary

| Metric | Result |
|---|---:|
| evaluated quality fixtures | 4 |
| safety-only fixtures | 1 |
| extraction failures | 0 |
| major drift fixtures | 3 |
| PII direction failures | 0 |
| deterministic zero failures | 0 |
| unmaskable PII findings | 5 |
| duration | 37.6s |

The candidate matches the accepted current live baseline floor:

- extraction failures: `0`
- major drift fixtures: `3`
- PII direction failures: `0`
- deterministic zero failures: `0`
- unmaskable PII findings: `5`

## Fixture Results

| Fixture | Major drift | Field | Core field | Value | Table cell | Locator | PII direction | PII observed |
|---|---:|---:|---:|---:|---:|---:|---|---|
| `mhlw-labor-conditions-notice-blank-scan` | yes | 1.00 | 1.00 | 1.00 | 0.80 | 0.964 | pass | `total=0` |
| `nta-withholding-form-blank-scan` | yes | 0.786 | 0.80 | 0.667 | 0.00 | 0.65 | pass | `total=1`, `unmaskable=1` |
| `synthetic-employment-form-scan` | no | 1.00 | 1.00 | 1.00 | N/A | 1.00 | pass | `total=7`, `maskable=7` |
| `synthetic-invoice-with-pii-scan` | yes | 0.80 | 0.875 | 0.60 | 0.75 | 0.737 | pass | `total=8`, `maskable=8` |
| `synthetic-unmaskable-pii-scan` | safety-only | N/A | N/A | N/A | N/A | N/A | pass | `total=4`, `unmaskable=4` |

## Interpretation

PR #41 keeps the full live drift result at the documented accepted floor while
preserving the load-bearing PII direction guard:

- The safety-only unmaskable fixture still emits four unmaskable findings.
- Synthetic PII fixtures still emit PII findings and pass direction checks.
- Public blank-form over-detection remains report-only.
- Full live `--ci` remains intentionally unsuitable until the accepted
  scan-pdf sidecar drift floor is removed by a future regeneration commit.

Conclusion: the PR #41 prompt guard has live evidence and does not introduce a
new blocker relative to the current accepted drift floor.

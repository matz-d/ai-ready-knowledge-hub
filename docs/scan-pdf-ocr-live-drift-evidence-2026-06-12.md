# scan-pdf OCR live drift evidence — 2026-06-12

Purpose: establish a live baseline before changing Gemini OCR prompt/model.

## Deployed Baseline

- Production deploy source: `main` SHA `e85f817`
- Deploy workflow: `CI/CD` run `27411706967`
- Result: test / typecheck / build / Cloud Run deploy succeeded

## Live Drift Command

```bash
GOOGLE_CLOUD_LOCATION=global \
SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite \
pnpm eval:scan-pdf:ocr-live-drift \
  --out tmp/scan-pdf-ocr-live-drift-baseline-2026-06-12.json
```

## Summary

| Metric | Result |
|---|---:|
| evaluated fixtures | 4 |
| extraction failures | 0 |
| major drift fixtures | 3 |
| unmaskable PII findings | 1 |
| deterministic zero failures | 0 |
| duration | 28.0s |

Prompt fingerprints:

| Prompt | SHA-256 |
|---|---|
| system | `f94dd5e319fec8079d5161f8f49de404b1dd7001f7741da2ac1bd760403064d6` |
| user | `f51dc6bdc3c0acbc24c758f23b1dd878dd0192a2caf36fd88fe766d20dfe0e37` |

## Fixture Notes

| Fixture | Signal |
|---|---|
| `mhlw-labor-conditions-notice-blank-scan` | tableCellRecall `1.00 -> 0.60`; locatorCoverage `1.00 -> 0.93` |
| `nta-withholding-form-blank-scan` | fieldRecall `1.00 -> 0.93`; tableCellRecall `1.00 -> 0.00`; locatorCoverage `1.00 -> 0.80`; one unmaskable PII finding |
| `synthetic-employment-form-scan` | no major drift |
| `synthetic-invoice-with-pii-scan` | fieldRecall `1.00 -> 0.80`; coreFieldRecall `1.00 -> 0.875`; valuePrecision `1.00 -> 0.60`; locatorCoverage `1.00 -> 0.74` |

Interpretation: current live Gemini OCR is available and fail-closed safety
signals are clean, but committed scan-pdf sidecars are not stable against fresh
OCR for three fixtures. Treat this as the baseline drift to compare against when
trying a candidate OCR prompt or model.

## Candidate Checks

### `gemini-3.5-flash` with current prompt

Command:

```bash
GOOGLE_CLOUD_LOCATION=global \
SCAN_PDF_GEMINI_MODEL=gemini-3.5-flash \
pnpm eval:scan-pdf:ocr-live-drift \
  --out tmp/scan-pdf-ocr-live-drift-gemini-3.5-flash-2026-06-12.json
```

Result: rejected for now.

| Metric | Baseline lite | `gemini-3.5-flash` |
|---|---:|---:|
| evaluated fixtures | 4 | 4 |
| extraction failures | 0 | 0 |
| major drift fixtures | 3 | 4 |
| unmaskable PII findings | 1 | 0 |
| deterministic zero failures | 0 | 0 |
| duration | 28.0s | 66.7s |

Reason: no extraction failures, but all four fixtures showed major drift and
runtime was more than 2x the baseline. Not a good production OCR default
candidate on this fixture set.

### Prompt v3 with `gemini-3.1-flash-lite`

Command:

```bash
GOOGLE_CLOUD_LOCATION=global \
SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite \
pnpm eval:scan-pdf:ocr-live-drift \
  --out tmp/scan-pdf-ocr-live-drift-prompt-v3-lite-2026-06-12.json \
  --artifact-dir tmp/scan-pdf-ocr-live-drift-prompt-v3-lite-artifacts
```

Result: rejected for now.

| Metric | Baseline prompt | Prompt v3 |
|---|---:|---:|
| evaluated fixtures | 4 | 4 |
| extraction failures | 0 | 0 |
| major drift fixtures | 3 | 3 |
| unmaskable PII findings | 1 | 0 |
| deterministic zero failures | 0 | 0 |
| duration | 28.0s | 27.1s |

Reason: the unmaskable PII count decreased, but this was not accepted as a
safety improvement before fixture-specific PII direction checks existed.
Table/value recall also got worse on public form fixtures, including
tableCellRecall `0.60 -> 0.20` for
`mhlw-labor-conditions-notice-blank-scan` and valuePrecision `1.00 -> 0.33` for
`nta-withholding-form-blank-scan`.

An earlier prompt v2 trial was also rejected because it made
`synthetic-employment-form-scan` produce table blocks, violating that fixture's
`expectedTableCells: "not_applicable"` invariant.

## Evaluator Hardening

Change: `expectedTableCells[].tableId` values shaped like `pN-ocrM` are treated
as page-scoped OCR block hints during P1-D quality evaluation. The expected
row/column/value text must still be present in a table chunk on the same page.

Reason: scan-pdf Gemini OCR block ids drift when the model splits or merges
visible table/form regions, even when the relevant text is preserved. This
should not be counted as semantic loss. Stable PDF table ids such as `p3-t1`
remain mapped to synthesized table locators as before.

Validation command:

```bash
GOOGLE_CLOUD_LOCATION=global \
SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite \
pnpm eval:scan-pdf:ocr-live-drift \
  --out tmp/scan-pdf-ocr-live-drift-ocr-id-fallback-2026-06-12.json \
  --artifact-dir tmp/scan-pdf-ocr-live-drift-ocr-id-fallback-artifacts
```

| Metric | Before fallback | After fallback |
|---|---:|---:|
| evaluated fixtures | 4 | 4 |
| extraction failures | 0 | 0 |
| major drift fixtures | 3 | 2 |
| unmaskable PII findings | 1 | 1 |
| deterministic zero failures | 0 | 0 |

Improved fixture: `mhlw-labor-conditions-notice-blank-scan` recovered from
table/locator drift to fieldRecall `1.00`, valuePrecision `1.00`,
tableCellRecall `1.00`, and locatorCoverage `1.00`.

Still real drift:

- `nta-withholding-form-blank-scan`: live OCR omits the blank-form `円` cells and
  one field label.
- `synthetic-invoice-with-pii-scan`: live OCR changes or omits expected values
  such as `請求書番号: SYN-INV-2026-0501` and `経理担当: 齋藤 試花`.

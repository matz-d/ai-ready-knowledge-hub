# scan-pdf OCR live drift workflow

Last updated: 2026-06-13

Use this workflow before changing `SCAN_PDF_GEMINI_MODEL`,
`SCAN_PDF_GEMINI_OCR_SYSTEM_PROMPT`, or `SCAN_PDF_GEMINI_OCR_PROMPT`.

The stable P1-D quality gate uses committed sidecars only. This live drift check
calls Vertex Gemini through the mainline scan-pdf extractor, then compares fresh
OCR output against the committed `*.document-ir.json` and `*.expected.json`
fixtures.

The report schema is currently `schemaVersion: 2`. It contains quality fixtures
and safety-only fixtures. Quality fixtures compare fresh live OCR against
committed sidecars. Safety-only fixtures are allowed to omit committed sidecars
and exist only to preserve load-bearing safety signals.

## Command

```bash
GOOGLE_CLOUD_LOCATION=global \
SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite \
pnpm eval:scan-pdf:ocr-live-drift \
  --out tmp/scan-pdf-ocr-live-drift-report.json
```

Fresh live `DocumentIR` artifacts are written to
`tmp/scan-pdf-ocr-live-drift-artifacts/` by default. Use `--artifact-dir` when
you want to keep separate candidate runs side by side.

For the strict full-fixture gate, add `--ci`:

```bash
GOOGLE_CLOUD_LOCATION=global \
SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite \
pnpm eval:scan-pdf:ocr-live-drift --ci
```

Use `--fixture <documentId>` to focus a single fixture and
`--allowed-recall-drop <0..1>` to tune the default 0.05 major drift threshold.
The option name is historical: the threshold is applied to all ratio metrics in
the live report, including `valuePrecision`, `tableCellRecall`, and
`locatorCoverage`.

During the current baseline, full `--ci` is intentionally red because committed
scan-pdf sidecars still have an accepted major-drift floor. Use report-to-report
comparison for prompt/model candidates until those sidecars are regenerated. The
safety-only PII probe can be run as a focused CI check today:

```bash
GOOGLE_CLOUD_LOCATION=global \
SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite \
pnpm eval:scan-pdf:ocr-live-drift \
  --fixture synthetic-unmaskable-pii-scan \
  --ci
```

## What It Measures

- Fresh mainline OCR extraction success / fail-closed errors.
- `expected.json` recall drift for fields, core fields, values, table cells, and
  locators.
- Page coverage, chunk count, block count, and text density warning deltas.
- Live OCR `unmaskablePiiFindings` count.
- Directional PII checks, where PII detection loss is a blocker and public-form
  over-detection remains report-only.
- Deterministic zero checks for false public redactions, empty chunks, and
  oversized chunks.
- Prompt fingerprints for both OCR prompts, so report files identify which
  prompt text produced the live result.

## PII Direction Guard

PII findings feed the D-PROD-1 fail-closed gate, so count decreases are not
automatically improvements. The live drift workflow evaluates fixture-specific
direction expectations:

| Fixture | Expectation | CI meaning |
|---|---|---|
| `synthetic-unmaskable-pii-scan` | `unmaskable >= 1` | hard fail if lost |
| `synthetic-employment-form-scan` | `total >= 1` | hard fail if all PII detection is lost |
| `synthetic-invoice-with-pii-scan` | `total >= 1` | hard fail if all PII detection is lost |
| public blank forms | report-only | public-form over-detection is recorded, not a blocker |

The unmaskable fixture is safety-only by design. It has no committed
`expected.json` / `document-ir.json` dependency in this workflow because the
signal under test is only whether live OCR continues to emit at least one
unmaskable finding.

## Current Submission Policy

For submission work, keep the current scan-pdf live drift baseline fixed instead
of regenerating sidecars opportunistically.

This is a deliberate quality policy, not a waiver of safety:

- The PII direction checks are green, including the safety-only unmaskable probe.
- Extraction failures and deterministic zero failures are `0`.
- The full live drift red state is caused by live OCR output moving away from
  committed sidecars, not by a new fail-open safety condition.
- Regenerating sidecars changes the quality baseline and must be reviewed as its
  own PR, especially for public blank-form expectations.

Until the sidecar refresh PR lands:

- Full-fixture live `--ci` remains intentionally unsuitable as a default gate.
- Prompt/model candidates should be judged by report-to-report comparison
  against the accepted floor below.
- The focused unmaskable safety fixture remains suitable for live `--ci`.
- `pnpm eval:p1d:quality --ci` remains the stable committed-sidecar gate.

Sidecar refresh is a follow-up PR, not a drive-by step in prompt/model changes.
That PR should include public blank-form regeneration policy, human review of
`*.expected.json` fields, three repeated live reports, and the usual stable
verification commands.

## Change Procedure

1. Run the command on the current baseline model/prompt and save the report.
2. Change the model or prompt locally.
3. Run the command again with the candidate settings.
4. Compare both reports. Treat extraction failures, deterministic zero failures,
   PII direction failures, or major ratio drops beyond the accepted baseline
   floor as blockers.
   Boundary deltas should be rerun before accepting or rejecting a candidate.
5. If the drift is acceptable, do not automatically regenerate scan-pdf
   sidecars. Record the report paths and keep the accepted baseline fixed for
   submission work.
6. Only in a dedicated sidecar refresh PR, regenerate scan-pdf sidecars and
   expected fields:

   ```bash
   pnpm tsx scripts/regenerateScanPdfGoldenSidecars.ts --refresh-expected
   pnpm eval:p1d:quality --ci
   pnpm typecheck
   pnpm test
   ```

   The existing regeneration script currently covers the synthetic golden
   fixtures. Public blank-form fixture updates need an explicit regeneration and
   review policy before they are folded into the stable baseline.
7. Record the report path and model/prompt fingerprint in the PR or phase note.

Do not run the full fixture set in normal CI. It requires live Vertex
credentials and can move with model availability, quota, and service behavior.

## Current Baseline Floor

The accepted current baseline floor is `majorDriftCount = 3` on the full live
fixture set with `gemini-3.1-flash-lite` and user prompt fingerprint
`00b770a2196707de8cdd5db55af7fdb817107878a8708130cb78c60c56d2a431`.
Three repeated runs on 2026-06-13 all produced:

- extraction failures: `0`
- major drift fixtures: `3`
- PII direction failures: `0`
- deterministic zero failures: `0`
- unmaskable PII findings: `5`

The stable committed-sidecar gate after the page-scoped `pN-ocrM` evaluator
hardening reports `tableCellRecallAverage=0.7142857142857143`,
`locatorCoverageAverage=0.734202331509553`, and `valuePrecisionAverage=1`.
Deterministic zero checks remain green.

Latest baseline evidence: [2026-06-13](scan-pdf-ocr-live-drift-evidence-2026-06-13.md).

# Official-doc table-assist mainline harness evidence - 2026-06-16

Purpose: verify the dispatcher mainline path for grounded Gemini table-assist
without touching production async ingest.

## Scope

- Code path: `dispatchPdfExtraction({ tableAssistMode: 'async', ... })`
- Fixture root: `sample-data/document-conversion/official-doc-pdf/`
- Fixtures: labor / overtime / model official-doc sample PDFs
- Region: `GOOGLE_CLOUD_LOCATION=global`
- Model: `OFFICIAL_DOC_TABLE_ASSIST_MODEL`
- Production async ingest: not used
- Customer data: forbidden; committed sample/public fixtures only

The harness narrows dispatcher configs to `pdf-conversion-subtype-1` and uses
`isFlagEnabled: async () => true`. This keeps the requested async+flag-on call
shape while avoiding an artificial subtype mutex conflict with subtype-2/3.

## Human Go Status

Go received and executed on 2026-06-16.

## Merge Observation Command

```bash
GOOGLE_CLOUD_LOCATION=global \
OFFICIAL_DOC_TABLE_ASSIST_MODEL=gemini-3.5-flash \
pnpm tsx scripts/runOfficialDocTableAssistMainlineHarness.ts \
  --ci \
  --require-merge \
  --out tmp/official-doc-table-assist-mainline-harness-merge-2026-06-16.json \
  --artifact-dir tmp/official-doc-table-assist-mainline-harness-merge-artifacts
```

Expected evidence fields:

- `summary.mergedFixtureCount >= 1`
- each fixture records `candidatePageCount`, `pagesProcessed`, `rowsMerged`,
  and `elapsedMs`
- `summary.contentNeutralFailures == 0`

## Fail-soft Observation Command

Use a deliberately invalid table-assist model id to force the optional Gemini
second pass to fail while preserving the pdf-parse IR.

```bash
GOOGLE_CLOUD_LOCATION=global \
OFFICIAL_DOC_TABLE_ASSIST_MODEL=invalid-table-assist-model-for-fail-soft \
pnpm tsx scripts/runOfficialDocTableAssistMainlineHarness.ts \
  --fixture mhlw-overtime-limit-guide \
  --ci \
  --require-fail-soft \
  --out tmp/official-doc-table-assist-mainline-harness-fail-soft-2026-06-16.json \
  --artifact-dir tmp/official-doc-table-assist-mainline-harness-fail-soft-artifacts
```

Expected evidence fields:

- `summary.failSoftFixtureCount >= 1`
- `fixtures[0].tableAssist.status == "skipped"`
- `fixtures[0].tableAssist.pagesFailed > 0` or a failure reason is recorded
- `summary.failedFixtureCount == 0`
- `summary.contentNeutralFailures == 0`

## Observation Log

### Preflight

First attempt without `OFFICIAL_DOC_TABLE_ASSIST_MODEL` failed before reaching
Gemini:

```text
OFFICIAL_DOC_TABLE_ASSIST_MODEL is required for this live Gemini harness
```

No live model call was made in that attempt.

### Merge Case

Command:

```bash
GOOGLE_CLOUD_LOCATION=global \
OFFICIAL_DOC_TABLE_ASSIST_MODEL=gemini-3.5-flash \
pnpm tsx scripts/runOfficialDocTableAssistMainlineHarness.ts \
  --ci \
  --require-merge \
  --out tmp/official-doc-table-assist-mainline-harness-merge-2026-06-16.json \
  --artifact-dir tmp/official-doc-table-assist-mainline-harness-merge-artifacts
```

Result: passed.

| Metric | Value |
|---|---:|
| fixtureCount | 3 |
| succeededFixtureCount | 3 |
| failedFixtureCount | 0 |
| mergedFixtureCount | 2 |
| failSoftFixtureCount | 0 |
| contentNeutralFailures | 0 |
| durationMs | 60661 |

Per fixture:

| Fixture | Status | Candidate pages | Processed | Failed | Raw rows | Rows merged | Rows rejected | Elapsed ms | Content-neutral |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| `mhlw-labor-conditions-notice-general` | merged | 2 | 2 | 0 | 10 | 9 | 1 | 17334 | pass |
| `mhlw-overtime-limit-guide` | skipped | 6 | 6 | 0 | 7 | 0 | 7 | 15992 | pass |
| `mhlw-r07-model-work-rules` | merged | 6 | 6 | 0 | 55 | 39 | 16 | 24227 | pass |

Artifacts:

- `tmp/official-doc-table-assist-mainline-harness-merge-2026-06-16.json`
- `tmp/official-doc-table-assist-mainline-harness-merge-artifacts/`

### Fail-soft Case

Command:

```bash
GOOGLE_CLOUD_LOCATION=global \
OFFICIAL_DOC_TABLE_ASSIST_MODEL=invalid-table-assist-model-for-fail-soft \
pnpm tsx scripts/runOfficialDocTableAssistMainlineHarness.ts \
  --fixture mhlw-overtime-limit-guide \
  --ci \
  --require-fail-soft \
  --out tmp/official-doc-table-assist-mainline-harness-fail-soft-2026-06-16.json \
  --artifact-dir tmp/official-doc-table-assist-mainline-harness-fail-soft-artifacts
```

Result: passed. Vertex returned 404 for the invalid model as intended; the
optional table-assist pass failed soft and the dispatcher still produced a
successful report.

| Metric | Value |
|---|---:|
| fixtureCount | 1 |
| succeededFixtureCount | 1 |
| failedFixtureCount | 0 |
| mergedFixtureCount | 0 |
| failSoftFixtureCount | 1 |
| contentNeutralFailures | 0 |
| durationMs | 4122 |

Observed table-assist summary for `mhlw-overtime-limit-guide`:

| Field | Value |
|---|---:|
| status | skipped |
| candidatePageCount | 6 |
| pagesProcessed | 0 |
| pagesFailed | 6 |
| rawRowCount | 0 |
| rowsMerged | 0 |
| rowsRejected | 0 |
| elapsedMs | 1030 |
| reason | `6 page(s) failed table-assist` |

Artifacts:

- `tmp/official-doc-table-assist-mainline-harness-fail-soft-2026-06-16.json`
- `tmp/official-doc-table-assist-mainline-harness-fail-soft-artifacts/`

## Acceptance

- Merge case observed.
- Fail-soft case observed.
- All observed table-assist cells passed the content-neutral grounding check.
- Only sample/public official-doc fixtures were used.
- Production async ingest was not used.

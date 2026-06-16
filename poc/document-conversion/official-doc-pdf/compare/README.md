# official-doc-pdf: converter comparison

PoC-only comparison for subtype 1. Current arms are `pdf-parse`, MarkItDown,
Gemini, and `pdf-parse+gemini-tables`. MarkItDown runs via local `uv` / `uvx`
(not Dockerfile / mainline build). Gemini is eval-only and runs through Vertex.

The Gemini arm is eval-only. Cloud inference requires an explicit opt-in
(`OFFICIAL_DOC_PDF_GEMINI_ENABLE=1`) and only runs for PDFs under
`sample-data/document-conversion/official-doc-pdf/`. Non-public synthetic
fixtures are skipped unless
`OFFICIAL_DOC_PDF_GEMINI_INCLUDE_NON_PUBLIC_FIXTURES=1` is set explicitly.
The only allowlisted synthetic exception is the PII-free table-assist golden
fixture, `synthetic-official-doc-table-assist-golden.pdf`.

## Prerequisites

- [uv](https://docs.astral.sh/uv/) on `PATH` (`uvx` available)
- First run downloads `markitdown[pdf]` into the uv tool cache (network required)
- Ghostscript `gs` on `PATH` for Gemini page-group splitting.
- Vertex/Gemini env configured. Use `GOOGLE_CLOUD_LOCATION=global` for this
  comparison track.

## Run

```bash
pnpm poc:conversion:official-doc-pdf:compare
# or a single fixture:
pnpm poc:conversion:official-doc-pdf:compare sample-data/document-conversion/official-doc-pdf/mhlw-labor-conditions-notice-general.pdf
```

Gemini knobs:

```bash
OFFICIAL_DOC_PDF_GEMINI_ENABLE=1 \
GOOGLE_CLOUD_LOCATION=global \
OFFICIAL_DOC_PDF_GEMINI_PAGE_GROUP_SIZE=1 \
OFFICIAL_DOC_PDF_GEMINI_CONCURRENCY=4 \
OFFICIAL_DOC_PDF_GEMINI_GROUP_ATTEMPTS=2 \
pnpm poc:conversion:official-doc-pdf:compare sample-data/document-conversion/official-doc-pdf/mhlw-overtime-limit-guide.pdf
```

`PAGE_GROUP_SIZE=1` gives the most bounded coverage. `2` can be tried for
context, but so far it is not consistently better.

The `pdf-parse+gemini-tables` arm keeps `pdf-parse` as the primary extraction
and adds a Gemini table-only second pass. Gemini table rows are merged only when
they are grounded in the same page's `pdf-parse` text; ungrounded rows are
discarded before evaluation.

Table-assist golden check:

```bash
pnpm exec tsx poc/document-conversion/official-doc-pdf/fixtures/generate-table-assist-golden.ts
OFFICIAL_DOC_PDF_GEMINI_ENABLE=1 \
GOOGLE_CLOUD_LOCATION=global \
OFFICIAL_DOC_PDF_GEMINI_PAGE_GROUP_SIZE=1 \
pnpm poc:conversion:official-doc-pdf:compare sample-data/document-conversion/official-doc-pdf/synthetic-official-doc-table-assist-golden.pdf
```

This fixture is compare-only and is not listed in `scripts/runP1dQualityGate.ts`
`STABLE_FIXTURES`, because stable P1-D uses committed sidecars only and should
not depend on live Gemini calls.

Public PDF table-assist goldens are kept as additional compare-only sidecars:

- `sample-data/document-conversion/official-doc-pdf/mhlw-labor-conditions-notice-general.table-assist.expected.json`
- `sample-data/document-conversion/official-doc-pdf/mhlw-overtime-limit-guide.table-assist.expected.json`
- `sample-data/document-conversion/official-doc-pdf/mhlw-r07-model-work-rules.table-assist.expected.json`

The compare harness loads `*.table-assist.expected.json` for the matching PDF and
reports those metrics under `tableAssistGoldens`. These sidecars are not added to
stable P1-D fixture registration and do not make live Gemini a P1-D gate.

The report also records Gemini runtime observations for the Gemini arms:
`elapsedMs`, `pageGroupCount`, `geminiCallCount`, `pageGroupSize`, `concurrency`,
`attemptsPerGroup`, `model`, and `region`. For `pdf-parse+gemini-tables`, the
report includes `pdfParseGeminiTablesGrounding`: raw Gemini table rows, grounded
rows merged, rejected rows, and short rejected examples.

Observed result on 2026-06-13:

| Arm | table cell recall | table candidates | locator coverage | hallucination candidates |
|---|---:|---:|---:|---:|
| `pdf-parse` | `0` | `0` | `0` | n/a |
| `gemini` | `0` | `4` | `0` | `0` |
| `pdf-parse+gemini-tables` | `1.0` | `4` | `1.0` | `0` |

This is the regression fixture for the current best PoC decision:
`pdf-parse` remains primary, and Gemini is used only as a grounded table-assist
second pass.

## Outputs

Written under `poc/document-conversion/output/official-doc-pdf/` (gitignored):

| File | Contents |
|------|----------|
| `compare-summary.json` | Full report: converters × fixtures, `ConversionEvalResult` per arm |
| `compare-summary.md` | Markdown table (one row per fixture) |
| `compare-{fixture}.json` | Per-fixture side-by-side JSON |
| `compare-{fixture}.md` | Per-fixture metric table + embedded eval JSON |

All converters should share: source output → `DocumentIR` → `KnowledgeChunk`
drafts → health-stage `ConversionEvalResult` (with `coverage` /
`locatorQuality` filled from IR).

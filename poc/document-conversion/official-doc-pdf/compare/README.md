# official-doc-pdf: pdf-parse vs MarkItDown

PoC-only comparison for subtype 1. MarkItDown runs via local `uv` / `uvx` (not Dockerfile / mainline build).

## Prerequisites

- [uv](https://docs.astral.sh/uv/) on `PATH` (`uvx` available)
- First run downloads `markitdown[pdf]` into the uv tool cache (network required)

## Run

```bash
pnpm poc:conversion:official-doc-pdf:compare
# or a single fixture:
pnpm poc:conversion:official-doc-pdf:compare sample-data/document-conversion/official-doc-pdf/mhlw-labor-conditions-notice-general.pdf
```

## Outputs

Written under `poc/document-conversion/output/official-doc-pdf/` (gitignored):

| File | Contents |
|------|----------|
| `compare-summary.json` | Full report: both converters × all fixtures, `ConversionEvalResult` per arm |
| `compare-summary.md` | Markdown table (one row per fixture) |
| `compare-{fixture}.json` | Per-fixture side-by-side JSON |
| `compare-{fixture}.md` | Per-fixture metric table + embedded eval JSON |

Both converters share: PDF/Markdown → `DocumentIR` → `KnowledgeChunk` drafts → health-stage `ConversionEvalResult` (with `coverage` / `locatorQuality` filled from IR).

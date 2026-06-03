# Gemini Model Migration Notes

Last reviewed: 2026-06-03

This repository currently uses Vertex AI Gemini through Genkit. The shared
client defaults to `gemini-3.5-flash` when `GEMINI_MODEL` is unset.

```ts
export const modelId = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash';
```

## Current Default

| Setting | Value |
|---|---|
| Region | `GOOGLE_CLOUD_LOCATION=global` |
| Default model | `gemini-3.5-flash` |
| scan-pdf OCR model | `SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite` |
| Override env | `GEMINI_MODEL` |
| Main paths | Curator, Masker residual risk, Strategist, slide-pdf direct read, scan-pdf OCR |

Keep Cloud Run / Artifact Registry / GCS / Firestore in `asia-northeast1`, but
use `GOOGLE_CLOUD_LOCATION=global` for Gemini 3.x during the hackathon. Google
documents regional endpoints separately from data residency guarantees, so
product language should say "Google Cloud managed boundary" rather than
"guaranteed Japan-only processing".

## Candidate Models

Based on the Vertex AI model lifecycle and public model tables, the practical
successors to the current default are:

| Candidate | Status | Role in this repo |
|---|---|---|
| `gemini-3.5-flash` | Latest stable | First default migration candidate for `gemini-2.5-flash` |
| `gemini-3.1-flash-lite` | Latest stable, lower cost | OCR / high-volume comparison candidate |
| `gemini-3-flash-preview` | Preview | Do not use as production default; PoC comparison only |
| `gemini-3.1-pro-preview` | Preview | Quality experiment only |

`gemini-2.5-flash` is still usable for now, but it is on the retiring path. Do
not add new hard-coded references to it outside docs, fixtures, or explicit
backward-compatibility tests.

## Project Access Smoke

Observed on 2026-06-03 with project `ai-ready-knowledge-hub` through the current
Genkit Vertex path:

| Location | Model | Result |
|---|---|---|
| `asia-northeast1` | `gemini-3.5-flash` | 404 publisher model not found / no project access |
| `asia-northeast1` | `gemini-3.1-flash-lite` | 404 publisher model not found / no project access |
| `asia-northeast1` | `gemini-3.1-flash-lite-001` | 404 publisher model not found / no project access |
| `asia-northeast1` | `gemini-3-flash-preview` | 404 publisher model not found / no project access |
| `asia-northeast1` | `gemini-2.5-flash` | scan-pdf PoC pass |
| `global` | `gemini-3.5-flash` | scan-pdf PoC pass |
| `global` | `gemini-3.1-flash-lite` | scan-pdf PoC pass |
| `global` | `gemini-3-flash-preview` | scan-pdf PoC pass |

Implication: Gemini 3.x model names work with this SDK and project on `global`,
but they are not currently reachable from the Tokyo endpoint for this project.
The repository default now follows this observation: Gemini 3.x uses `global`.
Do not switch back to `asia-northeast1` for Gemini 3.x unless this smoke is rerun
and passes.

Official references:

- [Model versions and lifecycle](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions)
- [Deployments and endpoints](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/locations)
- [Generative AI pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)

## Trial Commands

For the current hackathon default:

```bash
export GOOGLE_CLOUD_LOCATION=global
export GEMINI_MODEL=gemini-3.5-flash
export SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite
pnpm typecheck
pnpm test
```

For scan-pdf OCR:

```bash
export GOOGLE_CLOUD_LOCATION=global
export SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite
pnpm poc:conversion:scan-pdf sample-data/document-conversion/scan-pdf/synthetic-employment-form-scan.pdf
```

For the higher-quality OCR comparison:

```bash
export GOOGLE_CLOUD_LOCATION=global
export SCAN_PDF_GEMINI_MODEL=gemini-3.5-flash
pnpm poc:conversion:scan-pdf sample-data/document-conversion/scan-pdf/synthetic-employment-form-scan.pdf
```

Live checks require valid Vertex AI credentials and project env. If ADC has
expired, refresh it first:

```bash
gcloud auth application-default login
```

Then run focused live or PoC paths:

```bash
GOOGLE_CLOUD_LOCATION=global GEMINI_MODEL=gemini-3.5-flash SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite pnpm test:e2e:live
GOOGLE_CLOUD_LOCATION=global SCAN_PDF_GEMINI_MODEL=gemini-3.1-flash-lite pnpm poc:conversion:scan-pdf sample-data/document-conversion/scan-pdf/synthetic-invoice-with-pii-scan.pdf

GOOGLE_CLOUD_LOCATION=global SCAN_PDF_GEMINI_MODEL=gemini-3.5-flash pnpm poc:conversion:scan-pdf sample-data/document-conversion/scan-pdf/synthetic-invoice-with-pii-scan.pdf
```

## Acceptance Checks

Before shipping the hackathon default, verify:

1. Curator structured output passes Zod validation.
2. Masker residual risk structured output passes Zod validation.
3. Strategist Context Package JSON shape remains stable.
4. scan-pdf OCR returns non-empty pages and preserves `piiFindings`.
5. `document.convert.inferenceDestination.model` records the trial model.
6. Any fixture or docs that intentionally pin `gemini-2.5-flash` are updated or
   left with an explicit historical date.

If `gemini-3.5-flash` passes on `asia-northeast1` in a later rerun, the project
can revisit Tokyo inference. Until then, keep Gemini 3.x on `global`. If OCR
quality is materially better with `gemini-3.5-flash`, set
`SCAN_PDF_GEMINI_MODEL=gemini-3.5-flash`; otherwise keep the cheaper
`gemini-3.1-flash-lite` default.

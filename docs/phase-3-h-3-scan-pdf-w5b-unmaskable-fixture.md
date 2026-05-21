# scan-pdf W5b deterministic unmaskable fixture note

> 実施日: 2026-05-21
> 対象: Phase 3-H-3 M6 W5b
> 目的: live smoke で `unmaskablePiiFindings.count > 0` を安定観測する合成 scan fixture を採用する

## Adopted fixture

- PDF: `sample-data/document-conversion/scan-pdf/synthetic-unmaskable-pii-scan.pdf`
- Generator: `poc/document-conversion/scan-pdf/fixtures/generate-synthetic-unmaskable-pii-scan.ts`
- Source policy: local synthetic only. No customer record, employee record, credential, or production export is used.
- Damage recipe: the generator draws fold bands across synthetic name / phone / address / My Number-like rows, then ImageMagick rasterizes at low resolution with deterministic blur, rotation, and seeded scan noise.

## Validation command

```bash
pnpm tsx poc/document-conversion/scan-pdf/fixtures/generate-synthetic-unmaskable-pii-scan.ts
pnpm poc:conversion:scan-pdf sample-data/document-conversion/scan-pdf/synthetic-unmaskable-pii-scan.pdf
```

## Vertex OCR trials

All trials used the same generated PDF with `gemini-2.5-flash` on 2026-05-21.

| trial | schema | pii_total | pii_maskable | pii_unmaskable | OCR duration ms |
|---|---|---:|---:|---:|---:|
| 1 | pass | 4 | 0 | 4 | 17799 |
| 2 | pass | 4 | 0 | 4 | 17491 |
| 3 | pass | 4 | 0 | 4 | 17787 |
| 4 | pass | 4 | 0 | 4 | 17212 |

Acceptance result: adopted. `piiFindings.unmaskable >= 1` held in 4/4 repeated PoC runs, with a stable observed count of 4.

The observed findings were marked unmaskable because the damaged scan leaves OCR confidence too low for reliable span replacement. This fixture is for W5b live-smoke observation; it is separate from the `ocr-fail-closed-preflight.pdf` pre-flight failure fixture and the 413-only `degraded-scan-fail-closed.pdf`.

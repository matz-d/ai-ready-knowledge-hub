# scan-pdf W5b deterministic unmaskable fixture note

> 実施日: 2026-05-21
> 対象: Phase 3-H-3 M6 W5b
> 目的: live smoke で `unmaskablePiiFindings.count > 0` を安定観測する合成 scan fixture を採用する

## Adopted fixture

- PDF: `sample-data/document-conversion/scan-pdf/synthetic-unmaskable-pii-scan.pdf`
- Generator: `poc/document-conversion/scan-pdf/fixtures/generate-synthetic-unmaskable-pii-scan.ts`
- Source policy: local synthetic only. No customer record, employee record, credential, or production export is used.
- Damage recipe: the generator covers synthetic name / phone / address / My Number-like field values with deterministic fold bands, keeps the PII field labels visible on the fax copy, then ImageMagick rasterizes at low resolution with blur, rotation, and seeded scan noise.
- Acceptance boundary: the local gate is the mainline `extractScanPdfFromBuffer` path used by upload pre-flight. The PoC runner writes observation artifacts after adoption; it is not the DoD gate.

## Validation command

```bash
pnpm tsx poc/document-conversion/scan-pdf/fixtures/generate-synthetic-unmaskable-pii-scan.ts
pnpm fixtures:scan-pdf:unmaskable:verify
pnpm poc:conversion:scan-pdf sample-data/document-conversion/scan-pdf/synthetic-unmaskable-pii-scan.pdf
```

## Mainline Vertex OCR trials

All trials used the same regenerated PDF through the shared OCR core and the
mainline `extractScanPdfFromBuffer` path with `gemini-2.5-flash` in
`asia-northeast1` on 2026-05-21.

| trial | pii_total | pii_maskable | pii_unmaskable | OCR duration ms |
|---|---|---:|---:|---:|---:|
| 1 | 4 | 0 | 4 | 20933 |
| 2 | 4 | 0 | 4 | 22029 |
| 3 | 4 | 0 | 4 | 17999 |
| 4 | 4 | 0 | 4 | 17581 |

Acceptance result: adopted locally. `piiFindings.unmaskable >= 1` held in 4/4
mainline extractor runs, with a stable observed count of 4. Final M6 v2 DoD
closure still requires a post-deploy live `document.convert` AuditEvent for this
fixture with `conversion.unmaskablePiiFindings.count > 0`.

The shared OCR prompt now makes the damaged-field case explicit: a visibly
labeled PII field with a scan-damaged value is unmaskable when the downstream
masker has no reliable exact span. The generated scan keeps that condition
separate from the `ocr-fail-closed-preflight.pdf` pre-flight failure fixture and
the 413-only `degraded-scan-fail-closed.pdf`.

## Prior PoC-only adoption note

The first W5b adoption on 2026-05-21 used only
`pnpm poc:conversion:scan-pdf` and recorded `4/4` PoC runs with count `4`.
The same PDF then produced live `document.convert` counts of `0` twice because
the PoC and upload OCR prompts had drifted. The shared OCR core and the
mainline verifier above replace that PoC-only acceptance path.

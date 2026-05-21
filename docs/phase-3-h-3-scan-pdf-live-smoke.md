# Phase 3-H-3 scan-pdf live smoke evidence

Date: 2026-05-21

Purpose: Confirm the dev-tenant-only `scan-pdf` Cloud Run path across IAP,
Firestore feature flags, Vertex OCR, Firestore `documents`, `conversion_eval`,
chunks, `AuditEvent document.convert`, size-limit rejection, subtype mutex, and
pre-flight fail-closed behavior.

Scope guardrails for this smoke:

- Tenant scope: `m-grow-ai.com` only.
- No demo tenant rollout.
- No public rollout.
- No Masker integration.
- No Document AI.

## Deployment / boundary

- Project: `ai-ready-knowledge-hub`
- Region: `asia-northeast1`
- Cloud Run service: `ai-ready-knowledge-hub`
- Cloud Run URL: `https://ai-ready-knowledge-hub-mrvutsz24a-an.a.run.app`
- IAP: enabled (`run.googleapis.com/iap-enabled=true`)
- Runtime service account: `aiknh-runner@ai-ready-knowledge-hub.iam.gserviceaccount.com`
- Smoke revision: `ai-ready-knowledge-hub-00024-sdz`
- Smoke traffic: `100%`
- Cloud Build id: `6f6f9528-6714-4765-9656-7d9ab9aa6d8b`
- Cloud Build result: `SUCCESS`
- Cloud Build window: `2026-05-21T09:37:25.424324624Z` to
  `2026-05-21T09:42:26.824990Z`
- Cloud Build image digest:
  `sha256:0d2b6b7d6732ce5e18c941d38e898ebbdb3b920493a0a911b17e6a475e33db3b`
- Local verification before deploy: `pnpm build` passed.

Cloud Run service annotations after deploy recorded the same build id and kept
IAP enabled:

```yaml
run.googleapis.com/build-id: 6f6f9528-6714-4765-9656-7d9ab9aa6d8b
run.googleapis.com/iap-enabled: 'true'
status.latestReadyRevisionName: ai-ready-knowledge-hub-00024-sdz
```

## CI gate

`gh pr checks 6` at smoke time showed:

```text
Test, Typecheck, Build                         pass
conversion-eval / health (required)           pass
conversion-eval / heuristic (warning)         pass
conversion-eval / golden (manual + monthly)   skipping
Deploy to Cloud Run                            skipping
```

The required CI health gate for the subtype-3 branch is green. Golden remains
manual/monthly by design in this PR check set.

## Feature flags

This re-smoke started from the cleaned-up subtype-3 posture left by the first
smoke: subtype-1 and subtype-2 had empty tenant allow-lists and subtype-3 alone
allow-listed `m-grow-ai.com`.

Final smoke posture after mutex cleanup:

```json
{
  "pdf-conversion-subtype-1": {
    "defaultEnabled": false,
    "enabledTenants": [],
    "expiresAt": "2026-06-30T23:59:59.000Z"
  },
  "pdf-conversion-subtype-2": {
    "defaultEnabled": false,
    "enabledTenants": [],
    "expiresAt": "2026-06-30T23:59:59.000Z"
  },
  "pdf-conversion-subtype-3": {
    "defaultEnabled": false,
    "enabledTenants": ["m-grow-ai.com"],
    "expiresAt": "2026-06-30T23:59:59.000Z"
  }
}
```

The subtype-1 + subtype-3 mutex branch was checked by temporarily restoring
`m-grow-ai.com` to subtype-1 while subtype-3 stayed ON, uploading a small scan
PDF through IAP, observing HTTP 403, and removing subtype-1 again.

## IAP uploads

- Access path: Chrome work profile through Cloud Run IAP.
- IAP actor observed in audit events: `makoto@m-grow-ai.com`
- Tenant observed in audit events: `m-grow-ai.com`

| Fixture | Result | docId / status |
|---|---|---|
| `synthetic-unmaskable-pii-scan.pdf` | success | `333e856c-9173-4d3f-8b0e-ab151585921e`, post-remediation deterministic gate |
| `synthetic-employment-form-scan.pdf` | success | `15b82ac8-c378-4e68-8b51-90fb9d3a71b3`, golden fixture upload; `requires_masking` |
| `mhlw-labor-conditions-notice-blank-scan.pdf` | success | `ff2ff5c5-86a0-4096-862b-e394234fc8c2`, direct-policy chunk evidence |
| `nta-withholding-form-blank-scan.pdf` | rejected | HTTP 400 OCR/schema pre-flight during re-smoke; not used as evidence |
| `degraded-scan-fail-closed.pdf` | rejected | HTTP 413 size limit, no OCR health/golden use |
| `ocr-fail-closed-preflight.pdf` with subtype-1 + subtype-3 ON | rejected | HTTP 403 mutex |
| `ocr-fail-closed-preflight.pdf` | rejected | HTTP 400 pre-flight fail-closed |

## Direct scan evidence

The direct-policy evidence document is
`documents/ff2ff5c5-86a0-4096-862b-e394234fc8c2`.

```json
{
  "fileName": "mhlw-labor-conditions-notice-blank-scan.pdf",
  "status": "curated",
  "sourceSubtype": "scan-pdf",
  "aiUsePolicy": "direct",
  "sensitivity": "Public",
  "latestConversionEvalId": "ff2ff5c5-86a0-4096-862b-e394234fc8c2:v1",
  "storagePath": "raw/ff2ff5c5-86a0-4096-862b-e394234fc8c2/mhlw-labor-conditions-notice-blank-scan.pdf"
}
```

### Conversion eval

`conversion_eval/ff2ff5c5-86a0-4096-862b-e394234fc8c2:v1`

```json
{
  "stage": "health",
  "result": {
    "schemaValidity": { "passed": true, "errors": [] },
    "contextPackageReadiness": {
      "chunkCount": 78,
      "averageChunkLength": 16.71794871794872,
      "oversizedChunks": 0,
      "emptyChunks": 0
    },
    "overall": { "status": "pass", "reasons": [] }
  }
}
```

### Chunks

Firestore path:
`documents/ff2ff5c5-86a0-4096-862b-e394234fc8c2/chunks`

- Count: `78`
- First chunk id: `ff2ff5c5-86a0-4096-862b-e394234fc8c2:p1-ocr1`

```json
{
  "sourceType": "pdf",
  "structureType": "paragraph",
  "locator": { "kind": "pdf", "page": 1, "paragraphId": "p1-ocr1" },
  "title": "mhlw-labor-conditions-notice-blank-scan.pdf",
  "sensitivity": "Public",
  "aiUsePolicy": "direct",
  "extractionProvider": "pdf"
}
```

### AuditEvent

`auditEvents/0mpfb6dku-6666817cb8619cae`

```json
{
  "tenantId": "m-grow-ai.com",
  "actor": { "userId": "makoto@m-grow-ai.com" },
  "action": "document.convert",
  "target": {
    "docId": "ff2ff5c5-86a0-4096-862b-e394234fc8c2",
    "fileName": "mhlw-labor-conditions-notice-blank-scan.pdf",
    "sourceKind": "upload",
    "sensitivity": "Public"
  },
  "result": "success",
  "conversion": {
    "converterId": "gemini-vertex-ocr",
    "sourceSubtype": "scan-pdf",
    "evalStatus": "pass",
    "unmaskablePiiFindings": { "count": 1 }
  },
  "inferenceDestination": {
    "vendor": "vertex",
    "region": "asia-northeast1",
    "model": "gemini-2.5-flash"
  }
}
```

`auditEvents/0mpfb6dm2-6d7228e4ebccab95` records the paired
`document.import` success event for the same docId.

This public direct document proves the stored chunk path. Its one unmaskable
finding is not the deterministic fixture gate; the M6 deterministic gate below
stays on the dedicated synthetic fixture.

## Deterministic unmaskable fixture

The first smoke uploaded the adopted deterministic fixture twice before the
mainline OCR prompt/schema remediation. The post-deploy re-smoke uploaded the
regenerated fixture once more:

| docId | `document.convert` AuditEvent | Live count |
|---|---|---|
| `11445cb4-778e-4765-ac35-7b1155b64c9d` | `0mpf83yp9-72ed7f58c5fb25ca` | `0` |
| `abb21460-deab-4df8-a32d-64c3ab9108d7` | `0mpf863wz-e46cd0d8615a8e52` | `0` |
| `333e856c-9173-4d3f-8b0e-ab151585921e` | `0mpfb0j5r-a5ec5ee8b2eb4b60` | `4` |

Post-remediation live evidence from
`auditEvents/0mpfb0j5r-a5ec5ee8b2eb4b60`:

```json
{
  "action": "document.convert",
  "conversion": {
    "converterId": "gemini-vertex-ocr",
    "sourceSubtype": "scan-pdf",
    "evalStatus": "pass",
    "unmaskablePiiFindings": { "count": 4 }
  },
  "inferenceDestination": {
    "vendor": "vertex",
    "region": "asia-northeast1",
    "model": "gemini-2.5-flash"
  }
}
```

The post-remediation document was parked at `aiUsePolicy = "requires_masking"`.
Its health eval counted three extracted chunk candidates, but the stored
`documents/333e856c-9173-4d3f-8b0e-ab151585921e/chunks` subcollection had count
`0`. That matches the current PDF orchestration rule for `requires_masking`.

This re-smoke closes the v2 deterministic condition
`synthetic-unmaskable-pii-scan.pdf -> unmaskablePiiFindings.count > 0` on the
dev tenant. The same day local mainline verifier also held `4/4` runs at count
`4`; that local gate is support evidence, not a substitute for this AuditEvent.

## Rejection branches

### 413 size limit

`degraded-scan-fail-closed.pdf` was selected through the IAP upload form. The UI
returned:

```text
ファイルサイズは 5 MB 以下にしてください。
```

Cloud Run request log:

```text
2026-05-21T09:49:45.668377Z  ai-ready-knowledge-hub-00024-sdz  413  0.051977553s
```

This fixture is only size-limit evidence in this smoke. It is not OCR
health/golden evidence.

### 403 subtype mutex

With subtype-1 and subtype-3 both ON for `m-grow-ai.com`, an IAP upload of
`ocr-fail-closed-preflight.pdf` returned:

```text
PDF 変換の feature flag が競合しています。同一テナントで PDF 変換 subtype flag
(official-doc-pdf / slide-pdf / scan-pdf) を複数同時に有効にできません。
```

Cloud Run request log:

```text
2026-05-21T09:53:07.913741Z  ai-ready-knowledge-hub-00024-sdz  403  0.200574910s
```

Cloud Run application log:

```text
2026-05-21T09:53:08.218287Z  ai-ready-knowledge-hub-00024-sdz
[documents] conflicting PDF conversion feature flags {
```

### 400 pre-flight fail-closed

`ocr-fail-closed-preflight.pdf` was uploaded through IAP with only subtype-3 ON.
The UI returned:

```text
PDF ファイルを解析できませんでした。
```

Cloud Run request log:

```text
2026-05-21T09:51:58.115274Z  ai-ready-knowledge-hub-00024-sdz  400  4.033964398s
```

Cloud Run application log:

```text
2026-05-21T09:52:02.250077Z  ai-ready-knowledge-hub-00024-sdz
[documents] PDF extraction failed Error [ScanPdfExtractorError]:
Gemini returned pages with no extractable text
```

Firestore absence check by filename immediately after the rejection:

```json
{
  "fileName": "ocr-fail-closed-preflight.pdf",
  "documentIds": [],
  "auditEventIds": []
}
```

Because the pre-flight path did not create a document, there is no document
subcollection in which chunks could be written and there is no
`document.convert` AuditEvent for this fixture.

## Cloud Run request summary

All re-smoke requests below were served by `ai-ready-knowledge-hub-00024-sdz`:

```text
2026-05-21T09:43:53.620447Z  200  28.252623330s
2026-05-21T09:45:42.992325Z  400  28.925708058s  # NTA OCR/schema pre-flight
2026-05-21T09:47:03.162193Z  200  13.494316608s
2026-05-21T09:48:24.136145Z  200  30.279786221s
2026-05-21T09:49:45.668377Z  413   0.051977553s
2026-05-21T09:51:58.115274Z  400   4.033964398s
2026-05-21T09:53:07.913741Z  403   0.200574910s
```

## M6 v2 DoD closure

| v2 criterion | YES / NO | Evidence |
|---|---|---|
| CI subtype-3 health gate is merge-required and green | YES | `gh pr checks 6`: `conversion-eval / health (required)` pass |
| `m-grow-ai.com` deterministic fixture records `unmaskablePiiFindings.count > 0` in `document.convert` | YES | Post-remediation IAP upload `documents/333e856c-9173-4d3f-8b0e-ab151585921e` recorded AuditEvent `0mpfb0j5r-a5ec5ee8b2eb4b60` with count `4` |
| OCR fail-closed pre-flight leaves no document/chunk/`document.convert` | YES | `ocr-fail-closed-preflight.pdf` returned HTTP 400; Firestore filename check found zero documents and zero audit events |
| `degraded-scan-fail-closed.pdf` proves 5 MiB over-limit rejection and is not reused as OCR health/golden evidence | YES | IAP UI error plus Cloud Run HTTP 413 at `2026-05-21T09:49:45.668377Z` |
| Live smoke docs contain at least one Vertex `inferenceDestination` AuditEvent ID | YES | `auditEvents/0mpfb0j5r-a5ec5ee8b2eb4b60` and `auditEvents/0mpfb6dku-6666817cb8619cae` |

Overall M6 v2 live-smoke closure: **YES**.

Reason: the post-remediation deterministic live upload now records the required
positive unmaskable count on `m-grow-ai.com`, while the dedicated pre-flight,
size-limit, mutex, and Vertex audit evidence remain present in the same re-smoke
window.

## Remediation follow-up

The `2026-05-21` deterministic fixture failure was traced after this smoke:
the fixture had been adopted from the scan-pdf PoC OCR path, while the live
upload used the mainline scan extractor with a different OCR system prompt. The
PoC path reported unmaskable findings; the mainline/live path did not.

Remediation in the repo shares the scan-pdf Gemini OCR prompt, schema, generate
request, and output parsing between PoC and mainline extraction. The existing
`synthetic-unmaskable-pii-scan.pdf` generator was regenerated so damaged field
labels remain visible while exact PII spans are fold-obscured, and the local
acceptance gate now runs:

```bash
pnpm fixtures:scan-pdf:unmaskable:verify
```

The local mainline verifier passed 4/4 runs on `2026-05-21` with
`pii_total = 4`, `pii_maskable = 0`, and `pii_unmaskable = 4` for each trial.
The re-smoke on revision `ai-ready-knowledge-hub-00024-sdz` then recorded live
AuditEvent `0mpfb0j5r-a5ec5ee8b2eb4b60` with count `4`, so the remediation is
closed at the Cloud Run + IAP boundary for this dev-tenant smoke.

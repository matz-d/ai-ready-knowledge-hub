# Phase 3-H-3 slide-pdf live smoke evidence

Date: 2026-05-20

Purpose: Confirm that `slide-pdf` upload works across the real GCP boundary:
Cloud Run + IAP, Firestore `feature_flags`, GCS DocumentIR, Vertex AI, Firestore
`conversion_eval`, chunks, and `AuditEvent document.convert`.

## Deployment / boundary

- Project: `ai-ready-knowledge-hub`
- Region: `asia-northeast1`
- Cloud Run service: `ai-ready-knowledge-hub`
- Cloud Run URL: `https://ai-ready-knowledge-hub-mrvutsz24a-an.a.run.app`
- IAP: enabled (`run.googleapis.com/iap-enabled=true`)
- Runtime service account: `aiknh-runner@ai-ready-knowledge-hub.iam.gserviceaccount.com`
- Smoke revision: `ai-ready-knowledge-hub-00021-wvf`
- Smoke image: `asia-northeast1-docker.pkg.dev/ai-ready-knowledge-hub/knowledge-hub/ai-ready-knowledge-hub:slide-pdf-live-20260520214932`
- Cloud Build id: `06164c1f-05c6-4643-95ac-0d51d9f41e9c`
- Local verification before deploy: `pnpm build` passed.

## Feature flag

Firestore `feature_flags/pdf-conversion-subtype-2` was turned on for the dev
tenant only, with expiry:

```json
{
  "flagId": "pdf-conversion-subtype-2",
  "defaultEnabled": false,
  "enabledTenants": ["m-grow-ai.com"],
  "expiresAt": "2026-06-30T23:59:59.000Z"
}
```

## Live upload

- Access path: Chrome session through Cloud Run IAP.
- IAP actor observed in audit events: `makoto@m-grow-ai.com`
- Tenant: `m-grow-ai.com`
- Fixture: `sample-data/document-conversion/slide-pdf/synthetic-context-package-deck.pdf`
- Upload result: success / curated
- docId: `dc8d42d1-5ab2-4418-9147-32b9852fffaf`
- Curator model shown in UI: `gemini-2.5-flash`
- Curator result:
  - `status`: `curated`
  - `sourceSubtype`: `slide-pdf`
  - `aiUsePolicy`: `direct`
  - `sensitivity`: `Internal`

## Firestore document

`documents/dc8d42d1-5ab2-4418-9147-32b9852fffaf`

```json
{
  "fileName": "synthetic-context-package-deck.pdf",
  "status": "curated",
  "sourceSubtype": "slide-pdf",
  "aiUsePolicy": "direct",
  "latestConversionEvalId": "dc8d42d1-5ab2-4418-9147-32b9852fffaf:v1",
  "storagePath": "raw/dc8d42d1-5ab2-4418-9147-32b9852fffaf/synthetic-context-package-deck.pdf"
}
```

## GCS DocumentIR

Object:
`gs://ai-ready-knowledge-hub-uploads/raw/dc8d42d1-5ab2-4418-9147-32b9852fffaf/document-ir/v1.json`

Object metadata:

```json
{
  "content_type": "application/json",
  "creation_time": "2026-05-20T12:55:36+0000",
  "generation": "1779281736492815",
  "size": 5686
}
```

DocumentIR summary:

```json
{
  "schemaVersion": 1,
  "source": {
    "fileName": "synthetic-context-package-deck.pdf",
    "mediaType": "application/pdf",
    "sourceKind": "upload",
    "sourceSubtype": "slide-pdf"
  },
  "pageCount": 3,
  "blockCount": 15,
  "firstBlocks": [
    { "page": 1, "kind": "heading", "text": "AI-Ready Context Package" },
    { "page": 1, "kind": "paragraph", "text": "Purpose: Prepare an onboarding AI for a small accounting office." },
    { "page": 2, "kind": "heading", "text": "Safety Boundary and Masking" }
  ]
}
```

## Conversion eval

`conversion_eval/dc8d42d1-5ab2-4418-9147-32b9852fffaf:v1`

```json
{
  "evalId": "dc8d42d1-5ab2-4418-9147-32b9852fffaf:v1",
  "docId": "dc8d42d1-5ab2-4418-9147-32b9852fffaf",
  "revisionId": "v1",
  "stage": "health",
  "result": {
    "schemaValidity": { "passed": true, "errors": [] },
    "semanticRetention": { "missingExpectedFields": [] },
    "contextPackageReadiness": {
      "chunkCount": 13,
      "averageChunkLength": 66.3076923076923,
      "oversizedChunks": 0,
      "emptyChunks": 0
    },
    "overall": { "status": "pass", "reasons": [] }
  }
}
```

## Chunks

Firestore path: `documents/dc8d42d1-5ab2-4418-9147-32b9852fffaf/chunks`

- Count: `13`
- First chunk id: `dc8d42d1-5ab2-4418-9147-32b9852fffaf:s1-b1`
- First chunk fields:

```json
{
  "docId": "dc8d42d1-5ab2-4418-9147-32b9852fffaf",
  "sourceType": "slide",
  "structureType": "paragraph",
  "locator": { "kind": "slide", "slide": 1 },
  "title": "synthetic-context-package-deck.pdf",
  "sensitivity": "Internal",
  "aiUsePolicy": "direct",
  "sensitivitySource": "inherited",
  "extractionProvider": "slides",
  "text": "AI-Ready Context Package"
}
```

## AuditEvent

`auditEvents/0mpe2emru-9e9135415a61dcd8`

```json
{
  "tenantId": "m-grow-ai.com",
  "actor": {
    "userId": "makoto@m-grow-ai.com"
  },
  "action": "document.convert",
  "target": {
    "docId": "dc8d42d1-5ab2-4418-9147-32b9852fffaf",
    "fileName": "synthetic-context-package-deck.pdf",
    "sourceKind": "upload",
    "sensitivity": "Internal"
  },
  "result": "success",
  "conversion": {
    "converterId": "gemini-direct-read",
    "sourceSubtype": "slide-pdf",
    "evalStatus": "pass"
  },
  "inferenceDestination": {
    "vendor": "vertex",
    "region": "asia-northeast1",
    "model": "gemini-2.5-flash"
  }
}
```

`auditEvents/0mpe2emt8-8df35ab066e4ba44` also records the paired
`document.import` success event for the same docId.

## Judgment

Live smoke passed. The upload traversed Cloud Run + IAP, used the dev-tenant
Firestore feature flag, called Vertex AI for `slide-pdf`, persisted DocumentIR
to GCS, wrote `documents.latestConversionEvalId`, appended `conversion_eval`,
wrote 13 Firestore chunks, and recorded `document.convert` with
`inferenceDestination.vendor/region/model`.

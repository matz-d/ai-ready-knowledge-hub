# Table-Assist Async Ingest Live Smoke — 2026-06-18

Purpose: verify the production `official-doc-pdf` upload path after disabling
Firestore REST fallback, then confirm the best-effort table-assist async ingest
worker completes through Cloud Tasks.

## Runtime

- Project: `ai-ready-knowledge-hub`
- Cloud Run service: `ai-ready-knowledge-hub`
- Region: `asia-northeast1`
- Revision: `ai-ready-knowledge-hub-00069-2fn`
- Env: `FIRESTORE_PREFER_REST=false`
- Queue: `context-package-jobs`
- Queue state: `RUNNING`
- Queue retry: `maxRetryDuration: 1800s`
- Queue pending tasks after smoke: `[]`

## Temporary Feature Flags

For the smoke only:

- `pdf-conversion-subtype-1`: temporarily enabled for `m-grow-ai.com`
- `pdf-conversion-subtype-3`: temporarily disabled for `m-grow-ai.com`
- `pdf-table-assist`: remained enabled for `m-grow-ai.com`

After the smoke, flags were restored:

- `pdf-conversion-subtype-1`: `enabledTenants` empty
- `pdf-conversion-subtype-3`: `m-grow-ai.com`
- `pdf-table-assist`: `m-grow-ai.com`

## Upload

- Fixture:
  `sample-data/document-conversion/official-doc-pdf/synthetic-official-doc-table-assist-golden.pdf`
- Access path: Chrome session through Cloud Run IAP with `makoto@m-grow-ai.com`
- Upload request:
  - `POST /api/documents`
  - HTTP `200`
  - latency `13.341108424s`
  - timestamp `2026-06-18T04:17:38.417912Z`
- Resulting document:
  - `documents/519d92d2-f138-4865-9467-2c5bd4abb7b1`
  - `status: ai_safe`
  - `sourceSubtype: official-doc-pdf`
  - `conversionError: null`
  - initial UI result showed `ai_safe_ready` with `maskedSpansCount: 0`

This verifies the prior upload blocker
`toProto3JSON: don't know how to convert value 2` no longer reproduces on the
fresh official-doc-pdf upload path.

## Async Worker

Cloud Tasks dispatched the table-assist worker:

- Request:
  `POST /api/documents/519d92d2-f138-4865-9467-2c5bd4abb7b1/table-assist/run`
- User agent: `Google-Cloud-Tasks`
- HTTP `200`
- latency `12.566620136s`
- timestamp `2026-06-18T04:17:51.943992Z`

The worker route reached product reprocess and updated the document:

- `latestConversionEvalId`:
  `519d92d2-f138-4865-9467-2c5bd4abb7b1:reprocess-061930d2-bd5b-4d1d-aa82-68302b15681a`
- `reprocessing: false`
- `reprocessingLeaseId: null`
- `aiSafeStoragePath`:
  `masked/519d92d2-f138-4865-9467-2c5bd4abb7b1/reprocess-1781756272451-synthetic-official-doc-table-assist-golden.pdf`

Conversion eval:

- Path:
  `conversion_eval/519d92d2-f138-4865-9467-2c5bd4abb7b1:reprocess-061930d2-bd5b-4d1d-aa82-68302b15681a`
- Stage: `health`
- Overall: `pass`
- Created at: `2026-06-18T04:17:59.867Z`

Chunks:

- `documents/519d92d2-f138-4865-9467-2c5bd4abb7b1/chunks`
- Count observed via Firestore REST list: `1`
- Chunk id:
  `519d92d2-f138-4865-9467-2c5bd4abb7b1:p1-b1`

## Related Evidence

The current `/upload` multi-file queue was also smoke-tested in production after
this run. See
`docs/upload-multi-file-live-smoke-2026-06-18.md`.

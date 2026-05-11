# Phase 2 Live Smoke

Date: 2026-05-11

## Scope

This run covers `docs/phase-2-design.md` §7 step 13 and the final live-smoke completion item in §8:

- regenerate chunks for one Firestore document
- confirm `documents/{docId}/chunks/` exists and can be read back
- confirm Context Package output reflects chunks
- run the Phase 1 handoff follow-up: DLP provider upload/orchestrator path creates a `masked/...` GCS object for an `ai_safe_ready` input

## Result

Status: **success**

Created smoke document:

- `docId`: `74ef9660-2f0c-4a08-8f65-02fd8fd3c75b`
- `fileName`: `phase2_live_smoke_customer_terms.csv`
- `storagePath`: `raw/74ef9660-2f0c-4a08-8f65-02fd8fd3c75b/phase2_live_smoke_customer_terms.csv`
- `aiSafeStoragePath`: `masked/74ef9660-2f0c-4a08-8f65-02fd8fd3c75b/phase2_live_smoke_customer_terms.csv`

## Commands And Evidence

### 1. ADC check

Command:

```bash
gcloud auth application-default print-access-token
```

Result:

```text
ADC OK token_length=253
```

### 2. Phase 1 handoff: DLP provider upload/orchestrator

Command summary:

```bash
MASKER_PROVIDER=cloud-dlp npx tsx -e "... orchestrateUploadProcessing({ displayName: 'phase2_live_smoke_customer_terms.csv', ... }) ..."
```

Result:

- `kind`: `ai_safe`
- `masker.decision`: `ai_safe_ready`
- `masker.provider`: `cloud-dlp`
- `masker.maskedSpansCount`: `0`
- `status` in Firestore: `ai_safe`

Masked GCS object metadata readback:

```json
{
  "objectPath": "masked/74ef9660-2f0c-4a08-8f65-02fd8fd3c75b/phase2_live_smoke_customer_terms.csv",
  "exists": true,
  "contentType": "text/plain; charset=utf-8",
  "size": "184",
  "customMetadata": {
    "sourceContentHash": "a919c4d1b815d9feb0374a10ab4ad72850285e5a74bf262999584027450d1a79",
    "aiSafeSchemaVersion": "1",
    "provider": "cloud-dlp"
  }
}
```

### 3. Pre-write chunk check

Before running chunk regeneration:

```json
{
  "docId": "74ef9660-2f0c-4a08-8f65-02fd8fd3c75b",
  "existingChunks": 0
}
```

This confirmed the delete phase in `replaceChunksForDocument` was a no-op for this first smoke run.

### 4. Chunk regeneration

Command:

```bash
npm run chunks:regenerate -- 74ef9660-2f0c-4a08-8f65-02fd8fd3c75b
```

Result:

```text
[1/5] OK status=ai_safe storagePath=raw/74ef9660-2f0c-4a08-8f65-02fd8fd3c75b/phase2_live_smoke_customer_terms.csv
[2/5] OK bytes=184
[3/5] OK extractor=csv chunks=1
[4/5] OK
[5/5] OK replacedChunks=1
```

### 5. Firestore chunk readback

Programmatic readback from `documents/{docId}/chunks/`:

```json
[
  {
    "id": "74ef9660-2f0c-4a08-8f65-02fd8fd3c75b:csv:Sheet1",
    "docId": "74ef9660-2f0c-4a08-8f65-02fd8fd3c75b",
    "sourceType": "spreadsheet",
    "structureType": "table",
    "locator": {
      "kind": "spreadsheet",
      "sheetName": "Sheet1",
      "range": "A1:D4"
    },
    "sensitivity": "Confidential",
    "aiUsePolicy": "requires_masking",
    "sensitivitySource": "inherited",
    "hasMaskedText": true
  }
]
```

Firestore console screenshot was not captured in this Codex run; the subcollection existence was verified by direct Firestore readback.

### 6. Context Package chunk reflection

Chunk-aware export was run by calling `buildContextPackageExportInput({ documents, chunks })` with the live Firestore document and its chunks.

Observed output:

```text
## Included Documents

- phase2_live_smoke_customer_terms.csv (sheet=Sheet1, range=A1:D4)
  - Sensitivity: Confidential (AI-safe via masking)

# Full AI-Ready Sources

## Source: phase2_live_smoke_customer_terms.csv (sheet=Sheet1, range=A1:D4)

| 顧客コード | 契約プラン | 月額 | 備考 |
| --- | --- | --- | --- |
| CUST-001 | 標準 | 30000 | 2026年契約条件 |
| CUST-002 | 顧問 | 50000 | 月次レビュー対象 |
| CUST-003 | ライト | 18000 | 年末調整案内対象 |
```

Summary:

```json
{
  "included": 1,
  "humanReview": 0,
  "excluded": 0
}
```

The normal live demo also succeeds when `.env.local` is loaded into the shell:

```bash
set -a; source .env.local; set +a; npm run context:demo:live
```

Observation: bare `npm run context:demo:live` does not load `.env.local` and fails with `KNOWLEDGE_HUB_BUCKET` missing. The chunk-aware check above used `scripts/loadEnv.ts` explicitly.

## Manual Rollback

If this smoke document needs to be removed, delete these resources:

- Firestore: `documents/74ef9660-2f0c-4a08-8f65-02fd8fd3c75b`
- Firestore subcollection: `documents/74ef9660-2f0c-4a08-8f65-02fd8fd3c75b/chunks/*`
- GCS raw object: `raw/74ef9660-2f0c-4a08-8f65-02fd8fd3c75b/phase2_live_smoke_customer_terms.csv`
- GCS masked object: `masked/74ef9660-2f0c-4a08-8f65-02fd8fd3c75b/phase2_live_smoke_customer_terms.csv`

Chunk-only rollback command:

```bash
npx tsx -e "import './scripts/loadEnv.ts'; import { getFirestoreClient } from './src/lib/firestore.ts'; (async () => { const docId = '74ef9660-2f0c-4a08-8f65-02fd8fd3c75b'; const db = getFirestoreClient(); const ref = db.collection('documents').doc(docId).collection('chunks'); const snap = await ref.get(); const batch = db.batch(); for (const doc of snap.docs) batch.delete(doc.ref); await batch.commit(); console.log(JSON.stringify({ docId, deletedChunks: snap.size }, null, 2)); })();"
```


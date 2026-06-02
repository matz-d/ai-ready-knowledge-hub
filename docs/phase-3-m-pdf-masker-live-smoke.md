# Phase 3-M PDF Masker mainline live smoke evidence

Date: 2026-05-29

Purpose: Confirm `D-P3-M-PDF-1` across the real Cloud Run + IAP boundary:
`requires_masking` PDF uploads no longer park as `curated + maskingPending`.
They continue through the PDF Masker mainline and terminate as either
`restricted` or `ai_safe`.

## Boundary

- Project: `ai-ready-knowledge-hub`
- Region: `asia-northeast1`
- Cloud Run service: `ai-ready-knowledge-hub`
- Cloud Run URL: `https://ai-ready-knowledge-hub-mrvutsz24a-an.a.run.app`
- Smoke revision: `ai-ready-knowledge-hub-00028-tgf`
- IAP actor: `makoto@m-grow-ai.com`
- Tenant: `m-grow-ai.com`
- Active PDF feature flag posture at smoke time:
  - `pdf-conversion-subtype-1`: `enabledTenants: []`
  - `pdf-conversion-subtype-2`: `enabledTenants: []`
  - `pdf-conversion-subtype-3`: `enabledTenants: ["m-grow-ai.com"]`
- Runtime Masker provider observed from Cloud Run env: `MASKER_PROVIDER=simple-rule`

## Smoke fixtures

| Branch | Fixture | docId | Final status |
|---|---|---|---|
| `restricted_promoted` | `sample-data/document-conversion/scan-pdf/synthetic-employment-form-scan.pdf` | `7c3cbcdf-9a18-48cf-8ab0-cf2158ceedfb` | `restricted` |
| `ai_safe_ready` | `sample-data/document-conversion/scan-pdf/synthetic-invoice-with-pii-scan.pdf` | `a74b9520-5442-4579-adb8-2781dae8999b` | `ai_safe` |

Both fixtures traversed:

```text
IAP upload
  -> scan-pdf Gemini OCR
  -> DocumentIR GCS write
  -> Curator requires_masking
  -> conversion_eval health
  -> document.convert audit
  -> PDF Masker mainline
  -> restricted or ai_safe terminal status
```

## Restricted branch evidence

Firestore `documents/7c3cbcdf-9a18-48cf-8ab0-cf2158ceedfb`:

```json
{
  "fileName": "synthetic-employment-form-scan.pdf",
  "status": "restricted",
  "sourceSubtype": "scan-pdf",
  "aiUsePolicy": "blocked",
  "sensitivity": "Restricted",
  "sensitivitySource": "masker",
  "originalCuratorSensitivity": "Confidential",
  "maskingPending": null,
  "storagePath": "raw/7c3cbcdf-9a18-48cf-8ab0-cf2158ceedfb/synthetic-employment-form-scan.pdf",
  "aiSafeStoragePath": null,
  "latestConversionEvalId": "7c3cbcdf-9a18-48cf-8ab0-cf2158ceedfb:v1",
  "curator": { "aiUsePolicy": "requires_masking", "sensitivity": "Confidential" },
  "masker": {
    "decision": "restricted_promoted",
    "maskedSpansCount": 3,
    "recommendedSensitivity": "Restricted",
    "residualRisk": { "detected": true }
  },
  "conversionError": null,
  "maskerError": null
}
```

Additional checks:

- Firestore invariant check: `[]`
- Chunk count: `0` (expected for `restricted_promoted`)
- `conversion_eval/7c3cbcdf-9a18-48cf-8ab0-cf2158ceedfb:v1`: health `pass`, `chunkCount: 20`, `unmaskablePiiFindings: 0`
- GCS raw objects:
  - `raw/7c3cbcdf-9a18-48cf-8ab0-cf2158ceedfb/synthetic-employment-form-scan.pdf`
  - `raw/7c3cbcdf-9a18-48cf-8ab0-cf2158ceedfb/document-ir/v1.json`

Audit events for the same docId:

- `document.convert`: `converterId: gemini-vertex-ocr`, `sourceSubtype: scan-pdf`, `evalStatus: pass`, `unmaskablePiiFindings.count: 0`
- `inferenceDestination`: `vendor: vertex`, `region: asia-northeast1`, `model: gemini-2.5-flash`
- `document.import`: success

## AI-safe branch evidence

Firestore `documents/a74b9520-5442-4579-adb8-2781dae8999b`:

```json
{
  "fileName": "synthetic-invoice-with-pii-scan.pdf",
  "status": "ai_safe",
  "sourceSubtype": "scan-pdf",
  "aiUsePolicy": "requires_masking",
  "sensitivity": "Confidential",
  "sensitivitySource": "curator",
  "originalCuratorSensitivity": null,
  "maskingPending": null,
  "storagePath": "raw/a74b9520-5442-4579-adb8-2781dae8999b/synthetic-invoice-with-pii-scan.pdf",
  "aiSafeStoragePath": "masked/a74b9520-5442-4579-adb8-2781dae8999b/synthetic-invoice-with-pii-scan.pdf",
  "latestConversionEvalId": "a74b9520-5442-4579-adb8-2781dae8999b:v1",
  "curator": { "aiUsePolicy": "requires_masking", "sensitivity": "Confidential" },
  "masker": {
    "decision": "ai_safe_ready",
    "maskedSpansCount": 6,
    "recommendedSensitivity": "Confidential",
    "residualRisk": { "detected": false }
  },
  "conversionError": null,
  "maskerError": null
}
```

Additional checks:

- Firestore invariant check: `[]`
- Chunk count: `37`
- First chunk included `maskedText`, `maskedSpansCount`, and `ruleHits`
- `conversion_eval/a74b9520-5442-4579-adb8-2781dae8999b:v1`: health `pass`, `chunkCount: 37`, `unmaskablePiiFindings: 0`
- GCS raw objects:
  - `raw/a74b9520-5442-4579-adb8-2781dae8999b/synthetic-invoice-with-pii-scan.pdf`
  - `raw/a74b9520-5442-4579-adb8-2781dae8999b/document-ir/v1.json`
- GCS masked object:
  - `masked/a74b9520-5442-4579-adb8-2781dae8999b/synthetic-invoice-with-pii-scan.pdf`

Audit events for the same docId:

- `document.convert`: `converterId: gemini-vertex-ocr`, `sourceSubtype: scan-pdf`, `evalStatus: pass`, `unmaskablePiiFindings.count: 0`
- `inferenceDestination`: `vendor: vertex`, `region: asia-northeast1`, `model: gemini-2.5-flash`
- `document.import`: success

## Judgment

`D-P3-M-PDF-1` live smoke passed for both terminal branches:

- `requires_masking` PDF no longer parks as `curated + maskingPending`.
- `restricted_promoted` produces no chunks and keeps `aiSafeStoragePath: null`.
- `ai_safe_ready` writes a masked GCS object and masked chunks.
- `document.convert` audit keeps Vertex inference destination metadata.
- Firestore invariant checks pass for both observed documents.

This closes the previously listed residual task: "Masker PDF mainline dev tenant
live smoke evidence".

## Follow-up candidates

### `ai_safe` Context Package path

Follow-up smoke on 2026-05-29 used the `ai_safe_ready` document
`a74b9520-5442-4579-adb8-2781dae8999b` with this purpose:

```text
税理士事務所の請求書サンプルから、AIに渡せる料金管理・請求処理の文脈だけを整理する。個人情報や口座情報はマスク済みの情報だけ使う。
```

Observed behavior:

- The first browser/API attempt with `limit: 20` failed in the app with Vertex
  `INVALID_ARGUMENT`: input token count `224204` exceeded the model limit
  `131072`. This confirmed the need for a pre-LLM token/chunk budget (since
  implemented in `budget.ts`; see Judgment below).
- A narrowed `limit: 2` run completed inside Cloud Run as HTTP 200 in
  `37.679s` and wrote a `document.export` AuditEvent:
  `auditEvents/0mpqmmgow-452b55aa7ef489aa`.

**運用確認クエリ（Firestore composite index 反映後）** — 正本は
[`firestore.indexes.json`](../firestore.indexes.json)（`action` + `occurredAt`、
`target.docId` + `occurredAt`）。手順は [demo-runbook.md §2 項目 7](demo-runbook.md)。

```bash
# 最新 document.export（index error なしで 1 件以上）
pnpm exec tsx -e "import './scripts/loadEnv.ts'; import { getFirestoreClient } from './src/lib/firestore.ts'; (async () => { const db = getFirestoreClient(); const snap = await db.collection('auditEvents').where('action','==','document.export').orderBy('occurredAt','desc').limit(5).get(); console.log(JSON.stringify({ count: snap.size, events: snap.docs.map(d => ({ id: d.id, docId: d.get('target')?.docId, occurredAt: d.get('occurredAt')?.toDate?.()?.toISOString?.() })) }, null, 2)); })();"

# 本 smoke の ai_safe invoice（docId lookup）
pnpm exec tsx -e "import './scripts/loadEnv.ts'; import { getFirestoreClient } from './src/lib/firestore.ts'; (async () => { const docId = 'a74b9520-5442-4579-adb8-2781dae8999b'; const db = getFirestoreClient(); const snap = await db.collection('auditEvents').where('target.docId','==',docId).orderBy('occurredAt','desc').limit(10).get(); console.log(JSON.stringify({ docId, count: snap.size, events: snap.docs.map(d => ({ id: d.id, action: d.get('action'), occurredAt: d.get('occurredAt')?.toDate?.()?.toISOString?.() })) }, null, 2)); })();"
```

期待: 前者に `0mpqmmgow-452b55aa7ef489aa` が含まれる。後者は当該 docId の
`document.convert` / `document.export` 等が `occurredAt` 降順で返る。
- The browser-side fetch for the same `limit: 2` request received a Google 502
  HTML response after roughly 33 seconds. Treat this as a UI/IAP boundary
  timeout risk even though the app completed and audit recorded success.
- Running the same `runStrategistOrchestrator({ limit: 2 })` path locally
  against live Firestore confirmed the content contract:
  - `sourceDocumentsReviewed: 2`
  - `includedCount: 24`
  - all included rows for the invoice had `aiUsePolicy: "requires_masking"`
  - included rows used `maskedText`
  - rendered markdown contained `Confidential (AI-safe via masking)`
  - rendered markdown contained `SYN-INV-2[REDACTED:POSTAL_CODE]`
  - rendered markdown did **not** contain raw `SYN-INV-2026-0501`

Representative included chunk:

```json
{
  "chunkId": "a74b9520-5442-4579-adb8-2781dae8999b:p1-ocr1",
  "aiUsePolicy": "requires_masking",
  "text": "請求書番号: SYN-INV-2026-0501",
  "maskedText": "請求書番号: SYN-INV-2[REDACTED:POSTAL_CODE]"
}
```

Judgment: masked chunk selection for `ai_safe` PDF works. The smoke exposed two
operational gaps; both are addressed in code after this smoke run:

- **Pre-LLM budget（実装済み）:** `src/services/strategistOrchestrator/budget.ts`
  が safety gate 通過後・Strategist 呼出前に chunk / document / prompt 文字数を
  決定論的に絞り込む。`limit: 20` のような広い Inventory 読み取りでも LLM 入力
  上限超過を防ぐ。API は推定 20 秒超で **422 `sync_budget_exceeded`** を返し、
  `docIds` / `limit` で絞るガイダンスを含む。
- **strict `docIds` resolution（実装済み）:** `resolveInventoryDocumentsByIds`
  が unknown / non-terminal docId を 400 で返す。UI（`ContextPackageForm`）は
  `docIds` テキスト入力とエラー詳細表示に対応。

**同期 re-smoke 時点の課題（同日後続で一部解消）:**

- UI の docIds 導線 — Inventory から docId を選ぶ UX（手入力以外）
- ~~非同期 job 化~~ — 同期 live smoke の `33.716s` を根拠に実装し、同日の
  [Context Package 非同期 live smoke](#context-package-非同期-job-本番-live-smoke2026-06-02)
  で本番配線まで完了

### Context Package budget / strict `docIds` re-smoke（2026-06-02）

PR #12 merge 後の Cloud Run + IAP 境界で、上記の後続実装を再 smoke した。

| Item | Observed |
| --- | --- |
| Cloud Run revision | `ai-ready-knowledge-hub-00029-9b9` |
| Deploy image | `asia-northeast1-docker.pkg.dev/ai-ready-knowledge-hub/knowledge-hub/ai-ready-knowledge-hub:c902c09` |
| IAP actor | `makoto@m-grow-ai.com` |
| Target docId | `a74b9520-5442-4579-adb8-2781dae8999b` |
| Purpose | `invoice billing masked only` |
| Live request | `POST /api/context-package` → HTTP `200` in `33.716634292s` |
| Result counts | Included `6`, Excluded `31`, Safety Excluded `0`, Missing `0`, Review Questions `0` |
| New export audit | `auditEvents/0mpwh5v5k-68aa4bc141a6fbc1` |

Live Markdown / UI の content contract:

- `Confidential (AI-safe via masking)` を含む。
- `SYN-INV-2[REDACTED:POSTAL_CODE]`、`[REDACTED:BANK_ACCOUNT]`、
  `[REDACTED:JP_MYNUMBER]`、`[REDACTED:PHONE]` を含む。
- raw `SYN-INV-2026-0501` は含まない。
- 「マイナンバー出力あり」は raw 値の出力ではなく、
  `[REDACTED:JP_MYNUMBER]` への置換済み出力を意味する。

deployed UI で strict `docIds` resolution も確認した。存在しない
`does-not-exist-live-smoke` を指定すると、`POST /api/context-package` は HTTP
`400` を返し、UI は `存在しない docId: does-not-exist-live-smoke` を表示した。
指定 docId が黙って欠落する挙動はない。

Firestore composite index は `action + occurredAt`、`target.docId + occurredAt`
の 2 本とも `READY`。`document.export` の降順クエリで上記 audit を取得できた。

ローカルの全 Inventory smoke では、既定 budget
（`maxDocuments: 5`、`maxChunks: 80`、`maxTotalPromptChars: 45_000`、
`maxCharsPerChunk: 1_200`）が `474` candidates を `80` chunks に制限し、
`394` drops を response metadata に記録した。Vertex 上限超過は再発していない。

Judgment: pre-LLM budget、strict `docIds`、masked Context Package、Firestore
audit index は live 境界で動作した。同期生成の `33.716s` は blocker ではないが、
非同期 job 化を進める根拠として残す。

### Context Package 非同期 job 本番 live smoke（2026-06-02）

同期 re-smoke 後、`202 Accepted` + Firestore job + Cloud Tasks worker を本番へ
配線した。IAP audience 付き Worker SA token で service-to-service 境界を確認し、
同一の `ai_safe_ready` invoice を `docIds` 指定して再 smoke した。

| Item | Observed |
| --- | --- |
| Cloud Run revision | `ai-ready-knowledge-hub-00033-vrw` |
| Target docId | `a74b9520-5442-4579-adb8-2781dae8999b` |
| Job ID | `8ce6a64b-54a5-4368-b7b6-866406c3d308` |
| Initial request | `POST /api/context-package` → HTTP `202` in `1.295306353s` |
| Polling | `queued` → `running` → `succeeded` |
| Worker request | `POST /api/context-package/jobs/:jobId/run` → HTTP `200` in `19.652927793s` |
| Result request | `GET /api/context-package/jobs/:jobId/result` → HTTP `200` |
| End-to-end result fetch | 約 `22.5s` |
| Queue after smoke | `context-package-jobs` pending task なし |

同期 smoke の初回応答 `33.716634292s` と比べ、非同期化後の初回応答は
`1.295306353s`。`32.421s`、約 `96%` 短縮した。生成時間自体はモデル応答で
変動するが、UI は長い HTTP 応答でブロックされず、status polling で進行状態を
表示できる。

本番配線では Cloud Tasks queue、Worker SA、IAP accessor、IAP programmatic
OAuth client allowlist、Secret Manager `context-package-job-token`、GitHub
Variables を設定した。`NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED=true` は Docker
build-arg で client bundle に焼き込み、`mode:"auto"` と polling UI が含まれることを
確認した。今回の最終 smoke は service-to-service IAP 境界の検証であり、human
browser の手動操作は追加していない。

実配線時に Secret Manager token の末尾改行で worker が 401 になる事象を確認した。
token を改行なしで version `2` へ rotate し、[setup-gcp.md](setup-gcp.md) の生成例も
`tr -d '\n'` 付きへ修正した。smoke 用に一時付与した Token Creator 権限は検証後に
削除済み。

### scan-pdf eval locator / coverage

**Smoke 時点（2026-05-29、本 doc 初版）** の conversion eval レコードは
`pageCoverage: 0` / `hasPageLocators: false` を報告した。stored chunks は
`locator.kind: "imageText"` + bbox warning を持っており、mainline 自体の失敗では
なかった。

**修正後（実装済み）:** `src/eval/conversion/heuristic/pageEvidence.ts` が
`imageText` locator（`page` / `pageNumber`）と `extractionWarnings` 内の page
ヒントを page evidence として扱う。health eval の scan-pdf fixture では
`pageCoverage=1`、`hasPageLocators=true` を確認（
`runConversionEvalHealthCheck.test.ts`）。live smoke 時に書き込まれた
`conversion_eval/*:v1` 行は修正前の eval shape のまま残る可能性があるが、
**現行 health eval 契約では scan-pdf の page locator / coverage は解消済み**。

### `unmaskablePiiFindings` threshold after Masker

Both live-smoked PII fixtures recorded `unmaskablePiiFindings.count: 0`. The
deterministic unmaskable fixture remains covered by the earlier scan-pdf smoke.
Public expansion for scan-pdf should still **re-evaluate the threshold** now that
Masker mainline is connected (`D-P3-H-7 Q2` 後続、別 decision）。

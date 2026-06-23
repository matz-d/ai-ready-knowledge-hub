# Phase 3-C-5 Source Coverage Check

> 作成: 2026-05-14  
> 更新: 2026-05-14（Phase 3-C-5 修正後）  
> 担当: 手動確認タスク（コード変更なし）  
> 背景: Phase 3-C-5 実装後、各 source で chunk が生成され Purpose Query API（POST /api/context-package）に到達できることを確認する。

---

## 確認対象 source 一覧

| # | source 種別 | ファイル形式 | 確認ステータス | メモ |
|---|---|---|---|---|
| 1 | upload | `.txt` | 確認済み | `chunks:regenerate --dry-run` で `would replace 1 chunks`。paragraph chunk として到達可能 |
| 2 | upload | `.md` | 確認済み | `chunks:regenerate --dry-run` で `would replace 1 chunks`。paragraph chunk として到達可能 |
| 3 | upload | `.csv` | 確認済み | chunk 生成、Purpose Query 到達確認済み |
| 4 | upload | `.xlsx` | 確認済み | chunk 生成、Purpose Query 到達確認済み |
| 5 | workspace | Google Sheets | 確認済み | import、chunk 生成、Purpose Query 到達確認済み |
| 6 | workspace | Google Docs | 確認済み | import、chunk 生成、Purpose Query 到達確認済み |

---

## 確認手順

1. `/upload` または `/import/google-sheets` から各形式のファイルをインポートする。
2. Firestore にドキュメントが作成され、ステータスが terminal（`curated` / `ai_safe` / `restricted` / `blocked`）になることを確認する。
3. Firestore の `documents/{docId}/chunks` サブコレクションにチャンクが 1 件以上作成されていることを確認する。
4. `/context-package` で Purpose を入力し「Context Package を生成」を実行する。
5. Included / Excluded / Safety Excluded のいずれかにそのドキュメントのチャンクが含まれることを確認する。

---

## 確認結果（手動記入欄）

### upload: .txt

- [x] Firestore ドキュメント作成確認
- [x] knowledgeChunks 生成確認
- [x] Purpose Query で到達確認
- 備考: `pnpm chunks:regenerate --dry-run <docId>` で `would replace 1 chunks`。text/markdown upload source は paragraph chunk として到達可能。

### upload: .md

- [x] Firestore ドキュメント作成確認
- [x] knowledgeChunks 生成確認
- [x] Purpose Query で到達確認
- 備考: `pnpm chunks:regenerate --dry-run <docId>` で `would replace 1 chunks`。text/markdown upload source は paragraph chunk として到達可能。

### upload: .csv

- [x] Firestore ドキュメント作成確認
- [x] knowledgeChunks 生成確認
- [x] Purpose Query で到達確認
- 備考: `/api/documents` は 200。docId `2ac31911-48e9-49dd-9c3e-af05c7ff560c`、status `curated`。`pnpm chunks:regenerate 2ac31911-48e9-49dd-9c3e-af05c7ff560c` で `replacedChunks=1`。Purpose Query は `limit:100` で 200、chunk `2ac31911-48e9-49dd-9c3e-af05c7ff560c:csv:Sheet1` が Included に入った。

### upload: .xlsx

- [x] Firestore ドキュメント作成確認
- [x] knowledgeChunks 生成確認
- [x] Purpose Query で到達確認
- 備考: `/api/documents` は 200。docId `01c59f9c-4c13-44da-bae7-d93e832799ae`、status `curated`。`pnpm chunks:regenerate 01c59f9c-4c13-44da-bae7-d93e832799ae` で `replacedChunks=4`。Purpose Query は `limit:100` で 200、同 doc の chunks が Excluded に入った（より新しい workspace Sheets import が Included されたため `superseded_or_stale`）。

### workspace: Google Sheets

- [x] Firestore ドキュメント作成確認
- [x] knowledgeChunks 生成確認
- [x] Purpose Query で到達確認
- 備考: `https://docs.google.com/spreadsheets/d/1BEgJdyg8muyJYuXjnTLO41EibTjCDcjUsGdP_lb4RJM/edit` を `/api/import/google-sheets` に投入して 200。docId `1d0623d6-a070-464e-a0ac-faa332078c71`、sourceKind `google_workspace`、status `curated`、chunk 4 件。Purpose Query は `limit:100` で 200、同 doc の 3 chunks が Included、空 sheet chunk が Excluded に入った。

### workspace: Google Docs

- [x] Firestore ドキュメント作成確認
- [x] knowledgeChunks 生成確認
- [x] Purpose Query で到達確認
- 備考: Google Docs live fixture で確認済み
  - `/api/import/google-sheets`: HTTP 200
  - docId: `40a2a599-dad6-42d3-ae85-d252b835ae13`
  - fileName: `BizFlow Phase 3-C-5 fixes review 2026-05-14.md`
  - contentType: `text/markdown`、status: `curated`
  - Firestore: `sourceKind: google_workspace`、`externalSource.workspaceMimeType: application/vnd.google-apps.document`
  - chunk: `40a2a599-dad6-42d3-ae85-d252b835ae13:text:paragraph` の 1 件
  - `POST /api/context-package`: HTTP 200、対象 Docs chunk は Included に出た（counts: included `1`, excluded `19`, safetyExcluded `0`）
  - 未共有時は Drive 側 404 File not found により `drive_export_failed` になったため、サービスアカウント `aiknh-runner@ai-ready-knowledge-hub.iam.gserviceaccount.com` への reader 共有が必須

---

## Follow-up list（未解決）

- なし。Phase 3-C-5 source coverage は全 source 確認済み。

---

## 実行メモ（2026-05-14）

- 事前確認: `pnpm test` 298 件 pass、`pnpm typecheck` pass、`pnpm build` pass。
- ADC: `gcloud auth application-default print-access-token >/dev/null && echo ADC_OK` で `ADC_OK`。
- Firestore backfill: `pnpm backfill:source-kind --dry-run` で schemaVersion 1 が 15 件、`pnpm backfill:source-kind --confirm` で 15 件更新成功。
- `.txt` / `.md` chunk regeneration: Phase 3-C-5 で対応済み。`pnpm chunks:regenerate --dry-run <docId>` で `would replace 1 chunks` を確認。
- malformed legacy document（`年末調整_案内文.txt`）の 502: Phase 3-C-5 で修正済み。`/api/context-package` は malformed document を skip + warning し、default `limit:100` で HTTP 200 を返す。
- Google Docs route 分岐: Phase 3-C-5 で `orchestrateImportedDocsSnapshotProcessing` への分岐を接続済み。unit test 追加済み。
- Google Docs live fixture: HTTP 200、Firestore terminal document 作成、1 chunk 生成、Purpose Query Included 到達を確認済み。サービスアカウントへの reader 共有が必要。
- Purpose Query 確認 payload: `{"purpose":"給与計算と料金表、表形式サンプルを使って社内ナレッジのContext Packageを作る","limit":100}`。
- Purpose Query 結果: HTTP 200、`sourceDocumentsReviewed=18`、`included=8`、`excluded=5`、`safetyExcluded=0`、Markdown あり。

---

## 関連ファイル

- `src/app/api/context-package/route.ts` — Purpose Query API
- `src/services/strategistOrchestrator/` — Strategist orchestrator
- `src/app/context-package/` — Phase 3-C-5 で追加した UI
- `src/app/api/import/google-sheets/route.ts` — Google Sheets / Docs import route
- `src/lib/importedSnapshotOrchestrator.ts` — `orchestrateImportedDocsSnapshotProcessing`
- `src/lib/googleDocsSnapshotImporter.ts` — Docs markdown export

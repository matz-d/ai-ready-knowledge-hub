# Phase 3-A 設計 — Google Sheets Snapshot Import

Phase 3-A は **Google Sheets を Workspace 上の構造化情報として URL / fileId から直接取り込み、Phase 2 で構築した既存の分類・マスキング・chunk・Context Package 経路に乗せる** フェーズ。本書は Phase 3-A の正本（決定事項）と、Phase 2 (構造化 Ingestion) からの引き継ぎ情報を固定する。

関連:
- [docs/phase-2-design.md](phase-2-design.md)
- [docs/architecture.md](architecture.md)
- [docs/firestore-schema.md](firestore-schema.md)
- [docs/decisions.md](decisions.md)
- [src/lib/firestoreSchema.ts](../src/lib/firestoreSchema.ts)
- [src/lib/uploadOrchestrator.ts](../src/lib/uploadOrchestrator.ts)
- [src/lib/extractors/xlsxExtractor.ts](../src/lib/extractors/xlsxExtractor.ts)
- [src/lib/parseFirestoreDocumentData.ts](../src/lib/parseFirestoreDocumentData.ts)

---

## 0. Phase 2 引き継ぎ

Phase 2 (構造化 Ingestion / KnowledgeChunk) は完了。Phase 3-A は **Phase 2 の `.xlsx` パイプラインに `.xlsx` snapshot を流し込む新しい入口を追加する** だけで成立する設計とする。

### 利用する Phase 2 資産
- `xlsxToNormalizedMarkdown` / `xlsxToMarkdownSheets` / `extractXlsx` ([src/lib/extractors/xlsxExtractor.ts](../src/lib/extractors/xlsxExtractor.ts))
- `orchestrateUploadProcessing` の `[C] Firestore set` 以降の lifecycle ([src/lib/uploadOrchestrator.ts](../src/lib/uploadOrchestrator.ts))
- `validateFirestoreDocumentInvariants` の 9 ルール ([src/lib/firestoreSchema.ts](../src/lib/firestoreSchema.ts))
- `chunks:regenerate` の拡張子判定パス ([scripts/regenerateChunks.ts](../scripts/regenerateChunks.ts))
- Context Package の `.xlsx` markdown 化経路 ([src/lib/contextPackageFirestoreAdapter.ts](../src/lib/contextPackageFirestoreAdapter.ts))

### Phase 3-A で触らないこと
- Phase 2 の `validateFirestoreDocumentInvariants` 9 ルール
- 既存の `/api/documents` (multipart upload) の挙動
- chunk subcollection の生成ロジック / size guard

---

## 1. 設計原則

1. **Snapshot Source として取り込む**。Live source（常時同期）ではなく、明示的な「import run」によるスナップショットとして扱う。元ファイル metadata を残し、将来の再取り込み・差分検知の足場にする。
2. **A 案（Drive export `.xlsx` snapshot）一本通し**。Sheets API で JSON を組む B 案は将来的に強力だが抽象化コストが高い。Phase 3-A は Drive API `files.export` で `.xlsx` バイトを取得し、Phase 2 の `.xlsx` extractor 資産を最大利用する一本線にする。
3. **Google Sheets は内部的に `.xlsx` document として扱う**。Firestore `fileName` には `.xlsx` suffix を付け、`contentType` は OOXML を固定で渡し、`storagePath` も `raw/{docId}/{safeName}.xlsx` とする。Phase 2 pipeline に追加の分岐を入れない。
4. **`googleapis` を本線**。`gws` / MCP / gog.cli は開発・運用補助に留める。
5. **`sourceKind` / `externalSource` は明示フィールドとして追加する**。既存 document は parser / adapter の defaulting で `sourceKind: 'upload'` / `externalSource: null` とみなす。schemaVersion は上げない（production 化のときに backfill + schemaVersion up）。
6. **失敗時 rollback は Phase 2 と同じ順序ルール**。`export → upload raw → Firestore initial set → [D] curating update → [E][F][G][H]` の各段で前段を巻き戻す。
7. **Phase 3-A は同期しない**。自動 sync・書き戻し・差分検知・重複 de-dup はすべて Phase 3-B 以降。

---

## 2. 採用判断ログ（Phase 3-A 着手前の合意）

### D-P3-A-1: Snapshot 取り込みのアプローチ = **A 案 (Drive export `.xlsx`)**

**選んだ案**: Google Drive API `files.export` で `.xlsx` バイトを取得し、Phase 2 の `xlsxToNormalizedMarkdown` / `extractXlsx` にそのまま流す。

**代替案:**
- (A) **Drive export `.xlsx` snapshot** ← 採用
- (B) Sheets API で values / ranges を JSON snapshot 化し、新しい extractor を組む

**選定理由:**
- Phase 2 で `xlsxToMarkdownSheets` が OOXML zip magic number (`0x50 0x4b`) で読める作りになっており、Drive export `.xlsx` は同じ OOXML パッケージなので extractor をそのまま再利用できる。
- B 案は range 自己管理・複数論理表の自動分割・型システムをすべて自前で抱える必要があり、Phase 3-A で着地しない。
- A 案で実装してから、必要になったら B 案的な range 選択を `externalSource` に重ねていける。

**撤退条件:** Drive export `.xlsx` で cell formatting（日付 serial / formula cached value / merged cell）が user upload `.xlsx` と大きく乖離し、`xlsxToMarkdownSheets` が正しく markdown 化できないケースが典型ユースケースとして観測された場合、B 案または専用 normalizer を Phase 3-B で検討する。

### D-P3-A-2: `sourceKind` / `externalSource` のスキーマ進化 = **defaulting で吸収（schemaVersion up しない）**

**選んだ案**: `FirestoreDocument` に `sourceKind` / `externalSource` を追加する。既存 document（これらのフィールドがない）は **parser / adapter 側で `sourceKind: 'upload'`, `externalSource: null` を当てて defaulting** で吸収する。`FIRESTORE_DOCUMENT_SCHEMA_VERSION` は **1 のまま据え置く**。

**代替案:**
- (a) schemaVersion を 2 に上げ、`scripts/backfillSourceKind.ts` を 1 回走らせる
- (b) **defaulting で吸収** ← 採用

**選定理由:**
- Phase 3-A は PoC 段階。production 移行時に (a) へ昇格できればよい。
- (a) は backfill 失敗時のロールバック手順、走行中の document write との競合、テストの再生成すべてを抱える。PoC で抱えるコストに見合わない。
- (b) は新規 document に明示的に書き、既存 document は default で吸収するだけ。invariant の 9 ルールにも影響しない。

**撤退条件:** production 化時、または `externalSource` 必須を前提とした invariant ルール（例: 「`sourceKind='google_workspace'` なら `externalSource !== null`」）を Firestore 側で強制したくなった時点で、(a) に切り替えて schemaVersion を 2 に上げる。

### D-P3-A-3: hash field の重複 = **`contentSha256` 一本に統一**

**選んだ案**: Snapshot bytes の SHA256 は **既存の `contentSha256` field をそのまま使う**。`externalSource.exportSha256` は **持たない**。

**代替案:**
- (a) `externalSource.exportSha256` を別途持つ
- (b) **`contentSha256` 一本** ← 採用

**選定理由:**
- `validateFirestoreDocumentInvariants` は `masker.sourceContentHash === contentSha256` を要求している ([src/lib/firestoreSchema.ts](../src/lib/firestoreSchema.ts))。Snapshot の export bytes hash がそのまま `contentSha256` になるので、別 field を持つと「常に同値」の冗長フィールドになり混乱の元。
- `contentSha256` の意味を「**upload raw bytes または imported snapshot bytes の hash**」とコメントで明記すれば足りる。

**撤退条件:** Phase 3-B 以降で「Drive 上で modified されたが re-export 後に同一 bytes だった」のような差分検知が必要になり、export 行為自体の証跡を残したくなった場合は `externalSource.exportSha256` を追加する。ただしその時点でも `contentSha256` 自体は snapshot bytes の hash としての意味を維持する。

### D-P3-A-4: 認証戦略 = **Service Account 共有前提（OAuth は Phase 3-A ではやらない）**

**選んだ案**: server-side ADC または env credentials で `drive.readonly` スコープを使う。**Sheet を読むには、ユーザーが Sheet を service account email と共有する必要がある**。

**代替案:**
- (a) **SA 共有前提** ← 採用
- (b) OAuth user delegation（user credential 経由）

**選定理由:**
- (b) はトークン管理・refresh・user セッションとの紐付けを Phase 3-A で持ち込むには重い。
- (a) は demo / PoC で詰みやすい部分（共有忘れ）を UI 側で軽減できる。

**運用上の必須対応:**
- UI に **service account email をコピーできる表示**を置く。
- 403 エラー時にも「Sheet を `{SA_EMAIL}` と共有してください」を明示する。
- demo runbook ([docs/demo-runbook.md](demo-runbook.md)) に SA 共有手順を追記する。

**撤退条件:** demo 後の運用で「ユーザーが SA 共有手順を踏まない」ことが致命傷になった場合、Phase 3-B 以降で OAuth user delegation を入れる。

### D-P3-A-5: URL パーサ = **`gid` を無視して全シート import**

**選んだ案**: `urlOrFileId` 入力から fileId を抽出する。URL に `gid=...`（特定タブの sheetId）が含まれていても **無視して全シートを import** する。

**代替案:**
- (a) `gid` を解釈して該当シートだけ取り込む
- (b) **`gid` を無視して全シート取り込み** ← 採用

**選定理由:**
- (a) は Phase 3-A の「複雑にしすぎない」原則に反する。A 案は全シートを `.xlsx` snapshot として一括で取るのが本筋。
- UI に「特定タブの URL でも全シートを取り込みます」と明示すれば、ユーザー体験上の混乱は避けられる。

**撤退条件:** ユーザーが「タブ単位で取り込みたい」と求めるユースケースが優勢になった場合、Phase 3-B で `externalSource.selectedSheetIds` のような選択フィールドを追加する。

**サポートする URL 形:**
```
https://docs.google.com/spreadsheets/d/{fileId}/edit
https://docs.google.com/spreadsheets/d/{fileId}/edit#gid=123456
https://docs.google.com/spreadsheets/d/{fileId}/edit?usp=sharing
https://docs.google.com/spreadsheets/d/{fileId}
{fileId}                                   ← 素のID
```

### D-P3-A-6: 重複 import の扱い = **許容（毎回新規 docId）**

**選んだ案**: 同じ Sheet URL を 2 回入れても **毎回新規 docId を発行**して 2 件 document を作る。`externalSource.fileId` / `modifiedTime` / `importedAt` で後から比較できるようにする。

**代替案:**
- (a) `externalSource.fileId` で de-dup して既存 document を上書き
- (b) **毎回新規** ← 採用

**選定理由:**
- (a) は「上書き」の意味が `chunks:regenerate` / Context Package の再生成と絡んで設計が膨らむ。
- PoC では「同 fileId の document が複数あれば一覧画面で最新を採用」で十分。

**撤退条件:** demo 運用で「同じ Sheet を何度も入れて document が溢れる」が痛くなった場合、Phase 3-B で `externalSource.fileId` をキーにした de-dup または上書き import を入れる。

### D-P3-A-7: orchestrator の切り出し方 = **入口別 / 後段 lifecycle 共通**

**選んだ案**: `orchestrateUploadProcessing`（既存）と `orchestrateImportedSnapshotProcessing`（新設）の **入口を分け、`[C] Firestore set` 以降の lifecycle を共通化**する。初期 document body（`FirestoreInitialDocumentDraft`）は入口ごとにビルドする。

**理由:**
- 初期 body は `sourceKind` / `externalSource` が入口で異なるが、`[D] curating update` 以降は完全に共通。
- Phase 2 の orchestrator を肥大化させると invariant 検査・rollback 順序の追跡が難しくなる。

**実装方針:**
- `buildInitialDocumentBody` を **`buildUploadInitialDocumentBody` / `buildImportedSnapshotInitialDocumentBody`** の 2 つに分ける（または共通 builder に source metadata 引数を取らせる）。
- 上記 builder の上に薄い `orchestrateImportedSnapshotProcessing(input)` を新設する。
- `runCuratorAndMaskerLifecycle(args)` のような共通内部関数を切り出し、両 orchestrator から呼ぶ。

### D-P3-A-8: 実装場所 = **`src/` 本線**

**選んだ案**: Phase 2 と同じく、最初から `src/` 配下に実装する。`poc/w3/` は作らない。

**理由:**
- 取り込みパスの方向性は固まっている（A 案、`.xlsx` 経由、Phase 2 pipeline）。探索フェーズではない。
- PoC Workspace Policy（Week 1）は探索段階限定の方針。Phase 3-A は適用しない。

### D-P3-A-9: Fixture 固定 = **Drive export 由来の `.xlsx` を 1 つ commit**

**選んだ案**: 実際の Drive export 由来の `.xlsx` を fixture として 1 つ commit し、`xlsxToMarkdownSheets` で読めることを test する。

**理由:**
- Drive export `.xlsx` は user upload `.xlsx` と cell formatting（日付 serial / formula cached value / merged cell / number format）の挙動が微妙に違う可能性がある。
- Fixture を 1 つ固定するだけで、回帰の発見が早くなる。

---

## 3. データスキーマ拡張

### 追加フィールド

```ts
// FirestoreDocument の追加フィールド
sourceKind: 'upload' | 'google_workspace';

externalSource: null | {
  provider: 'google_drive';
  workspaceMimeType: 'application/vnd.google-apps.spreadsheet';
  fileId: string;
  name: string;                  // Drive 上の元ファイル名（拡張子なし）
  webViewLink?: string;
  modifiedTime?: string;         // Drive 上の最終更新時刻
  importedAt: string;            // アプリの取り込み時刻
  exportedAt: string;            // Drive export bytes 確定時刻
  exportMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
};
```

**意味分けの補足:**
- `importedAt`: 「インポート run の開始時刻」。UI 上で一覧に出す時刻。
- `exportedAt`: 「Drive export が成功した時刻」。差分検知や retry を入れる Phase 3-B 以降で効く。
- `modifiedTime`: Drive 側の値（再取り込み時に変わったかの判定に使う）。
- `exportSha256` は **持たない**。snapshot bytes hash は `contentSha256` で表現する。

### 既存フィールドへの影響

- `contentSha256`: 意味を「**upload raw bytes または imported snapshot bytes の SHA256**」とコメントで明記する。
- `contentType`: Sheets 取り込み時は OOXML を固定で書く（`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`）。
- `fileName`: `${driveMeta.name}.xlsx` で書く（Drive の元ファイル名に `.xlsx` suffix を付ける）。
- `storagePath`: `raw/{docId}/{safeName}.xlsx`。

### Defaulting の適用範囲

`sourceKind` / `externalSource` を欠く既存 document への defaulting は、以下のすべてに適用する。

- [src/lib/parseFirestoreDocumentData.ts](../src/lib/parseFirestoreDocumentData.ts): read 時の defaulting
- `FirestoreDocument` type: optional または `| undefined` 表現
- `FirestoreInitialDocumentDraft` ([src/lib/uploadOrchestrator.ts](../src/lib/uploadOrchestrator.ts)): **upload 側の初期 body にも `sourceKind: 'upload'`, `externalSource: null` を明示的に書く**
- 既存テスト fixtures: 新しい shape を含むように更新

---

## 4. スコープ

### やること
- `/import/google-sheets` UI と `POST /api/import/google-sheets` API
- Google Drive API `files.get` での metadata 取得
- Google Drive API `files.export` で `.xlsx` 変換
- GCS raw への `.xlsx` snapshot 保存
- Firestore `documents/{docId}` への `sourceKind='google_workspace'` / `externalSource` 付き登録
- Phase 2 lifecycle ([D] 以降) の再利用
- 既存 `chunks:regenerate` と `context:demo:live` への連携
- Drive export `.xlsx` fixture の追加と extractor 互換テスト
- Service account email を表示する UI と 403 エラー時の案内

### やらないこと
- 自動同期（Live source）や Google Sheets への書き戻し
- Gmail / Chat / Docs 取り込み（後続フェーズ）
- 個別 Range / シート選択（`gid` は無視）
- 重複 import の de-dup / 上書き import
- OAuth user delegation
- MCP / gws の本線組み込み
- schemaVersion の bump と backfill script

---

## 5. エラー処理（Failure Policy）

| ケース | HTTP | 挙動 |
| --- | --- | --- |
| fileId parse 失敗 | 400 | Firestore に何も書かない |
| Drive metadata 取得失敗 (403 / 404) | 403 / 404 | UI に「Sheet を SA email と共有してください」を表示 |
| mimeType が Google Sheets でない | 415 | Firestore に何も書かない |
| Drive export 失敗 | 502 | この時点までは Firestore に document を作らない |
| GCS raw 保存失敗 | 502 | Firestore に何も書かない |
| GCS 保存後に Firestore initial set 失敗 | 500 | GCS の raw snapshot を rollback |
| Curator 失敗 | 500 + docId | Phase 2 と同じ `recordPhaseFailure` 経路、`status='failed'` に倒す |
| Masker 失敗 | 500 + docId | Phase 2 と同じ `recordPhaseFailure` 経路、masked object は rollback |

---

## 6. 実装ステップ（タスク分割）

1. **Google auth / client 準備** ([src/lib/googleWorkspaceClient.ts])
   - ADC または env credential で `drive.readonly` scope の client を返す。
   - SA メール取得ヘルパも併設し、UI / error message から参照できるようにする。

2. **Snapshot importer 実装** ([src/lib/googleSheetsSnapshotImporter.ts])
   - `parseGoogleSheetsInput(urlOrFileId): { fileId: string }`（pure 関数、`gid` 無視）
   - `fetchSheetsSnapshot(fileId): { metadata, xlsxBuffer, exportedAt }`
   - `xlsxToNormalizedMarkdown` を流して content 文字列を返す。

3. **Document type / parser / initial body の `sourceKind` 対応**
   - `FirestoreDocument` type に `sourceKind` / `externalSource` を追加。
   - `parseFirestoreDocumentData` に defaulting を入れる。
   - `FirestoreInitialDocumentDraft` と `buildInitialDocumentBody` を更新し、upload 側も `sourceKind: 'upload'` / `externalSource: null` を明示的に書く。
   - 既存テスト fixtures を更新。

4. **Orchestrator の切り出し** ([src/lib/uploadOrchestrator.ts] / 新 `importedSnapshotOrchestrator.ts`)
   - 共通 lifecycle 部 (`runCuratorAndMaskerLifecycle` または同等) を切り出す。
   - 入口ごとに initial body builder を分ける（または共通 builder に source metadata 引数を取らせる）。
   - `orchestrateImportedSnapshotProcessing(input)` を新設。

5. **API route 追加** (`POST /api/import/google-sheets`)
   - Body: `{ "urlOrFileId": "...", "displayName": "optional" }` の Zod 検証。
   - `orchestrateImportedSnapshotProcessing` への委譲。
   - 403 時のエラーレスポンスに SA email を含める。

6. **UI 追加** (`/import/google-sheets`)
   - URL 入力フォーム、実行ボタン、結果表示。
   - **Service Account email をコピーできる表示**。
   - 「特定タブ URL でも全シートを取り込みます」の注意書き。
   - 403 時の SA 共有案内。

7. **テスト**
   - URL / fileId パーステスト（`gid` 含む URL を含む全パターン）
   - Importer の mock テスト
   - 既存 upload のリグレッション
   - Drive export `.xlsx` fixture での extractor 互換テスト
   - `sourceKind` / `externalSource` 含む Firestore type のテスト
   - `parseFirestoreDocumentData` defaulting テスト

8. **Demo runbook / docs**
   - SA 共有手順を [docs/demo-runbook.md](demo-runbook.md) に追加。
   - 本書を [docs/decisions.md](decisions.md) から参照。

---

## 7. 完了条件

- [ ] Google Sheets URL / fileId を入力すると document が登録される
- [ ] GCS の raw 領域に `.xlsx` snapshot が保存される
- [ ] Firestore に `sourceKind='google_workspace'` と `externalSource` メタデータが記録される
- [ ] 既存 document が `sourceKind: 'upload'` / `externalSource: null` として読める（defaulting）
- [ ] upload 経由の新規 document にも `sourceKind: 'upload'` / `externalSource: null` が明示的に書かれる
- [ ] Curator / Masker が snapshot の markdown を元に正常に動作する
- [ ] `chunks:regenerate` 対象 docId で chunk が生成される（拡張子判定が `.xlsx` を引く）
- [ ] `context:demo:live` に `sheet=..., range=...` 付きでコンテキストが反映される
- [ ] 既存ファイルアップロード (`sourceKind='upload'`) 機能が壊れずに動作する
- [ ] UI に Service Account email がコピー可能な形で表示される
- [ ] 403 時のエラー応答に SA 共有の案内が含まれる
- [ ] Drive export `.xlsx` fixture を使った extractor 互換テストが緑

---

## 8. Phase 3-B 以降への送り

Phase 3-A の範囲外だが、Phase 3-B 以降で扱う候補。

- 自動同期 / 差分検知（`modifiedTime` / `exportedAt` の比較で）
- `externalSource.fileId` での de-dup または上書き import
- `gid` / シート選択 / range 選択
- OAuth user delegation
- Gmail / Chat / Docs 取り込み
- schemaVersion bump + backfill script による `sourceKind` 必須化と invariant ルール追加
- `externalSource.exportSha256` の追加（差分検知が必要になった場合）

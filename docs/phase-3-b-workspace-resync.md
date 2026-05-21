# Phase 3-B 設計 — Google Workspace Re-sync & Schema v2

Phase 3-B は **Phase 3-A の Google Sheets snapshot import を「運用上回せる」状態に押し上げる** フェーズ。主軸は「まわす」。
具体的には、(i) 同じ Drive ファイルの再取り込みを **上書き型 de-dup** で扱い、(ii) Drive 上の modifiedTime と取り込み済み snapshot を比較した **鮮度バッジ**を出し、(iii) **schemaVersion 1 → 2 への bump** で `sourceKind` を必須化し、(iv) **Google Docs (text/markdown export)** を Sheets と同じ workspace ingestor 経由で取り込めるようにする。

関連:
- [docs/phase-3-google-sheets-import.md](phase-3-google-sheets-import.md) — Phase 3-A 設計 (Sheets snapshot import)
- [docs/phase-2-design.md](phase-2-design.md) — Phase 2 構造化 Ingestion / KnowledgeChunk
- [docs/architecture.md](architecture.md)
- [docs/firestore-schema.md](firestore-schema.md)
- [docs/decisions.md](decisions.md)
- [src/lib/firestoreSchema.ts](../src/lib/firestoreSchema.ts)
- [src/lib/uploadOrchestrator.ts](../src/lib/uploadOrchestrator.ts)
- [src/lib/importedSnapshotOrchestrator.ts](../src/lib/importedSnapshotOrchestrator.ts)
- [src/lib/googleSheetsSnapshotImporter.ts](../src/lib/googleSheetsSnapshotImporter.ts)

---

## 0. Phase 3-A 引き継ぎ

Phase 3-A で完成済み:

- Drive export `.xlsx` snapshot → Phase 2 `.xlsx` extractor → Curator/Masker → Firestore の一本線
- `sourceKind` / `externalSource` 追加（defaulting で吸収）
- `InvalidGoogleSheetsInputError` / `ImportTooLargeError` (413) / `GoogleSheetShareError` (403) / `DriveExportError` (502) のエラー型
- 入口別 builder + `runCuratorAndMaskerLifecycle` 共通化
- Service Account email 表示、403 案内、demo runbook §5 / §5.5
- failure matrix (§5) と rollback テスト
- `buildSafeXlsxName` (空 / `.xlsx` 単体 / 末尾 `.`)

Phase 3-B で **触らない** こと:
- Phase 2 の `validateFirestoreDocumentInvariants` 既存 9 ルール（拡張は許可、既存の意味は維持）
- `chunks:regenerate` の拡張子判定ロジック
- Masker / Curator の flow 本体
- HTTP API 層の認証・認可・レート制限（Phase 3-A spec §5 のまま、別フェーズで本格対応）

Phase 3-A から **格上げ** するもの:
- 入口別 builder → workspace 共通 ingestor（Sheets / Docs 分岐）
- defaulting 吸収 → schemaVersion 2 で `sourceKind` 必須化

---

## 1. 設計原則

1. **「まわす」軸を優先する**。3-B の核は「同じ Sheet を 2 回入れても document が溢れない」「Drive で更新されたら気づける」「Workspace を増やす土台が整っている」の 3 点。派手な新機能より、Phase 3-A の運用上の角を丸める。
2. **上書き型 de-dup**。同じ `externalSource.fileId` を再取り込みすると、**既存 docId を再利用して** raw / Firestore / chunks を新しい snapshot で置き換える。履歴は残さない（履歴型は 3-C 以降）。
3. **手動 re-import のみ**。cron / Drive Push notification / Pub/Sub による自動同期は 3-C 以降。3-B は「ユーザが操作したときに最新化される」だけ。
4. **modifiedTime 鮮度は read-time に問い合わせる**。Inventory 一覧の N+1 を避けるため、**document 詳細を開いた時にだけ** `drive.files.get` を呼んで `externalSource.modifiedTime` と比較する。一覧の `staleness` 列は 3-C 以降。
5. **schemaVersion を 2 に上げる**。`sourceKind` を必須にし、`sourceKind === 'google_workspace'` ⇒ `externalSource !== null` の invariant を追加する。既存 document は `backfillSourceKind.ts` を 1 回走らせて `sourceKind: 'upload'` を書き込む。dry-run → 確認 → batch の 2 段構えにする。
6. **Workspace ingestor を共通化する**。Sheets / Docs を adapter pattern で抱え、`importedSnapshotOrchestrator` は「どの workspace source か」を引数で受ける。`googleSheetsSnapshotImporter` は Sheets adapter として残し、`googleDocsSnapshotImporter` を新設する。
7. **upload と import の「curating への遷移」は 1 つの helper に統合する**。Phase 3-A の TODO(Phase 3-B) コメントどおり、`transitionDocumentToCurating(docRef, contentSha256)` を `uploadOrchestrator.ts` に置き、両 orchestrator から呼ぶ。
8. **chunks の再生成は上書きの一部**。上書き完了時に該当 docId 配下の chunks subcollection を atomic に置き換える（旧 chunks を batch delete → 新 chunks を batch write）。
9. **API の互換性は保つ**。`POST /api/import/google-sheets` の URL / 入力 schema は変えない。レスポンス body に **`kind: 'created' | 'overwritten'`** を追加するだけ。
10. **失敗時は新バージョンを部分 commit しない**。上書きの partial failure は **旧 raw を保持したまま** Firestore を `status='failed'` に倒す（旧 raw / 旧 chunks は保護される。新 raw は best-effort delete）。

---

## 2. 採用判断ログ（Phase 3-B の合意）

### D-P3-B-1: 3-B 主軸 = **「まわす」 (Drive 差分検知 + de-dup + 手動 re-import)**

**選んだ案**: 「まわす」軸。具体的には B1 (de-dup) + B2 (modifiedTime 差分検知) + D1 (lifecycle 共通化) + D2 (schemaVersion 2) を中核に、C1 (Google Docs) を 1 つだけ source 拡張として加える。

**代替案:**
- (a) **「まわす」軸（B1 + B2 + D1 + D2 + C1）** ← 採用
- (b) 「とどける」軸（IAP + rate limit + audit log）
- (c) 「つくる」軸（Docs + PDF + Drive 任意ファイル）
- (d) 内部品質強化（D1-D6 全部 + B3）

**選定理由:**
- ハッカソンの「まわす」軸でストーリーを作りやすい（Sheet を更新 → 鮮度バッジ → 再取り込み → Context Package が新しくなる、というデモ動画が映える）。
- (b) は IAP / audit / rate limit を全部入れると 1 週間溶けやすく、デモ動画では地味。本番化のときに別フェーズで詰める。
- (c) は Gmail が重く 1 フェーズで収まらない。Docs だけならついでに入れられる。
- (d) は他軸の下敷きなので、(a) の中に D1 / D2 / D5 / D6 を取り込む形にする。

**撤退条件:** de-dup の上書き挙動が Phase 2 invariant と整合できないケースが見つかった場合、3-C で履歴型に切り替える。

### D-P3-B-2: de-dup = **上書き型（existingDocId 再利用）**

**選んだ案**: 既存の `externalSource.fileId` で document を検索し、見つかったら **同じ docId に対して** raw / Firestore / chunks を新しい snapshot で置き換える。履歴は残さない。

**代替案:**
- (a) **上書き型** ← 採用
- (b) 履歴型（新 docId を作り、旧 doc は `status='archived'`）
- (c) ユーザ確認型（重複検出時に UI で選択）

**選定理由:**
- (a) は Phase 2 invariant（1 doc = 1 source）と最も親和的。Inventory / Context Package も特別扱いなしで動く。
- (b) は `status='archived'` 追加 + Inventory フィルタ + Context Package 側の「latest 採用」分岐で実装の表面積が大きい。デモでも「archive されたものはどこに行ったの？」という質問を生む。
- (c) は UX として親切だが、PoC 段階では「黙って上書き」のほうがデモ動線が短い。

**実装上の重要点:**
- `externalSource.fileId` で document を検索する → Firestore composite index を追加（`externalSource.fileId` + `sourceKind` 等）。
- raw storagePath は同一 docId 配下なので key 自体は変わらないが、**Drive name が変わると `safeName` が変わる**ことに注意。新 raw は新 path に書き、旧 raw は best-effort で削除する。
- chunks subcollection は **完全に置き換える**。旧 chunks を batch delete → 新 chunks を batch write。
- `contentSha256` が同一の場合は「bytes 変化なし」として **content 段以降をスキップして** `externalSource.exportedAt` / `modifiedTime` だけ更新する短絡パスを 1 つ用意する（Vertex AI コスト抑制）。

**撤退条件:** ユーザから「上書き前の状態に戻したい」が頻発した場合、3-C で履歴型に切り替えるか、Drive の versioning を露出させる。

### D-P3-B-3: schemaVersion = **1 → 2 に bump、backfill 必須**

**選んだ案**: `FIRESTORE_DOCUMENT_SCHEMA_VERSION` を `2` に上げ、parser の defaulting を撤去する。`sourceKind` を必須化、`sourceKind === 'google_workspace'` ⇒ `externalSource !== null` の invariant を追加する。既存 document は `scripts/backfillSourceKind.ts` を 1 回走らせて `sourceKind: 'upload'`, `externalSource: null` を書く。

**代替案:**
- (a) **bump + backfill** ← 採用
- (b) defaulting 継続（schemaVersion 1 のまま）

**選定理由:**
- Phase 3-A の D-P3-A-2 撤退条件「production 化時、または `externalSource` 必須を前提とした invariant ルールを Firestore 側で強制したくなった時点」に該当する。3-B で de-dup を入れるとき `externalSource.fileId` を Firestore query する以上、空欄を許容したくない。
- backfill は 2 段構え（dry-run でログ出力 → confirm prompt → batch commit）にして PoC でも事故を抑える。
- `parseFirestoreDocumentData` の defaulting は撤去する。schemaVersion 1 の document は parse error にする（backfill 未完了の検知になる）。

**新 invariant:**
1. `sourceKind` は `'upload' | 'google_workspace'` のいずれか（null / undefined 不可）
2. `sourceKind === 'google_workspace'` ⇒ `externalSource !== null` AND `externalSource.provider === 'google_drive'`
3. `sourceKind === 'upload'` ⇒ `externalSource === null`

**撤退条件:** backfill が production 化のタイミングで再度必要になった場合、schemaVersion 3 に上げる。

### D-P3-B-4: Google Docs export = **text/markdown 一本通し**

**選んだ案**: Google Docs (`application/vnd.google-apps.document`) を Drive API `files.export` の `text/markdown` で取り込み、既存の `.md` extractor パスにそのまま流す。Firestore `fileName` には `.md` suffix を付け、`contentType` は `text/markdown` を固定で書く。

**代替案:**
- (a) **text/markdown export** ← 採用
- (b) `.docx` export + mammoth/docx-parser
- (c) `text/plain` export

**選定理由:**
- (a) は近年 Drive API が公式サポート。スタイル情報は落ちるが、Curator / Masker の content 入力としては十分。
- (b) は依存追加（mammoth 等）が必要で、Sheets の OOXML パターンを Docs にも適用する魅力はあるが Phase 3-B の本筋ではない。
- (c) は見出し構造が消えて Curator の精度が下がるリスク。

**実装上の重要点:**
- `googleDocsSnapshotImporter.ts` を新設し、`googleSheetsSnapshotImporter.ts` と同じ shape の `fetchDocsSnapshot(fileId)` を出す。
- `externalSource.workspaceMimeType` を **union 型** に拡張する: `'application/vnd.google-apps.spreadsheet' | 'application/vnd.google-apps.document'`。
- `externalSource.exportMimeType` も union 型に: `'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' | 'text/markdown'`。
- `importedSnapshotOrchestrator` は workspace adapter を引数 / 型で受け取り、Sheets / Docs を分岐する（D-P3-B-6 の共通化を実現する場所）。

**撤退条件:** Docs の markdown export が表構造 / 画像 / 引用を著しく欠落させ Curator 精度が落ちる場合、3-C で `.docx` パスを追加する。

### D-P3-B-5: 鮮度バッジ = **詳細ページの read-time に Drive 問い合わせ**

**選んだ案**: document 詳細を開いたタイミングで `GET /api/import/google-sheets/freshness?docId={id}` を呼び、保存済み `externalSource.modifiedTime` と Drive 現在の `modifiedTime` を比較してバッジ表示する。Inventory 一覧では現在の `externalSource.modifiedTime` だけ表示し、Drive へは問い合わせない。

**代替案:**
- (a) **詳細ページのみで問い合わせる** ← 採用
- (b) Inventory 一覧でも N 件分問い合わせる
- (c) `externalSource.modifiedTime` のみ表示で Drive 問い合わせなし

**選定理由:**
- (a) は N+1 と Drive API quota / cost のリスクを下げる。詳細ページなら 1 件問い合わせなのでコストは線形。
- (b) は 50 件の一覧で 50 回問い合わせると体感が重い。batch / cache を入れると複雑度が上がる。
- (c) は「古いんだ」体験が成立しない（ユーザは Drive 側の更新を画面に映したい）。

**実装上の重要点:**
- API: `GET /api/import/google-sheets/freshness?docId={id}` (or generic `workspace/freshness`)。
  - response: `{ isStale: boolean, savedModifiedTime: string, latestModifiedTime: string }`
- 403 / 404 が出る可能性あり（Drive の共有が剥がれた / file が削除された）。UI は「Drive 側で参照できなくなりました」を表示する別 state を持つ。
- フォールバック: Drive 問い合わせが失敗しても document 詳細は壊さない（バッジが「不明」になるだけ）。

**撤退条件:** 詳細ページの read-time コストが許容できなくなったら、3-C で Drive Push notification（`changes.watch`）に切り替える。

### D-P3-B-6: Workspace ingestor の構造 = **adapter pattern（Sheets / Docs を 1 つの ingestor が分岐）**

**選んだ案**: `googleSheetsSnapshotImporter.ts` を Sheets adapter として残し、`googleDocsSnapshotImporter.ts` を新設する。`importedSnapshotOrchestrator.ts` は引数で adapter を受け取り、export → buffer → content の経路は共通化する。

**代替案:**
- (a) **adapter pattern** ← 採用
- (b) Sheets / Docs それぞれ別 orchestrator を作る
- (c) `importedSnapshotOrchestrator` を 1 つに無理矢理畳む

**選定理由:**
- (a) は「workspace source = Drive metadata + export bytes + content type」を抽象化できる最小単位。Phase 3-C で Slides / PDF を入れるときも adapter を追加するだけで済む。
- (b) は重複が多い（Drive metadata 取得 / size check / GCS upload / Firestore initial set / lifecycle は全部同じ）。

**Adapter インタフェース（型のみ、実装は後段）:**
```ts
type WorkspaceImportAdapter = {
  workspaceMimeType: WorkspaceMimeType;
  exportMimeType: ExportMimeType;
  fileExtension: string;                 // '.xlsx' / '.md'
  contentType: string;                   // OOXML / 'text/markdown'
  toNormalizedContent: (bytes: Buffer) => string;  // markdown 化
};
```

**撤退条件:** adapter の差異が大きすぎて分岐が増えた場合、Phase 3-C で別 orchestrator に分ける。

### D-P3-B-7: 上書き時のロールバック = **「旧バージョン保護優先」**

**選んだ案**: 上書きの partial failure は新バージョンを破棄し、Firestore document を `status='failed'` に倒すが **旧 raw / 旧 chunks は手をつけない**。新 raw は best-effort delete。

**代替案:**
- (a) **旧バージョン保護優先** ← 採用
- (b) 新バージョンを部分 commit する（旧は消える）
- (c) 2-phase commit 風（旧を一旦退避してから上書き）

**選定理由:**
- (a) は「失敗時にデータが消えない」が PoC として圧倒的に安全。
- (b) は Phase 2 の rollback ルール（前段を巻き戻す）と矛盾する。
- (c) は実装の重さに見合わない。

**失敗マトリクス（§5 で詳述）:**

| 段 | 失敗時の挙動 |
| --- | --- |
| fileId lookup | 何も書かない |
| Drive metadata 取得 | 何も書かない |
| Drive export | 何も書かない |
| 新 raw upload | 何も書かない |
| Firestore overwrite (set merge: false での新 body 書き込み) | 新 raw を best-effort delete、旧 raw / chunks は維持 |
| Curator 失敗 | 新 raw は維持、Firestore は `status='failed'`、旧 chunks は維持 |
| Masker 失敗 | 同上、masked object は rollback |
| chunks 置き換え失敗 | 旧 chunks を維持、新 chunks は best-effort delete、Firestore は `status='failed'` |

**撤退条件:** 「失敗時に旧 raw を上書きしたい」要望が出たら、3-C で 2-phase commit 風に切り替える。

### D-P3-B-8: chunks の再生成 = **上書きの一部として自動実行（atomic 置換）**

**選んだ案**: 上書き処理の終端（masker / curator が ai_safe / curated / blocked に倒れた直後）に、該当 docId の chunks subcollection を **全削除 → 再生成** する。再生成中の失敗は §5 の chunks 失敗パスに従う。

**代替案:**
- (a) **自動置換（atomic）** ← 採用
- (b) `chunks:regenerate` の手動実行に任せる

**選定理由:**
- (a) は「上書きしたら Context Package も自動で新しい chunks を使う」体験を成立させる。
- (b) は demo 時に「再取り込みしたのに古い chunks が残っている」がノイズになる。

**実装上の重要点:**
- 既存 `scripts/regenerateChunks.ts` のロジックを `src/lib/chunkRegenerator.ts` 等に切り出して orchestrator から呼べる形にする。
- batch delete + batch write の組み合わせで、subcollection の置き換えを 1 回の Firestore transaction にまとめる（500 件超は分割）。

**撤退条件:** chunks 再生成が orchestrator 内で重すぎる場合、Cloud Tasks 経由の async execution に切り出す（3-C）。

### D-P3-B-9: API の互換性 = **入力は無変更、レスポンスに `kind` を追加**

**選んだ案**: `POST /api/import/google-sheets` の入力 schema (`urlOrFileId`, `displayName`) は変えない。レスポンス body に `kind: 'created' | 'overwritten'` を追加し、UI が新規 / 上書きで表示を分岐できるようにする。

**代替案:**
- (a) **入力無変更 + `kind` 追加** ← 採用
- (b) 新 endpoint（`/api/import/google-sheets/overwrite`）を作る
- (c) `mode: 'create' | 'overwrite'` を入力 body に取る

**選定理由:**
- (a) は外部呼び出し（CLI / scripts）から見て後方互換。
- (b) は重複検出を UI が事前にやる必要があり、UX のラウンドトリップが増える。
- (c) は「黙って上書き」の設計原則と矛盾する（誰が mode を決めるか論争を生む）。

**撤退条件:** 「上書きを明示拒否したい」要望が出たら 3-C で `mode` を導入する。

### D-P3-B-10: ミクロ取り込み = **D5 / D6 のみ、D4 は 3-C 送り**

**選んだ案**: `route.ts` の if ハシゴ順を 4xx → 5xx に並び替える（D5）、`buildSafeXlsxName` の slice 後に `.replace(/\.+$/, '')` を再適用する（D6）。`displayTitle` / `canonicalTitle` の追加（D4）は 3-C 以降に送る。

**理由:**
- D5 / D6 は他要件と独立、デグラデなし、5 分作業。
- D4 は UI / Curator 入力 / Context Package 表示の 3 か所に影響し、3-B の本筋に混ぜると複雑度が上がる。

---

## 3. データスキーマ進化

### `FirestoreDocument` 変更

```ts
// schemaVersion: 1 → 2
export const FIRESTORE_DOCUMENT_SCHEMA_VERSION = 2 as const;

// sourceKind: optional default → 必須化
sourceKind: 'upload' | 'google_workspace';   // null / undefined 不可

// externalSource: union 拡張
externalSource: null | {
  provider: 'google_drive';
  workspaceMimeType:
    | 'application/vnd.google-apps.spreadsheet'
    | 'application/vnd.google-apps.document';
  fileId: string;
  name: string;
  webViewLink?: string;
  modifiedTime?: string;
  importedAt: string;
  exportedAt: string;
  exportMimeType:
    | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    | 'text/markdown';
};
```

### 新 invariant (`validateFirestoreDocumentInvariants` 拡張)

ルール 10 / 11 を追加（既存 9 ルールは変更しない）:

```
10. sourceKind は 'upload' | 'google_workspace' のいずれか。
11. sourceKind === 'google_workspace' ⇔ externalSource !== null AND externalSource.provider === 'google_drive'.
```

### Firestore index

de-dup の `where('externalSource.fileId', '==', fileId)` で必要:

```
collection: documents
fields:
  - externalSource.fileId (ASC)
  - sourceKind (ASC)              // 'google_workspace' で絞る用
```

`firestore.indexes.json` に追加し、`gcloud firestore indexes create` を runbook に書く。

### backfill script (`scripts/backfillSourceKind.ts`)

擬似コード（5-10 行で済む TODO 領域はユーザ実装）:

```ts
// TODO(Phase 3-B): backfill 戦略をここで固定する。
//
// 期待動作:
//   1. dry-run 引数があれば Firestore へは書かず、対象件数と上位 5 件の id だけ出す
//   2. confirm 引数で実行
//   3. schemaVersion === 1 の document を 500 件単位の batch で
//      { schemaVersion: 2, sourceKind: 'upload', externalSource: null } に update
//   4. 失敗時は失敗した docId をログに残して次の batch に進む
//
// 既に schemaVersion === 2 で sourceKind を持つ document はスキップ。
```

---

## 4. スコープ

### やること

- `externalSource.fileId` での upsert（D-P3-B-2）
- 上書き時の raw GCS / chunks subcollection の atomic 置き換え（D-P3-B-7, D-P3-B-8）
- レスポンス body に `kind: 'created' | 'overwritten'` を追加（D-P3-B-9）
- schemaVersion 1 → 2 bump + `parseFirestoreDocumentData` defaulting 撤去 + 新 invariant ルール 10/11（D-P3-B-3）
- `scripts/backfillSourceKind.ts`（D-P3-B-3）
- `googleDocsSnapshotImporter.ts` 新設 + `text/markdown` export（D-P3-B-4）
- `importedSnapshotOrchestrator` の adapter pattern 化（D-P3-B-6）
- `transitionDocumentToCurating` の共通化（uploadOrchestrator [D] と統合、Phase 3-A TODO 消化）
- `GET /api/workspace/freshness?docId={id}` + 詳細ページの鮮度バッジ（D-P3-B-5）
- 文書一覧 / 詳細から「再取り込み」ボタン + URL 入力の重複時黙って上書き（D-P3-B-9）
- demo runbook に re-import 手順と schemaVersion 2 移行手順を追記
- Firestore composite index 追加
- D5 / D6 ミクロ取り込み

### やらないこと

- 自動同期（cron / Drive Push notification / Pub/Sub）
- 履歴型 archive（status='archived'）
- ユーザ確認型 de-dup（重複時の UI 選択）
- Gmail / Slides / PDF / Drive 任意ファイル取り込み
- OAuth user delegation
- `gid` / シート選択 / range 選択
- `externalSource.exportSha256` の追加
- HTTP API 認証 / 認可 / レート制限（公開運用ハードニング）
- `displayTitle` / `canonicalTitle` 等の AI-ready タイトル field
- Cloud Tasks 等の async 化（chunks 再生成は orchestrator 内同期）
- Inventory 一覧での Drive 鮮度問い合わせ

---

## 5. エラー処理（Failure Policy）

Phase 3-A §6 を維持しつつ、上書きパスでの partial failure を追加する。

### 上書きパス（fileId lookup 一致時）

| 段 | HTTP | 挙動 |
| --- | --- | --- |
| fileId lookup（Firestore query） | 500 | 何も書かない |
| Drive metadata / export 失敗 | Phase 3-A と同じ（403/404/415/502） | 何も書かない |
| サイズ上限超過 | 413 | 何も書かない |
| contentSha256 が既存と同一 | 200 | 新 GCS は書かず、`externalSource.exportedAt` / `modifiedTime` だけ update、`kind: 'overwritten'`、`skipped: true` を返す |
| 新 raw GCS upload 失敗 | 502 | 何も書かない（旧 raw は維持） |
| Firestore overwrite 失敗 | 500 | 新 raw を best-effort delete、旧は維持 |
| Curator 失敗（上書き中） | 500 + docId | `status='failed'` に倒す。新 raw は維持（旧 raw は既に上書きされているので戻せない → §7 の retreat 条件） |
| Masker 失敗（上書き中） | 500 + docId | masked object rollback、`status='failed'`、新 raw は維持 |
| chunks 置き換え失敗 | 500 + docId | 旧 chunks 維持、新 chunks best-effort delete、`status='failed'` |
| 鮮度問い合わせ失敗（`/freshness`） | 502 | document 詳細は壊さず、バッジは「不明」表示 |

### Curator / Masker 失敗時の「旧 raw が消える」リスク

D-P3-B-7 で「旧 raw を保護」と言ったが、Firestore overwrite と raw GCS upload を厳密に直列化すると、Curator 失敗時には **新 raw が GCS に書かれ Firestore は failed** という中途半端な状態になる。これは「旧 raw が消える」のではなく「新 raw が残る」状態であり、demo 上は許容するが、**3-C で 2-phase 化することを撤退条件とする**。

---

## 6. 実装ステップ（タスク分割）

1. **Firestore schemaVersion 2 と invariant 10/11**
   - `FIRESTORE_DOCUMENT_SCHEMA_VERSION = 2` に変更
   - `validateFirestoreDocumentInvariants` にルール 10/11 を追加
   - `parseFirestoreDocumentData` の defaulting 撤去、`sourceKind` を required に
   - 既存テスト fixtures を schemaVersion 2 / `sourceKind` 明示で書き直す

2. **backfill script** (`scripts/backfillSourceKind.ts`)
   - dry-run / confirm の 2 段構え
   - schemaVersion 1 → 2、`sourceKind: 'upload'`、`externalSource: null`
   - 失敗 doc を別 log に残す

3. **Workspace adapter 抽出**
   - `WorkspaceImportAdapter` 型を `src/lib/workspaceImport/types.ts` に定義
   - `googleSheetsSnapshotImporter.ts` を sheets adapter として整理
   - `googleDocsSnapshotImporter.ts` を新設（`text/markdown` export）
   - `importedSnapshotOrchestrator` を adapter 受け取り型に refactor

4. **共通 `transitionDocumentToCurating` helper**
   - `uploadOrchestrator.ts` に export
   - upload / import 両側から呼ぶ
   - Phase 3-A の `TODO(Phase 3-B)` コメントを消す

5. **De-dup（上書き型）**
   - `findExistingDocByFileId(fileId)` を追加（Firestore where 検索）
   - `importedSnapshotOrchestrator` に `mode: 'create' | 'overwrite'` を内部分岐として持たせる
   - 新 raw path → Firestore overwrite → lifecycle 共通化済み helper を呼ぶ
   - contentSha256 同一時のスキップパス
   - 旧 raw の best-effort delete

6. **chunks atomic 置き換え**
   - `scripts/regenerateChunks.ts` のコア部を `src/lib/chunkRegenerator.ts` に切り出し
   - orchestrator の終端で `replaceChunksForDoc(docId)` を呼ぶ
   - batch delete → batch write（500 件超は分割）

7. **API レスポンス拡張**
   - `POST /api/import/google-sheets` の success body に `kind: 'created' | 'overwritten'` と `skipped?: boolean`
   - `documentUploadSuccessBodyFromOrchestrate` の return shape を更新

8. **`GET /api/workspace/freshness`**
   - `?docId={id}` で Firestore から `externalSource.modifiedTime` を読み、Drive に問い合わせて比較
   - 403 / 404 を別 code で返す
   - response: `{ isStale, savedModifiedTime, latestModifiedTime, code? }`

9. **UI**
   - `/import/google-sheets` の入力フォームに Google Docs URL も受け付ける旨を追記
   - 文書詳細ページに「Drive 上で更新されています」バッジ（freshness API から）
   - 文書詳細 / 一覧から「再取り込み」ボタン
   - 重複時の UI は変えない（黙って上書きで `kind: 'overwritten'` を表示）

10. **Firestore composite index**
    - `firestore.indexes.json` 更新
    - `gcloud firestore indexes create` を demo-runbook に追加

11. **D5 / D6 ミクロ取り込み**
    - `route.ts` の if ハシゴ順を 4xx → 5xx に並び替え
    - `buildSafeXlsxName` の slice 後 `.replace(/\.+$/, '')`

12. **Demo runbook + decisions.md**
    - 再取り込み手順、schemaVersion 2 移行手順、index 作成手順を runbook に追加
    - `decisions.md` から本書を参照

13. **テスト**
    - schemaVersion 2 fixture / invariant 10/11
    - backfill script の dry-run / confirm
    - Sheets / Docs adapter 経由の orchestrator
    - de-dup (新規 / 上書き / contentSha256 一致スキップ)
    - 上書き失敗時の §5 各段
    - chunks atomic 置き換え
    - `/api/workspace/freshness` の 200 / 403 / 404
    - UI の鮮度バッジ・「再取り込み」ボタン

---

## 7. 完了条件

- [ ] `FIRESTORE_DOCUMENT_SCHEMA_VERSION === 2`、parser は defaulting せず、invariant 10/11 が緑
- [ ] `scripts/backfillSourceKind.ts` で既存 document 全部に `sourceKind: 'upload'`, `externalSource: null` が書ける（dry-run 含む）
- [ ] Sheets / Docs どちらも `/import/google-sheets` で取り込める（Docs は `text/markdown` export）
- [ ] 同じ Sheet / Doc の URL を 2 回入れると、docId が再利用される（Inventory に重複が出ない）
- [ ] 同じ Sheet の `contentSha256` が変わらない場合、Vertex 呼び出しがスキップされ `skipped: true` が返る
- [ ] 上書き完了後、chunks subcollection が新内容に置き換わっている
- [ ] 文書詳細ページで「Drive 上で更新されています」バッジが、modifiedTime の差分に応じて表示される
- [ ] 「再取り込み」ボタンから上書きが走り、`kind: 'overwritten'` が UI に表示される
- [ ] `transitionDocumentToCurating` が 1 か所に集約され、upload / import 両側から呼ばれる
- [ ] `googleDocsSnapshotImporter` / `googleSheetsSnapshotImporter` が同じ adapter インタフェースを実装する
- [ ] §5 失敗マトリクスの各段でテストが緑
- [ ] Firestore composite index が `firestore.indexes.json` に追加され、runbook に作成手順がある
- [ ] D5 / D6 のミクロ取り込み（route.ts の if 順、`buildSafeXlsxName` slice 後再除去）

---

## 8. Phase 3-C 以降への送り

Phase 3-B の範囲外だが、Phase 3-C 以降で扱う候補。**次フェーズ表と Ingest 起票の正本は [docs/open-questions.md](open-questions.md)**（2026-05-21 集約）。Drive 同期・フォルダ一括・画像単体・ローカル一括は同ファイル §Ingest 拡張を参照。

- **HTTP API 認証 / 認可 / レート制限**（IAP / token / Cloud Armor 等）
- **自動同期**（cron / Cloud Scheduler / Drive Push notification）→ open-questions **Workspace: Drive sync**
- **履歴型 archive**（status='archived' + Inventory フィルタ）
- **2-phase 上書き**（partial failure 時の旧 raw 完全保護）
- **Gmail / Slides / Drive 任意ファイル取り込み** → open-questions **Ingest: Drive folder bulk**（フォルダ配下一括）に含める
- **OAuth user delegation**
- **`gid` / シート / range 選択**
- **`displayTitle` / `canonicalTitle` 等の AI-ready タイトル field**
- **chunks 置き換えの async 化**（Cloud Tasks）
- **Inventory 一覧での鮮度問い合わせ**（batch / cache）
- **`externalSource.exportSha256`**（差分検知の証跡）
- **`.docx` Docs パス**（markdown export で精度が落ちた場合）

---

## 9. 参考: Phase 3-A との差分まとめ

| 観点 | Phase 3-A | Phase 3-B |
| --- | --- | --- |
| schemaVersion | 1（defaulting で吸収） | 2（必須化 + backfill） |
| 取り込み source | Google Sheets のみ | Sheets + Docs |
| 重複 import | 毎回新 docId | 上書き型（fileId で既存検索） |
| 鮮度表示 | なし | 詳細ページで Drive 問い合わせ |
| chunks 再生成 | 手動（`chunks:regenerate`） | 上書き時に自動置換 |
| invariant | 9 ルール | 9 + 2 = 11 ルール |
| API レスポンス | `fileName` 等のみ | `kind: 'created' | 'overwritten'`, `skipped?` |
| 認証 / レート制限 | なし（PoC 前提） | なし（3-C 以降） |
| 自動同期 | なし | なし（3-C 以降） |

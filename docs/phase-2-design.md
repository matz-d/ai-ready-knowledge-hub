# Phase 2 設計 — 構造化 Ingestion (KnowledgeChunk)

Phase 2 は **Document 正本を維持しながら、AI 投入・安全判定・目的別選別に使える構造化 chunk を派生生成する** フェーズ。本書は Phase 2 の正本（決定事項）と、Phase 1 (DLP) からの引き継ぎ情報を固定する。

関連:
- [docs/architecture.md](architecture.md)
- [docs/firestore-schema.md](firestore-schema.md)
- [docs/decisions.md](decisions.md)
- [src/lib/firestoreSchema.ts](../src/lib/firestoreSchema.ts)
- [src/lib/uploadOrchestrator.ts](../src/lib/uploadOrchestrator.ts)
- [src/lib/contextPackageInput.ts](../src/lib/contextPackageInput.ts)

---

## 0. Phase 1 (DLP) 引き継ぎ

Phase 1 (Cloud DLP 導入) は **実装ほぼ完了、live upload 経由の GCS 保存証跡だけ後続確認** で引き継ぐ。

### 完了済み
- `maskerPipelineFlow` から `cloud-dlp` provider を利用可能
- `MASKER_PROVIDER=cloud-dlp` で provider 差し替え可能
- 未指定時は `simple-rule` fallback
- DLP client mock test あり (`src/agents/masker/__tests__/cloudDlpMasker.test.ts`)
- `npm run masker:dlp:smoke -- <file>` あり
- live smoke 済み
  - テンプレート: DLP 0 件
  - 実案件契約書: DLP 25 件
  - 匿名化メモ: DLP 0 件でも Gemini residual risk が `restricted_promoted`

### 後続確認 (Phase 2 と並走可)
- DLP provider で `ai_safe_ready` になる入力を upload / orchestrator 経由で流し、`masked/...` GCS object が作られることを live 確認する
- `restricted_promoted` では masked object を作らない既存挙動は維持済み（`uploadOrchestrator.runMaskerPhase` で確認済み）

### デモ前調整候補（Phase 2 とは独立）
- `minLikelihood`
- `PERSON_NAME` / `LOCATION` / `STREET_ADDRESS` の住所周辺分割
- DLP replacement token を `[INFO_TYPE]` のままにするか `[REDACTED:TYPE]` に寄せるか
- 日本向け custom dictionary

---

## 1. 設計原則

1. **Document = 管理・監査・アップロード・権限の単位 / Chunk = AI 投入・DLP/Curator/Strategist 判断・Context Package 選別の単位** という二層構造を導入する。
2. **Document lifecycle invariant に chunk status を混ぜない**。`firestoreSchema.ts` の `validateFirestoreDocumentInvariants` の 9 ルールは Phase 2 で**触らない**。
3. **Chunk masked text は Firestore に inline 保存**（B 案）。chunk 単位の GCS masked object は作らない。
4. **Curator/Masker の LLM コール数は document 単位 1+1 のまま増やさない**。chunk は extractor の併産物として生成し、curator は document 全体（markdown 正規化テキスト）を見る。
5. **Chunk sensitivity は document curator 結果を初期値として継承し、列ヘッダ等の純関数ルールで chunk 単位に昇格させる**（`applyMaskerUpgrade` と同じ哲学）。
6. **Phase 2 の chunk 生成トリガーは CLI script のみ**。upload 時の自動生成、UI からの API トリガーは Phase 2 では入れない。
7. **chunk subcollection 再生成は document 単位の全置換**。冪等性は de-dup ではなく delete + batch write で担保する。

---

## 2. 採用判断ログ（Phase 2 着手前の合意）

### D-P2-1: Chunk masking の責務 = **B 案 (Chunk inline masked)**

**選んだ案**: chunk text と masked text を Firestore に inline 保存。GCS には chunk masked object を作らない。

**代替案:**
- (A) 二層放置 — document masking のみ。chunk は metadata + extractor のみ。デモ価値が薄い。
- (B) **Chunk inline masked** ← 採用
- (C) Chunk masked GCS object — invariant 全書き換えで Phase 3 が遅延するリスク。

**選定理由:**
- B はデモで「料金表 CSV の顧客名列が chunk 単位で restricted になる」までを見せられる、プロダクトのコア価値が成立する最小構成。
- C は `aiSafeStoragePath` invariant を 1:N に開く全面改修が必要で、Phase 2 で着地しない。
- chunk size は demo に耐える範囲（〜数十 chunk/doc）に限定する縛りを入れることで inline 保存が成立する。

**撤退条件:** chunk 数が document あたり 200 を超える典型ユースケースが出てきた場合、Phase 3 以降で C に移行する。

### D-P2-2: PoC Workspace = **最初から `src/` に書く**

**選定理由:**
- Phase 2 は extractor の方向性（spreadsheet 主軸、列ヘッダルール）が固まっており、W1 のような探索フェーズではない。
- `poc/w2/` を切ると Firestore subcollection 配線が二度手間になる。
- Zod schema / pure extractor / 列ヘッダルール upgrader は最初から production 品質で書く。

### D-P2-3: Firestore 配線 = **emulator/unit + live smoke 必須**

**Phase 2 でやる:**
- `documents/{docId}/chunks/{chunkId}` に保存できる
- 読み戻せる
- fake Firestore / unit test で確認
- live smoke script で既存 document に対して chunk 生成・保存を確認

**Phase 2 ではやらない:**
- upload 直後に必ず chunk 生成する
- document lifecycle invariant に chunk status を混ぜる
- GCS masked object を chunk 単位で作る

### D-P2-4: Chunk 生成トリガー = **CLI script のみ**

**Phase 2:**
- `npm run chunks:regenerate -- <docId>` で手動再生成
- 再生成は **document 単位の全置換**（旧 chunk subcollection を delete → 新 chunk を batch write）
- demo runbook に明示

**Phase 2.5 以降の余地:**
- `POST /api/documents/:docId/chunks` を後で足す
- Strategist 起動時の on-demand 生成

### D-P2-5: `MAX_UPLOAD_BYTES` = **据え置き 1 MiB**

**Phase 2:**
- CSV 主軸で進める。料金表・顧客一覧・案件表は 1 MiB に十分収まる。
- `.xlsx` 対応 PR の中でのみ 5 MiB へ引き上げる（rollback コスト評価とテスト改修込み）。

### D-P2-6: Curator/Masker 入力 = **document 全体を 1 つの markdown table として渡す（chunk は併産）**

- `curatorFlow({ fileName, content })` のシグネチャは変えない。
- CSV / xlsx extractor は以下を**同じソースから併産**する:
  1. document 全体を表す**正規化された markdown table テキスト**（curator/masker 入力）
  2. **chunk 配列**（sheet 単位や used range 単位）
- 「curator が見たテキスト」と「chunk.text を結合したもの」を整合させ、後の Strategist 監査を単純にする。

### D-P2-7: `KnowledgeChunkLocator` = **Zod discriminated union**

optional bag (`{ page?, slide?, sheetName?, range? }`) ではなく `kind` で discriminate。詳細は §3.2。

---

## 3. 型定義（正本）

実装は `src/lib/knowledgeChunkSchema.ts`（新規）に置く。`firestoreSchema.ts` と同じく Zod を一次定義として使う。

### 3.1 `KnowledgeChunk`

```ts
export const KNOWLEDGE_CHUNK_SCHEMA_VERSION = 1 as const;

export type KnowledgeChunk = {
  id: string;
  docId: string;
  schemaVersion: typeof KNOWLEDGE_CHUNK_SCHEMA_VERSION;

  sourceType: 'text' | 'pdf' | 'image' | 'spreadsheet' | 'slide';
  structureType:
    | 'paragraph'
    | 'table'
    | 'list'
    | 'cellRange'
    | 'imageText';
  locator: KnowledgeChunkLocator;

  title?: string;
  text: string;
  /** Chunk 単位 masking 結果。inline 保存（B 案）。masked が未生成のときは undefined。 */
  maskedText?: string;

  /** Document curator 結果からの継承 + 列ヘッダ等のルール昇格を適用した最終値。 */
  sensitivity: Sensitivity;
  aiUsePolicy: AiUsePolicy;

  /** sensitivity / aiUsePolicy が document 継承から chunk 単位ルールで変化した場合の理由。 */
  sensitivityReason?: string;
  /** 'inherited' = document からそのまま / 'columnRule' 等 = chunk 単位昇格。 */
  sensitivitySource: 'inherited' | 'columnRule';

  /** Extractor / Masker の証跡。 */
  extractionProvider: 'csv' | 'xlsx' | 'pdf' | 'slides' | 'image';
  extractionWarnings?: string[];
  maskedSpansCount?: number;
  ruleHits?: Record<string, number>;

  sourceHash: string;
  createdAt: string;
  updatedAt: string;
};
```

### 3.2 `KnowledgeChunkLocator`（discriminated union）

```ts
const KnowledgeChunkLocator = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('spreadsheet'),
    sheetName: z.string(),
    range: z.string(), // 例: "A1:E20"
  }),
  z.object({
    kind: z.literal('pdf'),
    page: z.number().int().min(1),
    paragraphId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('slide'),
    slide: z.number().int().min(1),
  }),
  z.object({ kind: z.literal('imageText') }),
  z.object({ kind: z.literal('paragraph') }),
]);
```

`structureType` と `locator.kind` は別軸で両方残す（locator = 物理位置、structureType = 論理表現）。例: PDF page 3 の table = `{ locator: { kind: 'pdf', page: 3 }, structureType: 'table' }`。

### 3.3 Firestore subcollection

```
documents/{docId}
  chunks/{chunkId}
```

- subcollection 内のドキュメント形は §3.1 と一致（`createdAt` / `updatedAt` のみ Firestore `Timestamp`）。
- top-level `knowledgeChunks/{chunkId}` は Phase 2 では作らない（cross-document search は Phase 3 以降）。

---

## 4. 不変条件 (chunk 用)

document invariant とは**完全に分離**する。chunk 側の invariant は以下:

1. `chunk.docId` に対応する document が存在し、`status` が `curated` / `ai_safe` / `restricted` / `blocked` のいずれかである（terminal 状態のみ chunk を持てる）。
2. `chunk.sensitivity === 'Restricted'` なら `chunk.aiUsePolicy === 'blocked'`。
3. `chunk.sensitivity === 'Confidential'` なら `chunk.aiUsePolicy === 'requires_masking'`。
4. `chunk.aiUsePolicy === 'requires_masking'` なら `chunk.maskedText` が存在する（B 案の核）。
5. `chunk.sensitivitySource === 'columnRule'` なら `chunk.sensitivityReason` が非空。
6. `chunk.sourceHash` は extractor 入力 + locator から決定的に算出される（再生成時の冪等性検証）。

これらは `validateKnowledgeChunkInvariants(chunk)` として `firestoreSchema.ts` の流儀で実装し、Firestore write 直前に `assertChunkInvariants` で叩く。

---

## 5. 列ヘッダルール

extractor 内で chunk 生成直後に走る pure 関数:

```ts
upgradeChunkSensitivityFromColumnHeader(
  chunk: KnowledgeChunk,
  rules: ColumnSensitivityRules
): KnowledgeChunk
```

初期ルール (列名 → 昇格先):

| 列名 | 昇格先 sensitivity | aiUsePolicy |
|---|---|---|
| 顧客名 / 氏名 / 担当者 | Confidential | requires_masking |
| メール / Email | Confidential | requires_masking |
| 電話番号 / Tel | Confidential | requires_masking |
| 住所 | Confidential | requires_masking |
| 個別金額 / 単価 / 報酬 | Confidential | requires_masking |

- 判定は header 完全一致 + 部分一致のホワイトリスト方式（後で表記揺れに対応）。
- ルールは `src/lib/columnSensitivityRules.ts` に定義し、ユニットテスト必須。
- `applyMaskerUpgrade` と同じく**一度上げたら下げない**。

---

## 6. Context Package input builder の chunk-aware 化

`buildContextPackageExportInput` (`src/lib/contextPackageInput.ts`) を以下のように拡張:

```ts
export type BuildContextPackageInputOptions = {
  purpose: string;
  documents: InventoryDocument[];
  chunks?: KnowledgeChunk[]; // 追加
  // ... 既存項目
};
```

ルール:
- `chunks` が渡されたとき: chunk を優先して出力に組み立てる。
- `chunks` がないとき: 既存の document body ベースで従来挙動を維持する（document-only export を壊さない）。
- chunk フィルタ:
  - `chunk.aiUsePolicy === 'blocked'` → 出力禁止
  - `chunk.sensitivity === 'Restricted'` → 出力禁止
  - `chunk.aiUsePolicy === 'requires_masking'` → `maskedText` のみ included、未生成なら humanReview
  - その他 (`direct`) → `text` を included
- chunk が属する document が `blocked` / `restricted` のときは chunk も出力しない。

既存の `exportContextPackage` 出力フォーマットへの追加セクションは Phase 2 では入れない（既存「Full AI-Ready Sources」セクションに sheet/range を hint として注記する程度に留める）。

---

## 7. 実装順 (Phase 2)

1. `KnowledgeChunk` Zod schema + `validateKnowledgeChunkInvariants` (`src/lib/knowledgeChunkSchema.ts`)
2. CSV extractor (`src/lib/extractors/csvExtractor.ts`) — markdown table 正規化 + chunk 配列の併産
3. CSV extractor unit test (header rule・range・sourceHash 冪等性)
4. `columnSensitivityRules.ts` + pure `upgradeChunkSensitivityFromColumnHeader` + ユニットテスト
5. `.xlsx` extractor (`src/lib/extractors/xlsxExtractor.ts`)（dep: `xlsx`） — sheet/used range 単位
6. `.xlsx` extractor unit test
7. Chunk Firestore adapter (`src/lib/chunkFirestoreAdapter.ts`) — `listChunksForDocument(docId)` / `replaceChunksForDocument(docId, chunks)` (delete-then-batch-write)
8. Chunk adapter fake Firestore test
9. Chunk DLP/masker 関数境界 (`maskKnowledgeChunk(chunk)` — chunk.text → maskedText)
10. `buildContextPackageExportInput` の chunk-aware 化 + 既存テスト維持確認
11. CLI script `scripts/regenerateChunks.ts` (`npm run chunks:regenerate -- <docId>`)
12. demo runbook (`docs/demo-runbook.md`) に Phase 2 smoke 追記
13. live smoke: 既存 document に対し CLI を叩いて chunk を作り、Firestore に保存・読み戻し・Context Package output に反映するところまで

`MAX_UPLOAD_BYTES` の引き上げは **5 (.xlsx extractor) と同じ PR でのみ** 行う。

---

## 8. Phase 2 完了条件

- `KnowledgeChunk` 型と Zod schema が定義され、invariant 検査関数が動く
- CSV を spreadsheet chunk に変換できる（test 緑）
- `.xlsx` を sheet / used range chunk に変換できる（test 緑）
- chunk が Firestore subcollection に保存・読み戻しできる（fake Firestore test 緑）
- chunk text に DLP / simple-rule provider を適用する `maskKnowledgeChunk` 関数境界が存在する
- Context Package input builder が chunk を受け取れる（既存 document-only 経路も壊れていない）
- 列ヘッダルールで chunk 単位 sensitivity 昇格が動く
- CLI `chunks:regenerate` で既存 document に対して chunk 全置換ができる
- live smoke: 既存 document に CLI を叩いて chunk subcollection を作成・Context Package に反映、を 1 ケース完了
- document lifecycle invariant (`validateFirestoreDocumentInvariants`) を **触っていない**
- DLP / Masker / Context Package の既存テストが全て通る

---

## 9. Phase 2 で**やらない**こと（明示）

- upload 直後の chunk 自動生成
- chunk subcollection の状態を document lifecycle invariant に含める
- chunk 単位の GCS masked object 作成
- top-level `knowledgeChunks/{chunkId}` collection
- PDF / Slides / Image の本実装（設計メモのみ §10）
- chunk-aware の新規 UI 画面（dev/debug 表示の必要が出たら最小限のみ）
- `POST /api/documents/:docId/chunks` API
- `MAX_UPLOAD_BYTES` の無条件引き上げ
- chunk から document への invariant feedback (chunk が restricted になったら document も restricted、のような昇格)

---

## 10. PDF / Slides / Image — 設計メモのみ

Phase 2 本実装外。型と provider 候補だけ残す。

- **PDF**: Document AI Layout Parser 候補。chunk 単位は `paragraph` / `table`、locator = `{ kind: 'pdf', page }`。
- **Slides**: Google Slides API or pptx parser。chunk 単位は `title` / `bullets` / `notes` / `table`、locator = `{ kind: 'slide', slide }`。
- **Image**: OCR + Gemini multimodal 候補。chunk 単位は `imageText`、locator = `{ kind: 'imageText' }`、bounding box は後続。

---

## 11. Strategist (Phase 3) への接続準備

Phase 2 で chunk が持つことになる metadata は、Phase 3 の Strategist がそのまま参照できる:

- `docId` / `chunkId` / `sourceType` / `structureType` / `locator`
- `title` / `text` / `maskedText`
- `sensitivity` / `aiUsePolicy` / `sensitivitySource` / `sensitivityReason`
- document からの継承属性: `documentType` / `businessDomain` / `freshness` / `isAuthoritativeCandidate`（chunk には保持せず、Strategist 時に document を join して取得する）

Strategist 本体実装は Phase 3 で行う。Phase 2 では型シグネチャ予約のみ (`src/agents/strategist/types.ts`)。

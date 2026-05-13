# Live Demo Runbook (MVP / W2)

Upload → Firestore/GCS → Inventory → Context Package を再現するための実行手順です。  
この時点では **MVP デモ** であり、PDF 専用抽出は未導入です。**Google Sheets** は [Phase 3-A](phase-3-google-sheets-import.md) の URL 取り込み（`/import/google-sheets`）で Drive 上のブックをスナップショット化して投入できます。  
現状のマスキング境界は **SimpleMasker または Cloud DLP + Gemini residual risk** です。

## 1. 前提条件

- Node.js 22 以上
- GCP project（課金/API 利用可能）
- ADC (Application Default Credentials) が利用可能
- Firestore (Native mode) を有効化済み
- GCS bucket を作成済み（`KNOWLEDGE_HUB_BUCKET`）
- Cloud DLP smoke を使う場合は Sensitive Data Protection API (`dlp.googleapis.com`) を有効化済み

## 2. セットアップ

1. 依存をインストール

   ```bash
   pnpm install --frozen-lockfile
   ```

2. 環境変数ファイルを作成

   ```bash
   cp .env.local.example .env.local
   ```

3. `.env.local` を最低限更新

   ```dotenv
   GOOGLE_CLOUD_PROJECT=your-project-id
   GOOGLE_CLOUD_LOCATION=asia-northeast1
   KNOWLEDGE_HUB_BUCKET=your-bucket-name
   # Optional: MASKER_PROVIDER=cloud-dlp
   ```

   `pnpm context:demo` / `context:demo:live` / `context:demo:w1` および `pnpm chunks:regenerate` は、エントリの `scripts/runContextPackageDemo.ts` / `scripts/regenerateChunks.ts` が先頭で `import './loadEnv'` するため、**リポジトリルートで実行するとき** `dotenv` 経由で **`.env.local` が自動読み込み**されます（ファイルが無ければ何もしません）。別ディレクトリの cwd から `tsx` を直接叩く場合は `.env.local` が読まれないので、環境変数をシェルで渡すか cwd をルートにしてください。

4. ADC を設定して認証確認

   ```bash
   gcloud config set project "$GOOGLE_CLOUD_PROJECT"
   gcloud auth application-default login
   gcloud auth application-default set-quota-project "$GOOGLE_CLOUD_PROJECT"
   gcloud auth application-default print-access-token >/dev/null
   ```

5. Cloud DLP を使う場合のみ API を有効化

   ```bash
   gcloud services enable dlp.googleapis.com --project="$GOOGLE_CLOUD_PROJECT"
   ```

6. （Phase 3-B）Google Workspace 由来の **同一 Drive `fileId` を再取り込みする de-dup 検索**に使う複合インデックスを用意する。設計根拠は [docs/phase-3-b-workspace-resync.md](phase-3-b-workspace-resync.md)（§3 末尾・§6–10 のチェックリスト）を参照。

   リポジトリ直下の [`firestore.indexes.json`](../firestore.indexes.json) と同一定義を GCP に反映する方法の例:

   - **gcloud（このリポジトリの正本 JSON を使わず 1 本で作成）**

     ```bash
     gcloud config set project "$GOOGLE_CLOUD_PROJECT"
     gcloud firestore indexes composite create \
       --collection-group=documents \
       --query-scope=collection \
       --field-config=field-path=externalSource.fileId,order=ascending \
       --field-config=field-path=sourceKind,order=ascending
     ```

     ビルド完了まで数分かかることがあります。未作成のまま該当クエリを実行すると Firestore が `FAILED_PRECONDITION` とインデックス作成用リンクを返します。

   - **Firebase CLI**: ルートの `firestore.indexes.json` を `firebase.json` の `firestore` 設定から参照しているプロジェクトでは、`firebase deploy --only firestore:indexes` で同一定義を反映できる。

## 3. 開発サーバー起動

```bash
pnpm dev
```

ブラウザで `http://localhost:3000/upload` を開きます。

## 4. Upload UI で投入する推奨サンプル

`sample-data/accounting-office/` から以下を使うと挙動差を確認しやすいです。

- `給与計算チェックリスト.md`（curated 想定）
- `顧客対応メモ_書式.md`（ai_safe 想定）
- `顧問契約書_実案件サンプル.txt`（restricted になり得る）
- `古い料金表_2023.csv`（運用条件により blocked / review 寄りになり得る）
- **`.xlsx`**（Excel）も Phase 2 の upload 対象。料金表・顧客一覧などをシート単位で投入し、`chunks:regenerate` では CSV と同様に spreadsheet chunk 化できる

## 5. Google Sheets を取り込むデモ手順

Phase 3-A は **Drive API で `.xlsx` をエクスポート**し、既存の upload と同じ Curator / Masker / Firestore / GCS 経路に載せます。デモ担当は次の順で進めれば、共有 → URL 投入 → 取り込み完了まで再現できます。

### 5.0 この節だけで取り込み完了まで（推奨順路）

次を **上から順に** 実行すれば、他節を挟まずに Google Sheets の 1 件取り込みが完了します（chunk 生成や Context Package export まで見る場合は §5.3 の末尾と §10 / §7 を続けてください）。**アプリをデプロイして URL を配る場合**は、§5.5 の HTTP 到達制御（PoC / 本番）を先に確認してください。

1. §2 まで完了し、`.env.local` に `GOOGLE_CLOUD_PROJECT` と `KNOWLEDGE_HUB_BUCKET` がある。デモでは **`GOOGLE_APPLICATION_CREDENTIALS`** にサービスアカウント（SA）キー JSON のパスを指定する構成を推奨する（ADC がユーザ認証のみだと環境によって Drive が通らないことがある）。
2. ターミナルで `gcloud services enable drive.googleapis.com --project="$GOOGLE_CLOUD_PROJECT"` を一度実行し、下記 §5.1 の Drive API 前提を満たす。
3. §3 のとおり `pnpm dev` を起動する。
4. ブラウザで `http://localhost:3000/import/google-sheets` を開く。
5. ページ内 **フォーム直上** の **「サービスアカウント」** パネルに表示されているメールアドレスをコピーする（読み込み失敗時は §5.1 と SA キー／ADC を確認する）。
6. 取り込みたい Google スプレッドシートを開き、下記 §5.2 のとおり、そのメールアドレスを **閲覧者** で共有する（別 SA にだけ共有していると 403 になる）。
7. 同一ページのフォームにスプレッドシートの **URL** または **fileId** を貼り、§5.3 のとおり取り込みを実行する。
8. 成功したらブラウザで `http://localhost:3000/`（Inventory）を開き、新しい document の **status / sensitivity** が期待どおりか確認する（詳細は §6）。
9. `403` や共有エラーが出たら §5.4 の表に沿って原因を切り分ける。

### 5.1 前提（API と認証）

- §2 まで完了しており、`pnpm dev` が起動できること。
- 対象 GCP プロジェクトで **Google Drive API** が有効であること（未設定なら一度だけ実行）:

  ```bash
  gcloud services enable drive.googleapis.com --project="$GOOGLE_CLOUD_PROJECT"
  ```

- サーバーが Drive にアクセスするときの主役は **サービス アカウント（SA）** です。ローカルでは通常 `GOOGLE_APPLICATION_CREDENTIALS` に SA キー JSON のパスを指定します（§8 の live E2E と同様）。ADC がユーザ認証のみの場合、実行環境のポリシーに依存するため、**デモでは SA キーを明示した構成を推奨**します。

### 5.2 取り込み対象の Sheet を SA と共有する

**共有先のメールアドレス**は、アプリが Drive を呼び出すときに使っている SA の `client_email` と一致している必要があります。**`http://localhost:3000/import/google-sheets` を開くと、フォーム直上の「サービスアカウント」パネルにその SA のメールアドレスがコピー用に表示されます**（ここに出たアドレスをそのまま Sheets の共有相手に追加する）。

共有は Google Sheets 側で行います。

1. 取り込みたいスプレッドシートをブラウザで開く。
2. 右上の **共有** を開く。
3. 上記の SA メールアドレスを追加し、権限は **閲覧者** で足ります（エクスポートは読み取り相当の操作のため）。
4. 保存して、SA がファイル一覧から当該ブックを開ける状態にする。

**GCP コンソールで SA メールを突き合わせる場合**（UI と同一か確認したいとき）:

1. [Google Cloud コンソール](https://console.cloud.google.com/) で対象プロジェクトを選択する。
2. 左メニュー **IAM と管理** → **サービス アカウント** を開く。
3. アプリが使っているサービス アカウント（ローカルならキー JSON の `client_email`、Cloud Run なら実行サービス アカウント）を選び、**メール**列のアドレスをコピーする。
4. それが import ページの **「サービスアカウント」** パネル（フォーム直上）に表示されているアドレスと一致していることを確認する。

### 5.3 URL を貼って取り込むまでの流れ

1. §3 のとおり `pnpm dev` を起動する。
2. ブラウザで `http://localhost:3000/import/google-sheets` を開く。
3. **「サービスアカウント」** パネル（フォーム直上）のメールをコピーし、§5.2 のとおり Sheet に共有済みであることを確認する。
4. フォームに **スプレッドシートの URL**（例: `https://docs.google.com/spreadsheets/d/{fileId}/edit`）または **素の fileId** を貼り付ける。  
   **注意**: URL に特定タブの `gid=...` が付いていても **全シートをまとめて**取り込みます（設計上 `gid` は無視）。UI の説明文にも同趣旨が記載されています。
5. 任意の表示名があれば入力し、取り込み（送信）を実行する。
6. 成功したら §6 と同様に、Firestore の `documents/{docId}` と GCS の `raw/{docId}/...xlsx`、トップの Inventory で status / sensitivity を確認する。
7. 必要に応じて §10 で `chunks:regenerate -- <docId>` を実行し、§7 の `context:demo:live` で `sheet=…, range=…` 付きの export を確認する。

### 5.4 `403` が出たときの典型原因と対処

| 想定原因 | 対処 |
| --- | --- |
| Sheet を **SA メールと共有していない**、または別の SA にだけ共有している | import ページの **「サービスアカウント」** パネルに表示されているメールと **完全一致**する相手に、対象ブックを閲覧者で共有し直す。GCP コンソールのサービス アカウント一覧と突き合わせる（§5.2）。 |
| **Google Workspace** のドメインで、組織外（プロジェクトの SA は多くの場合組織外）への共有が管理者ポリシーで禁止されている | 管理者に依頼して当該 SA を許可リストに入れるか、共有用に制限の緩いテスト用 Google アカウント／個人 Gmail 上の Sheet でデモする。 |
| 貼った URL がスプレッドシート以外、または **アクセスのない別ユーザのファイル** | URL を見直す。ブラウザでは開けても、**サーバー側の SA に共有されていなければ** Drive からは読めない。 |
| **Drive API 未使用**のプロジェクト | §5.1 のとおり `drive.googleapis.com` を有効化してから再試行。 |

API が返すエラーメッセージに **共有すべき SA メール**が含まれる場合は、その文字列に従って共有設定を直す。

### 5.5 `POST /api/import/google-sheets` の到達制御（PoC と本番）

UI のフォームは **`POST /api/import/google-sheets`** を呼ぶ。現状の実装ではこの API に **アプリ層の認証・認可・レート制限はない**（demo / PoC 前提）。到達できるクライアントからは、SA が共有を受けている Spreadsheet について **Drive export → GCS 書き込み → Curator/Masker（Vertex 等）** までが起動しうる。**Sheet を SA と共有していることは、HTTP 面の匿名アクセスを防がない。**

- **本番やインターネット公開**: **認証・認可・レート制限は必須**。Cloud Run を広く公開する場合は **IAP**、**token 検証**、**限定ネットワーク（VPC / internal ingress）**、**Cloud Armor / LB / アプリの rate limit**、ブラウザ経路では **SameSite / CSRF** など、多層の shield を設計ドキュメントに沿って入れること。
- **この runbook が想定する PoC**: 主に **`localhost` の `pnpm dev`**、または **IAP や VPC で到達が限定された** Cloud Run など、**意図した利用者だけが URL にアクセスできる**前提。パブリック URL を一時的に出す場合は、上記に近い制御と **クォータ監視・事後の無効化** を手順に含める。

未認証エンドポイントのリスクと本番要件の正本は [docs/phase-3-google-sheets-import.md](phase-3-google-sheets-import.md) の **「5. HTTP API と公開運用上のセキュリティ（PoC 制約）」** 節を参照。

## 6. Upload 後に見るポイント

`/upload` の multipart でも、§5 の Google Sheets import でも、パイプラインが成功すれば同じ Firestore / GCS の形で終端に達します（`sourceKind` が `google_workspace` の行は Drive 由来のメタデータが付きます）。

### `/upload` 直後

- 成功時は `documents/{docId}` が Firestore に保存され、`raw/{docId}/...` が GCS に保存される
- 文書によって以下の見え方になる
  - `curated`: そのまま AI 参照候補
  - `ai_safe`: マスク済み本文を AI 参照候補
  - `restricted`: human review only（Context Package 本文には入れない）
  - `blocked`: AI 参照対象外（human review 側で扱う）

### Inventory (`/`)

- トップページの **Firestore Inventory** セクションで status/sensitivity を確認
- Firestore 読み取り不能時のみ W1 snapshot fallback が使われる

## 7. Context Package export

1. live corpus から生成（Firestore + GCS）

   ```bash
   pnpm context:demo:live
   ```

2. fixture から生成（offline）

   ```bash
   pnpm context:demo:w1
   ```

3. 統一エントリを使う場合

   ```bash
   pnpm context:demo         # default: live
   pnpm context:demo -- --w1 # fixture
   ```

### live と fixture の違い

- `context:demo:live`: Firestore/GCS 正本のみを読む。失敗時は fallback せず non-zero で終了。
- `context:demo:w1`: `docs/w1-artifacts/inventory.snapshot.json` を使う完全オフライン実行。

### `context:demo:live` と chunk（Phase 2）

`buildFirestoreContextPackageExportInput`（`src/lib/contextPackageFirestoreAdapter.ts`）は、inventory の各 document について **`documents/{docId}/chunks` を列挙**し、得られた `KnowledgeChunk[]` を `buildContextPackageExportInput` に渡します。

- **chunk が 1 件以上ある document**: `Full AI-Ready Sources` は **chunk の `text` / `maskedText`** を使い、行タイトルに `fileName (sheet=…, range=…)` 形式のヒントが付く（GCS 本文の document-only 経路は使わない）。
- **chunk が 0 件の document**: 従来どおり GCS から `aiSafeContent` を読むフォールバック（未再生成の既存 corpus も空にならない）。

確認するときは、§10 の手順で chunk を生成したうえで `pnpm context:demo:live` を実行し、該当ファイルのセクションが chunk 由来になっているかを見ます。

## 8. E2E test policy

E2E は 2 層に分けます。

- `e2e:smoke`: GCP / Vertex / 認証に依存しない安定テスト。fake Firestore / fake GCS と stub Curator / Masker を使い、library/API 境界で `Upload → Firestore/GCS → Inventory → Context Package export` を通します。CI とローカルの通常確認はこちらを使います。
- `e2e:live`: 実 GCP / Firestore / GCS / Vertex を使う手動テスト枠。課金、外部リソース、認証が必要なため、デフォルト CI では走らせません。破壊的 cleanup は自動実行せず、作成した docId / object path をログで確認して手動整理します。

smoke E2E:

```bash
pnpm test:e2e:smoke
```

現在の smoke E2E は次を検証します。

- Curator が `requires_masking` を返す upload 相当入力を流す
- Masker が `ai_safe_ready` を返す経路で raw / masked 相当の保存内容を確認する
- Firestore 相当の終端 metadata が `ai_safe` になることを確認する
- Inventory adapter が該当 document を `ai_safe` として読めることを確認する
- Context Package export が masked body を `Full AI-Ready Sources` に含め、raw body を含めないことを確認する
- Masker が `restricted_promoted` を返す経路で masked object が作られず、Inventory は `restricted`、Context Package では included ではなく human review 側になることを確認する

live E2E:

```bash
pnpm test:e2e:live
```

必須 env:

```dotenv
GOOGLE_CLOUD_PROJECT=your-project-id
KNOWLEDGE_HUB_BUCKET=your-bucket-name
# Either GOOGLE_APPLICATION_CREDENTIALS or ADC:
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
# GEMINI_MODEL is optional
GEMINI_MODEL=gemini-...
```

ADC を使う場合:

```bash
gcloud auth application-default login
```

env が不足している場合、live E2E は skip します。live E2E を実装拡張する場合も、自動削除は入れず、作成した `documents/{docId}` と `raw/` / `masked/` object path をログに出してください。

## 9. DLP live smoke

Cloud DLP provider 単体の疎通確認:

```bash
pnpm masker:dlp:smoke -- sample-data/accounting-office/顧客対応メモ_書式.md
pnpm masker:dlp:smoke -- sample-data/accounting-office/顧問契約書_実案件サンプル.txt
```

Pipeline 経由の provider 差し替え確認:

```bash
MASKER_PROVIDER=cloud-dlp pnpm masker:pipeline -- sample-data/accounting-office/顧客対応メモ_匿名化.txt
```

2026-05-11 の live smoke 証跡:

| サンプル | 結果 |
|---|---|
| `顧客対応メモ_書式.md` | `provider=cloud-dlp`, `maskedSpansCount=0`, テンプレートなので検出 0 件 |
| `顧問契約書_実案件サンプル.txt` | `provider=cloud-dlp`, `maskedSpansCount=25` |
| `顧問契約書_実案件サンプル.txt` の `ruleHits` | `PERSON_NAME=14`, `STREET_ADDRESS=2`, `LOCATION=6`, `PHONE_NUMBER=2`, `JAPAN_BANK_ACCOUNT=1` |
| `顧客対応メモ_匿名化.txt` pipeline | `maskingResult.provider=cloud-dlp`, DLP span 0 件、Gemini residual risk が文脈リスクを検出し `restricted_promoted` |

この結果により、DLP は決定論的 PII、Gemini residual risk は文脈的な再識別リスクを見る分担が live で確認済み。

## 10. Phase 2: Chunk regeneration smoke

Phase 2 の chunk 生成・Firestore 保存・Context Package 反映を手動で確認する手順です。

### 前提

- Firestore に **chunk 再生成の対象になりうる終端 document** が少なくとも 1 件ある（`curated` / `ai_safe` / `restricted` / `blocked`。`scripts/regenerateChunks.ts` の `TERMINAL_CHUNK_ELIGIBLE_STATUSES` と一致）
- 列ヘッダに「顧客名」を含む **CSV または .xlsx** を 1 件以上投入済みであること（sensitivity 昇格の確認用。デモしやすいのは通常 `ai_safe` の spreadsheet）

### 手順

1. **対象 docId を控える**

   Inventory UI (`/`) または `pnpm context:demo:live` の出力で、chunk 化したい **`.csv` / `.xlsx`** の document を 1 件選び、docId を控えます（上記の終端 status であること）。

2. **chunk 再生成を実行**

   ```bash
   pnpm chunks:regenerate -- <docId>
   ```

   Cloud DLP で chunk masking まで固定して再生成したい場合:

   ```bash
   pnpm chunks:regenerate -- --provider=cloud-dlp <docId>
   ```

   > **設計原則（D-P2-4）: chunk 再生成は document 単位の全置換である。**  
   > CLI は実行開始時に `maskerProvider=...` を出力します。`--provider` 未指定時は `.env.local` / 環境変数 `MASKER_PROVIDER` / default の解決に従います。  
   > 実装（`replaceChunksForDocument`）は **(1) 新 chunk を batch write（同一 `chunk.id` は上書き）→ (2) 新セットに含まれない旧 chunk id を batch delete** の順です。write を先にすることで、**write 失敗時に subcollection が空になる**のを避けています。  
   > **削除フェーズが途中で失敗した場合**、古い chunk が **stale として残りうる**ため、その瞬間は「新しい id と古い id が混在」するなど **一貫した単一世代とは限らない**状態になり得ます。**次回 `chunks:regenerate` が最後まで成功すれば** stale は取り除かれ、収束します。  
   > 成功パスでは何度実行しても同じ chunk 集合に収束する **冪等** な操作です。

3. **Firestore コンソールで subcollection を確認**

   GCP コンソール → Firestore → `documents/{docId}/chunks/` を開き、以下を確認します:

   - `chunkId` / `docId` / `sourceType` / `structureType` / `locator` が存在する
   - `sensitivity` / `aiUsePolicy` / `sensitivitySource` が設定されている

4. **列ヘッダ昇格の確認（顧客名を含む CSV / .xlsx の場合）**

   列ヘッダに「顧客名」を含むスプレッドシートから生成された chunk は以下になっているはずです:

   | フィールド | 期待値 |
   |---|---|
   | `sensitivity` | `Confidential` |
   | `aiUsePolicy` | `requires_masking` |
   | `sensitivitySource` | `columnRule` |
   | `sensitivityReason` | 列ヘッダ昇格の理由（非空） |

   document の curator 結果が `curated` / `ai_safe` であっても、列ヘッダルールにより **chunk 単位で sensitivity が昇格**します（`applyMaskerUpgrade` と同じ哲学: 一度上げたら下げない）。

5. **Context Package を chunk 込みで export**

   ```bash
   pnpm context:demo:live
   ```

   `context:demo:live` は Firestore から chunk を読み込み（§7 参照）、chunk がある document は **chunk 本文**が `Full AI-Ready Sources` に載ります。spreadsheet の場合、見出しに **`fileName (sheet=…, range=…)`** が付くことを確認します（Markdown 内の `[Sheet1 A1:E20]` のような表記は export 実装に依存します）。

### Phase 2 固有のよくある失敗

| 症状 | 確認ポイント |
|---|---|
| `Document not found` / 終端以外で弾かれる | docId の typo、または status が `curated` / `ai_safe` / `restricted` / `blocked` 以外（chunk 非対象） |
| `chunks/` が空 | `.csv` / `.xlsx` 以外の document を指定した場合、Phase 2 の CLI extractor は未対応 |
| chunk の `sensitivity` が昇格しない | 列ヘッダが `columnSensitivityRules.ts` のホワイトリストにない。部分一致・表記揺れを確認する |
| 再実行で chunk **件数**が期待とずれる | 成功完了のたびに新 id 集合へ収束する設計。削除フェーズ失敗直後は stale が残り件数が一時的に増えうる → **再実行で成功すれば**収束 |

---

## 11. よくある失敗

- `KNOWLEDGE_HUB_BUCKET` 未設定
  - リポジトリルートの `.env.local` を確認（`pnpm context:demo:live` は `loadEnv` で読み込み）。ルート以外の cwd で `tsx` 直実行している場合は環境変数が未注入のことがある
- ADC 未設定
  - `gcloud auth application-default login` を再実行
- ADC reauth (`invalid_rapt`)
  - `gcloud auth application-default login` と `gcloud auth application-default set-quota-project "$GOOGLE_CLOUD_PROJECT"` を再実行
- DLP API disabled (`SERVICE_DISABLED`)
  - `gcloud services enable dlp.googleapis.com --project="$GOOGLE_CLOUD_PROJECT"` を実行し、数分待って再試行
- Firestore が空
  - まず `/upload` から数件投入する
- GCS object missing
  - Firestore の `storagePath` / `aiSafeStoragePath` と bucket 内 object の整合を確認
  - 現状は該当文書のみ human review に回り、読めた文書は export 継続
- Vertex/Gemini auth failure
  - `GOOGLE_CLOUD_PROJECT` / IAM 権限 / ADC を再確認
- Google Sheets の import で **403** / Drive がファイルにアクセスできない
  - §5.4（共有漏れ・Workspace 共有制限・Drive API 未使用など）を確認する

## 12. Reset / cleanup（手動のみ）

- Firestore `documents` collection と `gs://$KNOWLEDGE_HUB_BUCKET/raw/`, `gs://$KNOWLEDGE_HUB_BUCKET/masked/` を手動で整理する
- 破壊的操作のため、本リポジトリでは **自動削除スクリプトは提供しない**
- 誤削除防止のため、対象 project / bucket を必ず二重確認してから実施する

---

## 13. Phase 3-B 運用（schemaVersion 2・インデックス・再取り込み・鮮度）

[docs/phase-3-b-workspace-resync.md](phase-3-b-workspace-resync.md) §6–12 の実装・完了条件に沿ったデモ／運用手順です。Phase 3-A の Sheets 取り込み（§5）に加え、**同じ Drive ファイルの上書き de-dup** と **詳細ページの鮮度バッジ**を見せるときに使います。

### 13.1 schemaVersion 2 への移行（`backfillSourceKind.ts`）

既存の `documents` が `schemaVersion: 1` のまま残っていると、parser が `sourceKind` 必須化したビルドでは読み取りに失敗し得ます。Firestore へ一括で足す手順は **dry-run → confirm の 2 段**に固定されています（設計根拠: [phase-3-b-workspace-resync.md](phase-3-b-workspace-resync.md) D-P3-B-3・§3「backfill script」）。

前提:

- リポジトリルートで実行し、§2 のとおり `.env.local` と ADC（または `GOOGLE_APPLICATION_CREDENTIALS`）で Firestore に接続できること。

手順:

1. **dry-run**（書き込みなし。対象件数と先頭 5 件の docId を表示）

   ```bash
   pnpm backfill:source-kind -- --dry-run
   ```

2. 出力の `targetCount` / `previewDocIds` を確認する。

3. **confirm**（`schemaVersion: 1` の document を batch で `schemaVersion: 2`, `sourceKind: 'upload'`, `externalSource: null` に更新）

   ```bash
   pnpm backfill:source-kind -- --confirm
   ```

`--dry-run` と `--confirm` は **どちらか一方だけ**指定してください（両方・未指定はエラー）。

### 13.2 Firestore 複合インデックス（`gcloud`）

同一 Drive `fileId` の既存 document を検索する de-dup 用に、`externalSource.fileId` + `sourceKind` の複合インデックスが必要です。設計は [phase-3-b-workspace-resync.md](phase-3-b-workspace-resync.md) §3「Firestore index」。ルートの [`firestore.indexes.json`](../firestore.indexes.json) と同一定義です。

```bash
gcloud config set project "$GOOGLE_CLOUD_PROJECT"
gcloud firestore indexes composite create \
  --collection-group=documents \
  --query-scope=collection \
  --field-config=field-path=externalSource.fileId,order=ascending \
  --field-config=field-path=sourceKind,order=ascending
```

ビルド完了まで数分かかることがあります。未作成のまま該当クエリを実行すると Firestore が `FAILED_PRECONDITION` とインデックス作成用リンクを返します。Firebase CLI で `firestore.indexes.json` をデプロイする手順は §2 項目 6 も参照してください。

### 13.3 再取り込みデモ動線（同じ URL を 2 度）

**目的**: 同じスプレッドシート（または Doc）を再度取り込んでも **Inventory に行が増えず**、既存 docId が再利用されることを見せる（`kind: 'overwritten'`）。

1. §5 の手順で 1 度目の取り込みを完了し、`/` で document が 1 件増えたことを確認する。
2. 同じ **スプレッドシート URL**（または fileId）を、もう一度 `http://localhost:3000/import/google-sheets` のフォームに貼り、取り込みを実行する。
3. 成功レスポンスに `kind: 'overwritten'` が含まれること、Inventory の **件数が増えない**（同一 docId）ことを確認する。
4. 代替動線: 文書詳細 `http://localhost:3000/documents/{docId}` を開き、**再取り込み**ボタンから同じソースで上書きを実行する（Workspace 由来の document のみ）。

`contentSha256` が Drive 側のバイト列と一致している場合は Vertex 等をスキップし `skipped: true` が返る短絡パスがあります（[phase-3-b-workspace-resync.md](phase-3-b-workspace-resync.md) §5 上書きマトリクス）。

### 13.4 Drive 上で更新 → 詳細ページの鮮度バッジ

**目的**: Drive の `modifiedTime` が取り込み済みスナップショットより新しいとき、詳細ページで **「Drive 上で更新されています」** が出ることを確認する（read-time で `GET /api/workspace/freshness?docId=...` が走る設計。正本: [phase-3-b-workspace-resync.md](phase-3-b-workspace-resync.md) D-P3-B-5）。

1. §5 で Workspace 由来の Sheet（または Doc）を 1 件取り込み、Inventory から当該 document の **詳細**へ進む（`http://localhost:3000/documents/{docId}`）。
2. ブラウザで Google Drive / Sheets を開き、**セルやタイトルなど実際に保存される変更**を加えて保存する（`modifiedTime` が進むこと）。
3. 文書詳細を **再読み込み**する。鮮度行に **「Drive 上で更新されています」**（stale）が出れば OK。更新していない状態では **「最新」**（fresh）になる。
4. Drive から共有が外れた・ファイル削除などでは **「Drive 側で参照できなくなりました」** 系の表示や **「鮮度：不明」** になり得る。SA 共有と §5.4 を併せて確認する。

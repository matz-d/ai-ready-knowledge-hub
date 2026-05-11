# Live Demo Runbook (MVP / W2)

Upload → Firestore/GCS → Inventory → Context Package を再現するための実行手順です。  
この時点では **MVP デモ** であり、PDF 専用抽出 / Google Drive 連携は未導入です。  
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
   npm ci
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

## 3. 開発サーバー起動

```bash
npm run dev
```

ブラウザで `http://localhost:3000/upload` を開きます。

## 4. Upload UI で投入する推奨サンプル

`sample-data/accounting-office/` から以下を使うと挙動差を確認しやすいです。

- `給与計算チェックリスト.md`（curated 想定）
- `顧客対応メモ_書式.md`（ai_safe 想定）
- `顧問契約書_実案件サンプル.txt`（restricted になり得る）
- `古い料金表_2023.csv`（運用条件により blocked / review 寄りになり得る）

## 5. Upload 後に見るポイント

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

## 6. Context Package export

1. live corpus から生成（Firestore + GCS）

   ```bash
   npm run context:demo:live
   ```

2. fixture から生成（offline）

   ```bash
   npm run context:demo:w1
   ```

3. 統一エントリを使う場合

   ```bash
   npm run context:demo         # default: live
   npm run context:demo -- --w1 # fixture
   ```

### live と fixture の違い

- `context:demo:live`: Firestore/GCS 正本のみを読む。失敗時は fallback せず non-zero で終了。
- `context:demo:w1`: `docs/w1-artifacts/inventory.snapshot.json` を使う完全オフライン実行。

## 7. E2E test policy

E2E は 2 層に分けます。

- `e2e:smoke`: GCP / Vertex / 認証に依存しない安定テスト。fake Firestore / fake GCS と stub Curator / Masker を使い、library/API 境界で `Upload → Firestore/GCS → Inventory → Context Package export` を通します。CI とローカルの通常確認はこちらを使います。
- `e2e:live`: 実 GCP / Firestore / GCS / Vertex を使う手動テスト枠。課金、外部リソース、認証が必要なため、デフォルト CI では走らせません。破壊的 cleanup は自動実行せず、作成した docId / object path をログで確認して手動整理します。

smoke E2E:

```bash
npm run test:e2e:smoke
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
npm run test:e2e:live
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

## 8. DLP live smoke

Cloud DLP provider 単体の疎通確認:

```bash
npm run masker:dlp:smoke -- sample-data/accounting-office/顧客対応メモ_書式.md
npm run masker:dlp:smoke -- sample-data/accounting-office/顧問契約書_実案件サンプル.txt
```

Pipeline 経由の provider 差し替え確認:

```bash
MASKER_PROVIDER=cloud-dlp npm run masker:pipeline -- sample-data/accounting-office/顧客対応メモ_匿名化.txt
```

2026-05-11 の live smoke 証跡:

| サンプル | 結果 |
|---|---|
| `顧客対応メモ_書式.md` | `provider=cloud-dlp`, `maskedSpansCount=0`, テンプレートなので検出 0 件 |
| `顧問契約書_実案件サンプル.txt` | `provider=cloud-dlp`, `maskedSpansCount=25` |
| `顧問契約書_実案件サンプル.txt` の `ruleHits` | `PERSON_NAME=14`, `STREET_ADDRESS=2`, `LOCATION=6`, `PHONE_NUMBER=2`, `JAPAN_BANK_ACCOUNT=1` |
| `顧客対応メモ_匿名化.txt` pipeline | `maskingResult.provider=cloud-dlp`, DLP span 0 件、Gemini residual risk が文脈リスクを検出し `restricted_promoted` |

この結果により、DLP は決定論的 PII、Gemini residual risk は文脈的な再識別リスクを見る分担が live で確認済み。

## 9. Phase 2: Chunk regeneration smoke

Phase 2 の chunk 生成・Firestore 保存・Context Package 反映を手動で確認する手順です。

### 前提

- Firestore に `ai_safe` 状態の document が少なくとも 1 件存在する（§4 の手順で投入済み）
- 列ヘッダに「顧客名」を含む CSV を 1 件以上投入済みであること（sensitivity 昇格の確認用）

### 手順

1. **対象 docId を控える**

   Inventory UI (`/`) または `npm run context:demo:live` の出力で `status: ai_safe` の document を 1 件選び、docId を控えます。

2. **chunk 再生成を実行**

   ```bash
   npm run chunks:regenerate -- <docId>
   ```

   > **設計原則（D-P2-4）: chunk 再生成は document 単位の全置換である。**  
   > 内部処理は「旧 `chunks/` subcollection を全件 delete → 新 chunk を batch write」の 2 ステップで完結します。  
   > 何度実行しても同じ結果になる**冪等**な操作なので、デモ中に複数回叩いても問題ありません。途中状態は残りません。

3. **Firestore コンソールで subcollection を確認**

   GCP コンソール → Firestore → `documents/{docId}/chunks/` を開き、以下を確認します:

   - `chunkId` / `docId` / `sourceType` / `structureType` / `locator` が存在する
   - `sensitivity` / `aiUsePolicy` / `sensitivitySource` が設定されている

4. **列ヘッダ昇格の確認（顧客名を含む CSV の場合）**

   列ヘッダに「顧客名」を含む CSV から生成された chunk は以下になっているはずです:

   | フィールド | 期待値 |
   |---|---|
   | `sensitivity` | `Confidential` |
   | `aiUsePolicy` | `requires_masking` |
   | `sensitivitySource` | `columnRule` |
   | `sensitivityReason` | 列ヘッダ昇格の理由（非空） |

   document の curator 結果が `curated` / `ai_safe` であっても、列ヘッダルールにより **chunk 単位で sensitivity が昇格**します（`applyMaskerUpgrade` と同じ哲学: 一度上げたら下げない）。

5. **Context Package を chunk 込みで export**

   ```bash
   npm run context:demo:live
   ```

   出力の「Full AI-Ready Sources」セクションに `locator.sheetName` / `locator.range` の hint（例: `[Sheet1 A1:E20]`）が含まれることを確認します。

### Phase 2 固有のよくある失敗

| 症状 | 確認ポイント |
|---|---|
| `docId not found` | Firestore に `ai_safe` document が存在するか確認 |
| `chunks/` が空 | CSV / xlsx 以外の document を指定した場合、Phase 2 では extractor 未対応 |
| chunk の `sensitivity` が昇格しない | 列ヘッダが `columnSensitivityRules.ts` のホワイトリストにない。部分一致・表記揺れを確認する |
| 再実行で chunk が増える | 起こらないはず。全置換なので再実行しても同一 chunk 数になる |

---

## 10. よくある失敗

- `KNOWLEDGE_HUB_BUCKET` 未設定
  - `.env.local` を確認
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

## 11. Reset / cleanup（手動のみ）

- Firestore `documents` collection と `gs://$KNOWLEDGE_HUB_BUCKET/raw/`, `gs://$KNOWLEDGE_HUB_BUCKET/masked/` を手動で整理する
- 破壊的操作のため、本リポジトリでは **自動削除スクリプトは提供しない**
- 誤削除防止のため、対象 project / bucket を必ず二重確認してから実施する

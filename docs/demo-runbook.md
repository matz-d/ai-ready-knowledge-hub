# Live Demo Runbook (MVP / W2)

Upload → Firestore/GCS → Inventory → Context Package を再現するための実行手順です。  
この時点では **MVP デモ** であり、Cloud DLP / PDF 専用抽出 / Google Drive 連携は未導入です。  
現状のマスキング境界は **SimpleMasker + Gemini residual risk** です。

## 1. 前提条件

- Node.js 22 以上
- GCP project（課金/API 利用可能）
- ADC (Application Default Credentials) が利用可能
- Firestore (Native mode) を有効化済み
- GCS bucket を作成済み（`KNOWLEDGE_HUB_BUCKET`）

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
   ```

4. ADC を設定して認証確認

   ```bash
   gcloud config set project "$GOOGLE_CLOUD_PROJECT"
   gcloud auth application-default login
   gcloud auth application-default print-access-token >/dev/null
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

## 7. よくある失敗

- `KNOWLEDGE_HUB_BUCKET` 未設定
  - `.env.local` を確認
- ADC 未設定
  - `gcloud auth application-default login` を再実行
- Firestore が空
  - まず `/upload` から数件投入する
- GCS object missing
  - Firestore の `storagePath` / `aiSafeStoragePath` と bucket 内 object の整合を確認
  - 現状は該当文書のみ human review に回り、読めた文書は export 継続
- Vertex/Gemini auth failure
  - `GOOGLE_CLOUD_PROJECT` / IAM 権限 / ADC を再確認

## 8. Reset / cleanup（手動のみ）

- Firestore `documents` collection と `gs://$KNOWLEDGE_HUB_BUCKET/raw/`, `gs://$KNOWLEDGE_HUB_BUCKET/masked/` を手動で整理する
- 破壊的操作のため、本リポジトリでは **自動削除スクリプトは提供しない**
- 誤削除防止のため、対象 project / bucket を必ず二重確認してから実施する

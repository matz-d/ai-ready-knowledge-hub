# GCP Setup Notes (W1/W2)

このドキュメントは、W1-1 (`PLAN_w1.md` §2) で確定した Google Cloud 初期設定と、
W2 Walking Skeleton で追加した Firestore / Cloud Storage 設定の記録。
再セットアップ時はここを source of truth とする。

## Fixed Values

- `PROJECT_ID`: `ai-ready-knowledge-hub`
- `REGION`: `asia-northeast1`
- `VERTEX_API`: `aiplatform.googleapis.com` (enabled)
- `BILLING_ENABLED`: `true`

## Authentication Split (重要)

- CLI 操作用 (人間の操作): `gcloud auth login`
- ローカル開発で SDK / Genkit が使う認証: ADC
  - `gcloud auth application-default login`
  - `gcloud auth application-default set-quota-project ai-ready-knowledge-hub`

上記2つは別物として管理する。CLI がログイン済みでも ADC は未設定のことがある。

## One-Time Setup Commands

```bash
export PROJECT_ID="ai-ready-knowledge-hub"
export REGION="asia-northeast1"

gcloud config set project "$PROJECT_ID"
gcloud services enable aiplatform.googleapis.com --project="$PROJECT_ID"
gcloud auth application-default login
gcloud auth application-default set-quota-project "$PROJECT_ID"
```

## Firestore とアップロード用バケット (W2 Walking Skeleton)

Native Firestore と GCS バケットを `asia-northeast1` に用意する（初回のみ）。

```bash
export PROJECT_ID="ai-ready-knowledge-hub"
export REGION="asia-northeast1"
export KNOWLEDGE_HUB_BUCKET="${PROJECT_ID}-uploads"   # 例: 実際のバケット名に合わせる

gcloud firestore databases create --location="$REGION" --project="$PROJECT_ID" \
  || true   # 既存 DB がある場合はスキップエラーになり得る

gcloud storage buckets create "gs://${KNOWLEDGE_HUB_BUCKET}" --location="$REGION" --project="$PROJECT_ID" \
  || true
```

Next.js / Cloud Run の実行サービスアカウントに少なくとも次が必要:

- `roles/storage.objectAdmin`（バケット単位 IAM が望ましい）
- `roles/datastore.user`（Firestore）
- `roles/aiplatform.user`（Vertex / Curator）

実検証で使った Cloud Run runner 用サービスアカウント:

- `aiknh-runner@ai-ready-knowledge-hub.iam.gserviceaccount.com`
  - 既存: `roles/aiplatform.user`
  - 追加: `roles/datastore.user`
  - 追加: バケット単位 `roles/storage.objectAdmin`

ローカル開発では ADC (`gcloud auth application-default login`) と `.env.local` の
`KNOWLEDGE_HUB_BUCKET` を設定する。詳細は `.env.local.example`。

ローカルの Next.js dev / Route Handler で Firestore SDK が gRPC 経路のエラーになる場合、`.env.local` に `FIRESTORE_PREFER_REST=true` を設定して REST 経路を優先する。

## Verification Commands

```bash
# active project
gcloud config get-value project

# billing
gcloud billing projects describe ai-ready-knowledge-hub --format='value(billingEnabled)'

# Vertex AI API enabled
gcloud services list --enabled --project=ai-ready-knowledge-hub --format='value(config.name)' | rg aiplatform

# ADC token works
gcloud auth application-default print-access-token >/dev/null && echo "ADC_ACCESS_TOKEN_OK"

# quota project recorded in ADC file
rg '"quota_project_id": "ai-ready-knowledge-hub"' ~/.config/gcloud/application_default_credentials.json
```

## Notes

- 本リポジトリでは Vertex AI 利用時のリージョンは `asia-northeast1` 固定。
- `gemini-api` skill の一般推奨 `global` は、明示要件があるためこのプロジェクトでは採用しない。

# GCP Setup Notes (W1)

このドキュメントは、W1-1 (`PLAN_w1.md` §2) で確定した Google Cloud 初期設定の記録。
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

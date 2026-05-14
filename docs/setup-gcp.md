# GCP Setup Notes (W1/W2/Phase 3-D)

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

## Phase 3-D リソース（CI/CD + IAP）

### 追加済みリソース

| リソース | 名前 | 備考 |
|---|---|---|
| Artifact Registry repo | `knowledge-hub` (docker, asia-northeast1) | image push 先 |
| Deploy SA | `github-deployer@ai-ready-knowledge-hub.iam.gserviceaccount.com` | WIF impersonation 対象 |
| Runtime SA | `aiknh-runner@ai-ready-knowledge-hub.iam.gserviceaccount.com` | 既存流用 |
| WIF pool | `github-actions` | |
| WIF provider | `github` | issuer: token.actions.githubusercontent.com |
| Cloud Run service | `ai-ready-knowledge-hub` | Phase 3-D 本番。W1 `ai-ready-knowledge-hub-w1` とは別 |
| Project number | `127729019743` | WIF provider resource name と IAP_JWT_AUDIENCE に使用 |

### WIF provider attribute condition

```text
assertion.repository == "matz-d/ai-ready-knowledge-hub" && assertion.ref == "refs/heads/main"
```

### IAP_JWT_AUDIENCE

```text
/projects/127729019743/locations/asia-northeast1/services/ai-ready-knowledge-hub
```

### Cloud Run URL

```text
https://ai-ready-knowledge-hub-mrvutsz24a-an.a.run.app
```

IAP 保護済み。許可ユーザ `makoto@m-grow-ai.com` のみアクセス可。

### GitHub Variables（deploy.yml が参照）

| Variable | 値 |
|---|---|
| `GCP_PROJECT_ID` | `ai-ready-knowledge-hub` |
| `GCP_PROJECT_NUMBER` | `127729019743` |
| `GCP_REGION` | `asia-northeast1` |
| `CLOUD_RUN_SERVICE` | `ai-ready-knowledge-hub` |
| `ARTIFACT_REGISTRY_REPO` | `knowledge-hub` |
| `WIF_PROVIDER` | `projects/127729019743/locations/global/workloadIdentityPools/github-actions/providers/github` |
| `DEPLOY_SERVICE_ACCOUNT` | `github-deployer@ai-ready-knowledge-hub.iam.gserviceaccount.com` |
| `RUNTIME_SERVICE_ACCOUNT` | `aiknh-runner@ai-ready-knowledge-hub.iam.gserviceaccount.com` |
| `KNOWLEDGE_HUB_BUCKET` | `ai-ready-knowledge-hub-uploads` |
| `IAP_JWT_AUDIENCE` | `/projects/127729019743/locations/asia-northeast1/services/ai-ready-knowledge-hub` |

---

## Notes

- 本リポジトリでは Vertex AI 利用時のリージョンは `asia-northeast1` 固定。
- `gemini-api` skill の一般推奨 `global` は、明示要件があるためこのプロジェクトでは採用しない。

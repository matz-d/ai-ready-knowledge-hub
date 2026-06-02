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
| `CONTEXT_PACKAGE_TASKS_LOCATION` | （任意）未設定時は `GCP_REGION` と同値 |
| `CONTEXT_PACKAGE_TASKS_QUEUE` | 例: `context-package-jobs` |
| `CONTEXT_PACKAGE_WORKER_BASE_URL` | Cloud Run サービス URL（末尾スラッシュなし）。例: `https://ai-ready-knowledge-hub-mrvutsz24a-an.a.run.app` |
| `CONTEXT_PACKAGE_WORKER_SA_EMAIL` | worker 用 SA（OIDC 発行元）。例: `context-package-worker@ai-ready-knowledge-hub.iam.gserviceaccount.com` |
| `CONTEXT_PACKAGE_WORKER_OIDC_AUDIENCE` | **IAP programmatic access 用 OAuth 2.0 クライアント ID**（完全な `*.apps.googleusercontent.com` 形式）。Cloud Tasks → IAP 越し worker 呼び出し用 |
| `CONTEXT_PACKAGE_JOB_TOKEN_SECRET` | Secret Manager secret 名。例: `context-package-job-token` |
| `NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED` | `true` で UI が `mode:"auto"` を送る。**Docker build-arg で焼き込み**（下記 §Context Package 非同期） |

`deploy.yml` は Cloud Run へ **`--set-env-vars` で通常環境変数一式を毎回上書き**し、共有 token は Secret Manager から `--set-secrets` で参照する。Console で手動追加した env は次回 deploy で消えるため、追加が必要なら workflow の `ENV_VARS` 配列を正本として更新する。

---

## Context Package 非同期（Cloud Tasks + IAP worker）

`POST /api/context-package` の `async` / `auto` と Cloud Tasks worker（`POST /api/context-package/jobs/{jobId}/run`）用の配線手順。Cloud Run は **直接 IAP**（Phase 3-D）のまま、worker も同一サービス URL を叩く。

### 設計メモ: UI feature flag

- **採用**: Docker **build-arg** + builder 段の `NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED`（`Dockerfile` / `deploy.yml`）。
- **理由**: `NEXT_PUBLIC_*` は Next.js が build 時にクライアント bundle へ埋め込むため、Cloud Run の runtime env だけでは UI を切り替えられない。server runtime config（RSC prop / 小さな config API）も可能だが、現状は単一フラグのみで、CI の Docker build に載せる方が差分が小さい。
- **運用**: queue / worker env を配線したうえで GitHub Variable `NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED=true` を設定し、**再 deploy（image 再 build）** する。未配線で `true` にすると UI が `mode:"auto"` を送り **503 `job_queue_unavailable`** になる。

### 1. API 有効化

```bash
export PROJECT_ID="ai-ready-knowledge-hub"
export REGION="asia-northeast1"

gcloud services enable \
  cloudtasks.googleapis.com \
  secretmanager.googleapis.com \
  --project="$PROJECT_ID"
```

### 2. Cloud Tasks queue（retry duration > worker lease）

worker の Firestore lease は **15 分**（`CONTEXT_PACKAGE_JOB_LEASE_MS`）。queue の **`max-retry-duration` は lease より長く**（推奨 **30 分 = 1800s** 以上）し、lease 切れ後の再 claim を Cloud Tasks リトライで拾えるようにする。

```bash
export QUEUE_ID="context-package-jobs"

gcloud tasks queues create "$QUEUE_ID" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --max-attempts=10 \
  --min-backoff=30s \
  --max-backoff=600s \
  --max-retry-duration=1800s
```

既存 queue の更新例:

```bash
gcloud tasks queues update "$QUEUE_ID" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --max-retry-duration=1800s
```

### 3. Service accounts と IAM

| 主体 | 役割 | 付与する権限（例） |
|---|---|---|
| **Runtime SA** (`aiknh-runner@...`) | アプリ本体・enqueue | プロジェクトまたは queue 上で `roles/cloudtasks.enqueuer`、Worker SA 上で `roles/iam.serviceAccountUser`、共有 token secret 上で `roles/secretmanager.secretAccessor` |
| **Worker SA** (`context-package-worker@...` 等) | Cloud Tasks が OIDC を発行し IAP 越しに worker URL を呼ぶ | **`roles/iap.httpsResourceAccessor`**（IAP 保護 Cloud Run へのアクセス） |
| **Cloud Tasks service agent** (`service-$PROJECT_NUMBER@gcp-sa-cloudtasks.iam.gserviceaccount.com`) | 配信時の OIDC token 発行 | Worker SA 上で `roles/iam.serviceAccountUser` |

Worker SA の作成例:

```bash
export WORKER_SA="context-package-worker@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create context-package-worker \
  --project="$PROJECT_ID" \
  --display-name="Context Package Cloud Tasks worker"

gcloud iap web add-iam-policy-binding \
  --project="$PROJECT_ID" \
  --resource-type=cloud-run \
  --region="$REGION" \
  --service=ai-ready-knowledge-hub \
  --member="serviceAccount:${WORKER_SA}" \
  --role="roles/iap.httpsResourceAccessor"
```

Runtime SA に enqueue 権限:

```bash
export RUNTIME_SA="aiknh-runner@${PROJECT_ID}.iam.gserviceaccount.com"
export PROJECT_NUMBER="127729019743"
export CLOUD_TASKS_SERVICE_AGENT="service-${PROJECT_NUMBER}@gcp-sa-cloudtasks.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/cloudtasks.enqueuer"

# createTask の oidcToken.serviceAccountEmail に WORKER_SA を指定するために必要。
gcloud iam service-accounts add-iam-policy-binding "$WORKER_SA" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/iam.serviceAccountUser"

# Cloud Tasks が WORKER_SA の OIDC token を発行するために必要。
gcloud iam service-accounts add-iam-policy-binding "$WORKER_SA" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${CLOUD_TASKS_SERVICE_AGENT}" \
  --role="roles/iam.serviceAccountUser"
```

（最小権限にする場合は queue リソースに `cloudtasks.enqueuer` をバインドしてもよい。）

### 4. IAP programmatic access 用 OAuth client ID（OIDC audience）

Cloud Tasks の `oidcToken.audience` には **IAP programmatic access 用 OAuth 2.0 クライアント ID**（完全な `*.apps.googleusercontent.com` 形式）を渡す。未設定だと audience が target URL になり IAP で拒否される（`enqueuer.ts` コメント参照）。

対象 resource と同じ organization に属する既存 client を使うか、Google Auth Platform で OAuth client を作成する。その client ID を IAP settings の `programmatic_clients` allowlist に追加する。Google-managed OAuth client を使う IAP では programmatic access が既定で遮断されるため、この allowlist が必要。

```bash
export IAP_PROGRAMMATIC_CLIENT_ID="YOUR_CLIENT_ID.apps.googleusercontent.com"

cat > /tmp/iap-settings.yaml <<EOF
access_settings:
  oauth_settings:
    programmatic_clients:
      - "${IAP_PROGRAMMATIC_CLIENT_ID}"
EOF

gcloud iap settings set /tmp/iap-settings.yaml \
  --project="$PROJECT_ID" \
  --resource-type=iap_web
```

GitHub Variable `CONTEXT_PACKAGE_WORKER_OIDC_AUDIENCE` に **client ID 全体**を設定する。

`CONTEXT_PACKAGE_WORKER_BASE_URL` は Cloud Run の URL（`gcloud run services describe ai-ready-knowledge-hub --region="$REGION" --format='value(status.url)'`）。

### 5. 共有シークレット（Secret Manager）

```bash
export JOB_TOKEN_SECRET="context-package-job-token"

gcloud secrets create "$JOB_TOKEN_SECRET" \
  --project="$PROJECT_ID" \
  --replication-policy=automatic

openssl rand -base64 32 | \
  gcloud secrets versions add "$JOB_TOKEN_SECRET" \
    --project="$PROJECT_ID" \
    --data-file=-

gcloud secrets add-iam-policy-binding "$JOB_TOKEN_SECRET" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/secretmanager.secretAccessor"
```

GitHub Variable `CONTEXT_PACKAGE_JOB_TOKEN_SECRET` に secret 名を設定する。deploy は Cloud Run の `--set-secrets` で `CONTEXT_PACKAGE_JOB_TOKEN` env へ参照を設定し、enqueue 時に `X-Context-Package-Job-Token` ヘッダとして付与する。token 値自体は GitHub へ保存しない。

### 6. GitHub / deploy チェックリスト

1. 上記 queue・IAM・IAP programmatic OAuth client allowlist・Secret Manager secret を用意
2. GitHub Variables（表）を設定
3. 非同期 UI を有効にする場合のみ `NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED=true`
4. `main` へ merge または workflow_dispatch で deploy
5. IAP 経由で Context Package 画面から生成し、202 → ポーリング → 200 を確認

---

## Notes

- 本リポジトリでは Vertex AI 利用時のリージョンは `asia-northeast1` 固定。
- `gemini-api` skill の一般推奨 `global` は、明示要件があるためこのプロジェクトでは採用しない。

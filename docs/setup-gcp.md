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
| `GOOGLE_CLOUD_LOCATION` | `global`（Gemini 3.x inference 用。Cloud Run / GCS / Firestore の `GCP_REGION` とは分ける） |
| `IAP_JWT_AUDIENCE` | `/projects/127729019743/locations/asia-northeast1/services/ai-ready-knowledge-hub` |
| `CONTEXT_PACKAGE_TASKS_LOCATION` | （任意）未設定時は `GCP_REGION` と同値 |
| `CONTEXT_PACKAGE_TASKS_QUEUE` | 例: `context-package-jobs` |
| `CONTEXT_PACKAGE_WORKER_BASE_URL` | Cloud Run サービス URL（末尾スラッシュなし）。例: `https://ai-ready-knowledge-hub-mrvutsz24a-an.a.run.app` |
| `CONTEXT_PACKAGE_WORKER_SA_EMAIL` | worker 用 SA（OIDC 発行元）。例: `context-package-worker@ai-ready-knowledge-hub.iam.gserviceaccount.com` |
| `CONTEXT_PACKAGE_WORKER_OIDC_AUDIENCE` | **IAP programmatic access 用 OAuth 2.0 クライアント ID**（完全な `*.apps.googleusercontent.com` 形式）。Cloud Tasks → IAP 越し worker 呼び出し用 |
| `CONTEXT_PACKAGE_JOB_TOKEN_SECRET` | Secret Manager secret 名。例: `context-package-job-token` |
| `NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED` | `true` で UI が `mode:"auto"` を送る。**Docker build-arg で焼き込み**（下記 §Context Package 非同期） |

`deploy.yml` は Cloud Run へ **`--set-env-vars` で通常環境変数一式を毎回上書き**し、共有 token が設定されている場合は Secret Manager から `--set-secrets` で参照する。Console で手動追加した env は次回 deploy で消えるため、追加が必要なら workflow の `ENV_VARS` 配列を正本として更新する。Context Package 非同期用の GitHub Variables は `NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED=true` の deploy で必須になる。

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

### 2.1 Firestore TTL（terminal job retention）

`context_package_jobs` の terminal (`succeeded` / `failed` / `cancelled`) には
`expiresAt` が書かれ、既定で **14 日後**に削除される。Firestore 側で TTL を有効化する。

```bash
gcloud firestore fields ttls update expiresAt \
  --project="$PROJECT_ID" \
  --collection-group=context_package_jobs \
  --enable-ttl
```

確認:

```bash
gcloud firestore fields ttls list \
  --project="$PROJECT_ID" \
  --format='table(name,state)' |
  rg 'collectionGroups/context_package_jobs/fields/expiresAt'
```

### 2.2 stale-running recovery sweeper（Cloud Scheduler）

Cloud Tasks の retry 枯渇後に `running` が残留するケースを回収するため、
`POST /api/context-package/jobs/sweep` を定期実行する。回収条件は:

- status = `running`
- `leaseExpiresAt` が期限切れ
- `updatedAt` から queue `max-retry-duration`（既定 1800s）以上経過

作成例（15 分ごと）:

```bash
export SWEEP_JOB_ID="context-package-job-sweeper"
export BASE_URL="$(gcloud run services describe ai-ready-knowledge-hub --region="$REGION" --format='value(status.url)')"
export IAP_PROGRAMMATIC_CLIENT_ID="YOUR_CLIENT_ID.apps.googleusercontent.com"
export JOB_TOKEN_SECRET="context-package-job-token"
export WORKER_SA="context-package-worker@${PROJECT_ID}.iam.gserviceaccount.com"
export JOB_TOKEN="$(gcloud secrets versions access latest --project="$PROJECT_ID" --secret="$JOB_TOKEN_SECRET")"

gcloud scheduler jobs create http "$SWEEP_JOB_ID" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --schedule="*/15 * * * *" \
  --uri="${BASE_URL}/api/context-package/jobs/sweep" \
  --http-method=POST \
  --oidc-service-account-email="$WORKER_SA" \
  --oidc-token-audience="$IAP_PROGRAMMATIC_CLIENT_ID" \
  --headers="Content-Type=application/json,X-Context-Package-Job-Token=${JOB_TOKEN}" \
  --message-body='{"limit":200}'
```

> `X-Context-Package-Job-Token` は worker と同じ shared token。token rotation 後は
> Scheduler job も `gcloud scheduler jobs update http ... --headers=...` で更新する。
> sweeper route を含む revision が production に出る前に作成した場合は、HTTP 405 を
> 15 分ごとに出さないよう `gcloud scheduler jobs pause "$SWEEP_JOB_ID" ...` で止め、
> deploy 後に `gcloud scheduler jobs resume "$SWEEP_JOB_ID" ...` してから手動 run で確認する。

### 2.3 offload result object cleanup（GCS lifecycle）

`MAX_INLINE_RESULT_BYTES` 超過時の Context Package job result は
`gs://${KNOWLEDGE_HUB_BUCKET}/context-package/job-results/` 配下へ保存される。
job doc の Firestore TTL（14日）と揃えるため、同 prefix に lifecycle delete を設定する。

```bash
export KNOWLEDGE_HUB_BUCKET="ai-ready-knowledge-hub-uploads"

cat > /tmp/context-package-job-results-lifecycle.json <<'JSON'
{
  "rule": [
    {
      "action": { "type": "Delete" },
      "condition": {
        "age": 14,
        "matchesPrefix": ["context-package/job-results/"]
      }
    }
  ]
}
JSON

gcloud storage buckets update "gs://${KNOWLEDGE_HUB_BUCKET}" \
  --lifecycle-file=/tmp/context-package-job-results-lifecycle.json
```

確認:

```bash
gcloud storage buckets describe "gs://${KNOWLEDGE_HUB_BUCKET}" \
  --format='yaml(lifecycle_config.rule)'
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

openssl rand -base64 32 | tr -d '\n' | \
  gcloud secrets versions add "$JOB_TOKEN_SECRET" \
    --project="$PROJECT_ID" \
    --data-file=-

gcloud secrets add-iam-policy-binding "$JOB_TOKEN_SECRET" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/secretmanager.secretAccessor"
```

GitHub Variable `CONTEXT_PACKAGE_JOB_TOKEN_SECRET` に secret 名を設定する。deploy は Cloud Run の `--set-secrets` で `CONTEXT_PACKAGE_JOB_TOKEN` env へ参照を設定し、enqueue 時に `X-Context-Package-Job-Token` ヘッダとして付与する。token 値自体は GitHub へ保存しない。worker `/run` は production で token env 未設定なら **401 fail-closed** とする（dev / test のみ token 無し簡易実行を許可）。

### 6. GitHub / deploy チェックリスト

1. 上記 queue・IAM・IAP programmatic OAuth client allowlist・Secret Manager secret を用意
2. GitHub Variables（表）を設定
3. 非同期 UI を有効にする場合のみ `NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED=true`
4. `main` へ merge または workflow_dispatch で deploy
5. IAP 経由で Context Package 画面から生成し、202 → ポーリング → 200 を確認

### 7. GitHub Actions workflow lint

`.github/workflows/actionlint.yml` は workflow ファイルを変更する PR、`main` push、手動実行で `rhysd/actionlint:1.7.12` を起動する。image 同梱の `shellcheck` も有効になるため、GitHub Actions YAML と `run:` 内 shell の基本的な静的検査を merge 前に行える。

### 8. Context Package 非同期 production smoke

`main` deploy 後に Cloud Tasks worker を含む production 経路を確認する手順。
IAP audience 付き service-to-service token を発行するため、active `gcloud` user に
`roles/iam.serviceAccountTokenCreator` を **project-level で一時付与**する。検証後は
必ず削除する。通常運用でこの binding を残さない。

`purpose` は疎通確認だけの文言ではなく、fixture と意味的に一致する
`invoice billing masked only` を使う。これにより `202 → polling → result 200` に加え、
masked chunk 採用と raw PII 不在も同じ smoke で確認できる。

#### 8.1 Preflight（事故防止）

smoke の前に、deploy された revision と queue / Scheduler / Secret / feature flag の
整合を見る。ここで失敗した場合は production smoke を始めない。

```bash
set -euo pipefail

PROJECT_ID="ai-ready-knowledge-hub"
REGION="asia-northeast1"
SERVICE="ai-ready-knowledge-hub"
QUEUE_ID="context-package-jobs"
SWEEP_JOB_ID="context-package-job-sweeper"
REPO="matz-d/ai-ready-knowledge-hub"

gcloud config set project "$PROJECT_ID"

gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='table(status.latestReadyRevisionName,status.url,spec.template.spec.serviceAccountName)'

gcloud tasks queues describe "$QUEUE_ID" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --format='yaml(state,retryConfig.maxAttempts,retryConfig.maxRetryDuration)'

gcloud scheduler jobs describe "$SWEEP_JOB_ID" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --format='yaml(state,schedule,httpTarget.uri)'

gcloud secrets describe context-package-job-token \
  --project="$PROJECT_ID" \
  --format='value(name)' >/dev/null

gh variable get NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED --repo "$REPO"
gh variable get CONTEXT_PACKAGE_TASKS_QUEUE --repo "$REPO"
gh variable get CONTEXT_PACKAGE_WORKER_BASE_URL --repo "$REPO"
gh variable get CONTEXT_PACKAGE_WORKER_SA_EMAIL --repo "$REPO"
gh variable get CONTEXT_PACKAGE_WORKER_OIDC_AUDIENCE --repo "$REPO" >/dev/null

gcloud tasks list \
  --queue="$QUEUE_ID" \
  --location="$REGION" \
  --project="$PROJECT_ID" \
  --format='value(name)'
```

期待値:

- Cloud Run service account は `aiknh-runner@...`。
- queue は `RUNNING`、`maxRetryDuration` は **1800s 以上**。
- Scheduler は `ENABLED`、URI は `/api/context-package/jobs/sweep`。
- `NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED` は `true`。
- smoke 開始前の queue pending task は空、または既知の処理中 task のみ。

#### 8.2 Service-to-service smoke

```bash
set -euo pipefail

PROJECT_ID="ai-ready-knowledge-hub"
WORKER_SA="context-package-worker@${PROJECT_ID}.iam.gserviceaccount.com"
ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n 1)"
MEMBER="user:${ACTIVE_ACCOUNT}"
ROLE="roles/iam.serviceAccountTokenCreator"
BASE_URL="$(gh variable get CONTEXT_PACKAGE_WORKER_BASE_URL --repo matz-d/ai-ready-knowledge-hub)"
IAP_AUDIENCE="$(gh variable get CONTEXT_PACKAGE_WORKER_OIDC_AUDIENCE --repo matz-d/ai-ready-knowledge-hub)"
DOC_ID="a74b9520-5442-4579-adb8-2781dae8999b"

BODY_FILE="$(mktemp)"
STATUS_FILE="$(mktemp)"
TOKEN_FILE="$(mktemp)"
ADDED_BINDING=0

cleanup() {
  rm -f "${BODY_FILE}" "${STATUS_FILE}" "${TOKEN_FILE}"
  if [[ "${ADDED_BINDING}" == "1" ]]; then
    gcloud projects remove-iam-policy-binding "${PROJECT_ID}" \
      --member="${MEMBER}" \
      --role="${ROLE}" \
      --quiet >/dev/null
  fi
}
trap cleanup EXIT

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="${MEMBER}" \
  --role="${ROLE}" \
  --quiet >/dev/null
ADDED_BINDING=1

# IAM 反映には時間差があるため、token 発行を retry する。token 値は表示しない。
TOKEN_READY=0
for attempt in $(seq 1 24); do
  if gcloud auth print-identity-token \
      --impersonate-service-account="${WORKER_SA}" \
      --audiences="${IAP_AUDIENCE}" \
      --include-email >"${TOKEN_FILE}" 2>/dev/null; then
    TOKEN_READY=1
    break
  fi
  sleep 5
done
[[ "${TOKEN_READY}" == "1" ]]
TOKEN="$(tr -d '\n' < "${TOKEN_FILE}")"

HTTP_CODE="$(
  curl --silent --show-error --location \
    --output "${BODY_FILE}" \
    --write-out '%{http_code}' \
    --request POST "${BASE_URL}/api/context-package" \
    --header "Authorization: Bearer ${TOKEN}" \
    --header 'Content-Type: application/json' \
    --data "{\"purpose\":\"invoice billing masked only\",\"docIds\":[\"${DOC_ID}\"],\"limit\":2,\"mode\":\"async\"}"
)"
[[ "${HTTP_CODE}" == "202" ]]

STATUS_URL="$(jq -r '.statusUrl' "${BODY_FILE}")"
RESULT_URL="$(jq -r '.resultUrl' "${BODY_FILE}")"

for attempt in $(seq 1 60); do
  sleep 3
  curl --silent --show-error --location \
    --output "${STATUS_FILE}" \
    --header "Authorization: Bearer ${TOKEN}" \
    "${BASE_URL}${STATUS_URL}"
  STATUS="$(jq -r '.status' "${STATUS_FILE}")"
  case "${STATUS}" in
    succeeded) break ;;
    failed|cancelled)
      jq -c . "${STATUS_FILE}"
      exit 1
      ;;
  esac
done
[[ "${STATUS}" == "succeeded" ]]

RESULT_CODE="$(
  curl --silent --show-error --location \
    --output "${BODY_FILE}" \
    --write-out '%{http_code}' \
    --header "Authorization: Bearer ${TOKEN}" \
    "${BASE_URL}${RESULT_URL}"
)"
[[ "${RESULT_CODE}" == "200" ]]

MARKDOWN="$(jq -r '.markdown // ""' "${BODY_FILE}")"
! rg -q 'SYN-INV-2026-0501' <<<"${MARKDOWN}"
rg -q '\[REDACTED:' <<<"${MARKDOWN}"
rg -q 'Confidential \(AI-safe via masking\)' <<<"${MARKDOWN}"
```

#### 8.3 Post-smoke cleanup / health check

`trap` cleanup 後、binding と queue が空であることを確認する。

```bash
gcloud projects get-iam-policy ai-ready-knowledge-hub --format=json |
  jq '{bindings: [.bindings[]? | select(.role == "roles/iam.serviceAccountTokenCreator")]}'

gcloud iam service-accounts get-iam-policy \
  context-package-worker@ai-ready-knowledge-hub.iam.gserviceaccount.com \
  --project=ai-ready-knowledge-hub \
  --format=json |
  jq '{bindings: [.bindings[]? | select(.role == "roles/iam.serviceAccountTokenCreator")]}'

gcloud tasks list \
  --queue=context-package-jobs \
  --location=asia-northeast1 \
  --project=ai-ready-knowledge-hub \
  --format='value(name)'
```

期待値:

- project / Worker SA の Token Creator `bindings` は空。
- queue pending task は空。
- production の `CONTEXT_PACKAGE_JOB_TOKEN` は Secret Manager 参照のまま。smoke で値を読み出し・変更しない。

直近の worker / sweeper / enqueue ログも確認する。

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   resource.labels.service_name="ai-ready-knowledge-hub"
   ("[context-package-job]" OR "[context-package] enqueue" OR "job_queue_unavailable")' \
  --project=ai-ready-knowledge-hub \
  --freshness=2h \
  --limit=50 \
  --format='table(timestamp,severity,textPayload,jsonPayload.message)'
```

#### 8.4 Monitoring / alert

S10 の最低限の監視は次の3本。通知先 channel は Console で作るか、
`gcloud alpha monitoring channels create` で作成し、以下の
`NOTIFICATION_CHANNEL` に `projects/.../notificationChannels/...` を入れる。

1. **Cloud Run job 系エラー**: worker crash / enqueue failure / sweeper failure。
2. **stale recovery 発生**: sweeper が `recovered > 0` を返したら調査対象。
3. **Cloud Tasks backlog**: queue depth が 30 分残る場合は worker / IAP / token / Vertex を確認。

まず log-based metrics を作る。

```bash
PROJECT_ID="ai-ready-knowledge-hub"
SERVICE="ai-ready-knowledge-hub"

gcloud logging metrics create context_package_job_errors \
  --project="$PROJECT_ID" \
  --description="Context Package async worker/enqueue/sweeper errors" \
  --log-filter='resource.type="cloud_run_revision"
resource.labels.service_name="ai-ready-knowledge-hub"
severity>=ERROR
("[context-package-job]" OR "[context-package] enqueue failed" OR "job_queue_unavailable")'

gcloud logging metrics create context_package_stale_recoveries \
  --project="$PROJECT_ID" \
  --description="Stale running Context Package jobs recovered by sweeper" \
  --log-filter='resource.type="cloud_run_revision"
resource.labels.service_name="ai-ready-knowledge-hub"
"[context-package-job] sweeper completed"
textPayload=~"recovered: [1-9]"'
```

次に alert policy を作る。`NOTIFICATION_CHANNEL` が未準備なら
`notificationChannels` 行を削って作成し、後で Console から通知先を追加してよい。

```bash
PROJECT_ID="ai-ready-knowledge-hub"
QUEUE_ID="context-package-jobs"
REGION="asia-northeast1"
NOTIFICATION_CHANNEL="projects/${PROJECT_ID}/notificationChannels/REPLACE_ME"

cat > /tmp/context-package-job-errors-policy.json <<JSON
{
  "displayName": "Context Package async job errors",
  "combiner": "OR",
  "enabled": true,
  "notificationChannels": ["${NOTIFICATION_CHANNEL}"],
  "conditions": [
    {
      "displayName": "job/enqueue/sweeper error log count > 0",
      "conditionThreshold": {
        "filter": "metric.type=\"logging.googleapis.com/user/context_package_job_errors\" AND resource.type=\"cloud_run_revision\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0,
        "duration": "300s",
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_SUM",
            "crossSeriesReducer": "REDUCE_SUM"
          }
        ],
        "trigger": { "count": 1 }
      }
    }
  ],
  "alertStrategy": { "autoClose": "1800s" }
}
JSON

cat > /tmp/context-package-stale-recovery-policy.json <<JSON
{
  "displayName": "Context Package stale running jobs recovered",
  "combiner": "OR",
  "enabled": true,
  "notificationChannels": ["${NOTIFICATION_CHANNEL}"],
  "conditions": [
    {
      "displayName": "sweeper recovered at least one stale job",
      "conditionThreshold": {
        "filter": "metric.type=\"logging.googleapis.com/user/context_package_stale_recoveries\" AND resource.type=\"cloud_run_revision\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0,
        "duration": "300s",
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_SUM",
            "crossSeriesReducer": "REDUCE_SUM"
          }
        ],
        "trigger": { "count": 1 }
      }
    }
  ],
  "alertStrategy": { "autoClose": "1800s" }
}
JSON

cat > /tmp/context-package-queue-backlog-policy.json <<JSON
{
  "displayName": "Context Package Cloud Tasks backlog",
  "combiner": "OR",
  "enabled": true,
  "notificationChannels": ["${NOTIFICATION_CHANNEL}"],
  "conditions": [
    {
      "displayName": "queue depth remains above zero for 30 minutes",
      "conditionThreshold": {
        "filter": "metric.type=\"cloudtasks.googleapis.com/queue/depth\" AND resource.type=\"cloud_tasks_queue\" AND resource.labels.project_id=\"${PROJECT_ID}\" AND resource.labels.location=\"${REGION}\" AND resource.labels.queue_id=\"${QUEUE_ID}\"",
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0,
        "duration": "1800s",
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_MEAN"
          }
        ],
        "trigger": { "count": 1 }
      }
    }
  ],
  "alertStrategy": { "autoClose": "3600s" }
}
JSON

gcloud alpha monitoring policies create \
  --project="$PROJECT_ID" \
  --policy-from-file=/tmp/context-package-job-errors-policy.json

gcloud alpha monitoring policies create \
  --project="$PROJECT_ID" \
  --policy-from-file=/tmp/context-package-stale-recovery-policy.json

gcloud alpha monitoring policies create \
  --project="$PROJECT_ID" \
  --policy-from-file=/tmp/context-package-queue-backlog-policy.json
```

作成後の確認:

```bash
gcloud alpha monitoring policies list \
  --project=ai-ready-knowledge-hub \
  --filter='displayName:"Context Package"' \
  --format='table(name,displayName,enabled,notificationChannels)'
```

**Notification channel（2026-06-08 設定）**

email notification channel を作成し、上記 alert policy 3本に紐付け済み（channel configured / policies attached）。初期 ops alert 先は個人メール（将来 Google Group / ops alias へ差し替え予定）。docs にはメールアドレスを記載しない。

| 項目 | 値 |
|---|---|
| resource name | `projects/ai-ready-knowledge-hub/notificationChannels/10853988392687424315` |
| displayName | `AI Ready Knowledge Hub ops alerts` |
| type | `email` |
| enabled | `true` |
| verificationStatus | API 出力なし（`gcloud describe` で `UNVERIFIED` は出ない） |
| delivery test | 2026-06-08 confirmed by synthetic `context_package_job_errors` alert. Test run `alert-email-delivery-sustained-20260608T081523Z` opened alert `projects/ai-ready-knowledge-hub/alerts/0.o8szm1c7od96` at `2026-06-08T08:24:21Z`; notification email received at 17:24 JST |
| userLabels | `app=ai_ready_knowledge_hub`, `scope=context_package` |

紐付け済み alert policy:

| displayName | resource name |
|---|---|
| Context Package async job errors | `projects/ai-ready-knowledge-hub/alertPolicies/17352164707903499112` |
| Context Package stale running jobs recovered | `projects/ai-ready-knowledge-hub/alertPolicies/17352164707903497386` |
| Context Package Cloud Tasks backlog | `projects/ai-ready-knowledge-hub/alertPolicies/16564441262000196314` |

channel 未作成の場合は次で作成し、既存 policy には `--add-notification-channels` で追加する（duplicate policy を作らない）。

```bash
PROJECT_ID="ai-ready-knowledge-hub"
ALERT_EMAIL="USER_PROVIDED_EMAIL"
NOTIFICATION_CHANNEL="projects/${PROJECT_ID}/notificationChannels/REPLACE_AFTER_CREATE"

gcloud alpha monitoring channels create \
  --project="$PROJECT_ID" \
  --display-name="AI Ready Knowledge Hub ops alerts" \
  --description="Primary notification channel for Context Package production alerts" \
  --type=email \
  --channel-labels=email_address="$ALERT_EMAIL" \
  --user-labels=app=ai_ready_knowledge_hub,scope=context_package

# 既存 policy へ追加（例）
JOB_ERRORS_POLICY=$(gcloud alpha monitoring policies list \
  --project="$PROJECT_ID" \
  --filter='displayName="Context Package async job errors"' \
  --format='value(name)')

gcloud alpha monitoring policies update "$JOB_ERRORS_POLICY" \
  --project="$PROJECT_ID" \
  --add-notification-channels="$NOTIFICATION_CHANNEL"
```

確認:

```bash
NOTIFICATION_CHANNEL="projects/ai-ready-knowledge-hub/notificationChannels/10853988392687424315"

gcloud alpha monitoring channels describe "$NOTIFICATION_CHANNEL" \
  --project=ai-ready-knowledge-hub \
  --format='yaml(name,displayName,type,enabled,verificationStatus)'

gcloud alpha monitoring policies list \
  --project=ai-ready-knowledge-hub \
  --filter='displayName:"Context Package"' \
  --format='table(name,displayName,enabled,notificationChannels)'
```

Delivery test evidence（2026-06-08）:

```bash
# Synthetic test log path; does not indicate a real production job failure.
gcloud logging read \
  'resource.type="cloud_run_revision" resource.labels.service_name="ai-ready-knowledge-hub" "alert-email-delivery-sustained-20260608T081523Z"' \
  --project=ai-ready-knowledge-hub \
  --format='table(timestamp,severity,textPayload)'

gcloud alpha monitoring alerts describe \
  projects/ai-ready-knowledge-hub/alerts/0.o8szm1c7od96 \
  --project=ai-ready-knowledge-hub \
  --format='yaml(name,state,openTime,policy,metric,resource)'
```

#### 8.5 Incident triage

| 症状 | 最初に見るもの | 典型原因 |
|---|---|---|
| UI が 503 `job_queue_unavailable` | GitHub Variables / Cloud Run env / deploy revision | `NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED=true` なのに queue env 未配線 |
| job が `queued` のまま | Cloud Tasks queue depth / task dispatch logs | queue paused、Runtime SA の `cloudtasks.enqueuer` 不足 |
| worker `/run` が 401/403 | Cloud Run logs / IAP settings / token secret | IAP programmatic client allowlist 漏れ、Worker SA の IAP accessor 不足、shared token mismatch |
| `running` が残る | `leaseExpiresAt`、Cloud Tasks retry window、sweeper logs | worker crash 後の retry 枯渇。sweeper で `failed` 回収されること |
| result route が 500 | `resultRef.objectPath` と GCS object / Runtime SA storage IAM | GCS offload object missing、bucket IAM 不足 |
| queue backlog alert | Cloud Tasks queue + Cloud Run revision logs | Vertex latency、IAP/token failure、worker 5xx retry loop |

---

## Notes

- Cloud Run / Artifact Registry / GCS / Firestore の主リージョンは引き続き `asia-northeast1`。
- Gemini 3.x のハッカソン本線は `GOOGLE_CLOUD_LOCATION=global` を使う。2026-06-03 時点で、このプロジェクトでは `global` のみ `gemini-3.5-flash` / `gemini-3.1-flash-lite` が疎通済み。
- AuditEvent の `dataResidency` は `KNOWLEDGE_HUB_DATA_RESIDENCY_LOCATION`（未指定時 `asia-northeast1`）で記録する。

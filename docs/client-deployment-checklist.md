# クライアント環境デプロイチェックリスト

各クライアント環境へ **同一 Docker イメージ** を配布し、**runtime の env / Secret Manager** でクライアント固有値を注入する per-client シングルテナント構成向けの初回デプロイ・リリース前確認リスト。

詳細手順の正本は [setup-gcp.md](./setup-gcp.md)。本書は配布・運用の抜け漏れ防止用チェックリスト。

## 前提

- 1 デプロイ = 1 クライアント組織（物理分離が越境防止の主軸）
- Docker イメージに **secret・クライアント固有 project ID・bucket 名・service account key を焼き込まない**
- イメージに含まれるのはアプリ本体・`sample-data/`（合成データのみ）・非機密 build-arg のみ
- 本番マスキングは **Cloud DLP**（`MASKER_PROVIDER=cloud-dlp`）

---

## 1. GCP 基盤（初回のみ）

- [ ] 専用 GCP プロジェクトを作成し、請求を有効化
- [ ] リージョン方針を決定
  - Cloud Run / Firestore / GCS: 例 `asia-northeast1`
  - Gemini inference: `GOOGLE_CLOUD_LOCATION=global`（Gemini 3.x 前提）
- [ ] 必要 API を有効化
  - `aiplatform.googleapis.com`（Vertex / Gemini）
  - `dlp.googleapis.com`（Cloud DLP / Masker）
  - `firestore.googleapis.com`
  - `run.googleapis.com`
  - `artifactregistry.googleapis.com`
  - `cloudtasks.googleapis.com`（Context Package / table-assist 非同期を使う場合）
  - `secretmanager.googleapis.com`
  - `iap.googleapis.com`（IAP 保護デプロイの場合）
- [ ] Firestore Native DB を作成（`asia-northeast1` 等）
- [ ] GCS バケットを作成（アップロード用、`KNOWLEDGE_HUB_BUCKET`）
- [ ] Artifact Registry リポジトリを作成（Docker イメージ格納）

---

## 2. サービスアカウントと IAM

### Runtime SA（Cloud Run 実行用）

少なくとも以下を付与（バケットはバケット単位 IAM が望ましい）:

- [ ] `roles/datastore.user`（Firestore）
- [ ] `roles/storage.objectAdmin`（対象バケット）
- [ ] `roles/aiplatform.user`（Vertex / Curator / Gemini）
- [ ] `roles/dlp.user`（`MASKER_PROVIDER=cloud-dlp` 時）
- [ ] `roles/secretmanager.secretAccessor`（Secret Manager 参照 secret 用）

### Deploy SA（CI / 手動デプロイ用）

- [ ] Artifact Registry への push 権限
- [ ] Cloud Run deploy 権限
- [ ] Secret Manager 参照（deploy 時に `--set-secrets` で紐付ける場合）

### Worker SA（Cloud Tasks → IAP worker 用、非同期を使う場合）

- [ ] Cloud Tasks enqueue 用 SA に `roles/cloudtasks.enqueuer`
- [ ] Worker SA に IAP 経由で Cloud Run を叩く権限（`roles/run.invoker` 等、構成に応じて）
- [ ] IAP programmatic access 用 OAuth client ID を allowlist に追加（[setup-gcp.md §Context Package 非同期](./setup-gcp.md) 参照）

---

## 3. Secret Manager（イメージに焼き込まない値）

以下は **Secret Manager** に格納し、Cloud Run `--set-secrets` で runtime 注入する:

| Secret 名（例） | 環境変数 | 用途 |
|---|---|---|
| `context-package-job-token` | `CONTEXT_PACKAGE_JOB_TOKEN` | 非同期 worker 共有トークン |
| `pdf-table-assist-worker-token` | `PDF_TABLE_ASSIST_WORKER_TOKEN` | table-assist worker トークン（任意・専用化時） |
| `pdf-table-assist-task-signing-secret` | `PDF_TABLE_ASSIST_TASK_SIGNING_SECRET` | Cloud Tasks payload HMAC 署名鍵 |

- [ ] 各 secret を作成し、ランダムな十分長の値を格納（CSPRNG）
- [ ] service account key JSON を **リポジトリ・イメージに含めない**（Workload Identity / ADC を使用）
- [ ] Secret のローテーション手順を運用メモに残す

---

## 4. Runtime 環境変数（クライアント固有・非 secret）

Cloud Run `--set-env-vars` で注入。Console 手動追加は次回 deploy で上書きされるため、**deploy workflow または手順書を正本**とする。

### 必須

| 変数 | 説明 |
|---|---|
| `AUTH_MODE` | 本番 IAP 保護: `iap` |
| `GOOGLE_CLOUD_PROJECT` | クライアント GCP プロジェクト ID |
| `GOOGLE_CLOUD_LOCATION` | `global`（Gemini 3.x） |
| `KNOWLEDGE_HUB_BUCKET` | アップロード用 GCS バケット名 |
| `IAP_JWT_AUDIENCE` | IAP OAuth client / service audience |
| `MASKER_PROVIDER` | **`cloud-dlp`**（本番必須） |
| `FIRESTORE_PREFER_REST` | `false`（本番正本） |

### 推奨

| 変数 | 説明 |
|---|---|
| `KNOWLEDGE_HUB_TENANT_ID` | テナント ID をメールドメインではなく固定ピンする場合 |
| `KNOWLEDGE_HUB_DATA_RESIDENCY_LOCATION` | 監査メタデータ用（例 `asia-northeast1`） |

### 非同期（Context Package / table-assist を使う場合）

- [ ] `CONTEXT_PACKAGE_TASKS_QUEUE` / `CONTEXT_PACKAGE_WORKER_BASE_URL` / worker SA / OIDC audience
- [ ] `PDF_TABLE_ASSIST_*`（専用 queue を分ける場合）
- [ ] Docker **build-arg** `NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED=true`（UI から async を送る場合のみ。runtime では切り替え不可）

テンプレート: [.env.local.example](../.env.local.example)

---

## 5. Docker イメージ配布

- [ ] ビルド時に secret / `.env*` / credential を COPY していない（`.dockerignore` 確認）
- [ ] build-arg は非機密のみ（例: `NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED`）
- [ ] 同一イメージを複数クライアントへ配布可能（固有値は runtime 注入のみ）
- [ ] イメージタグに secret や顧客名の機密を含めない

---

## 6. IAP / アクセス制御

- [ ] Cloud Run を `--no-allow-unauthenticated` でデプロイ（本番）
- [ ] IAP を有効化し、許可ユーザ / グループを設定
- [ ] `IAP_JWT_AUDIENCE` がデプロイ先サービスと一致
- [ ] エッジで `x-knowledge-hub-*` 転送ヘッダをクライアントから受け付けない（アプリ middleware でも剥がすが、リバースプロキシ側でも剥離推奨）

---

## 7. リリース前ゲート（品質・マスキング）

### CI（committed fixture）

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm eval:p1d:quality --ci
```

- [ ] 上記が green

### クライアント環境 / staging（live DLP）

ADC または runtime SA で Cloud DLP に到達できる状態で:

```bash
pnpm eval:p1d:masker-drift -- --out tmp/p1d-masker-drift-report.json
```

- [ ] `piiLeakCount === 0`（under-mask が無いこと）
- [ ] デプロイ後 Cloud Run の env で `MASKER_PROVIDER=cloud-dlp` を確認

```bash
gcloud run services describe <SERVICE> --region=<REGION> --format='yaml(spec.template.spec.containers[0].env)'
```

---

## 8. 初回デプロイ後スモーク

- [ ] IAP 経由でログインし、トップページが 200
- [ ] 合成サンプルまたはテスト用文書を 1 件アップロード
- [ ] マスキング後の inventory に `masker.provider: cloud-dlp` が記録される
- [ ] Context Package 生成（同期または非同期）が完了する
- [ ] excluded / restricted 文書が export bundle に本文混入しない
- [ ] 監査ログ（auditEvents）に actor email が IAP ユーザと一致する

---

## 9. やってはいけないこと

- 実顧客データ・生 PII・credential を git / イメージ / `sample-data/` に含める
- 本番で `MASKER_PROVIDER=simple-rule` のまま提供する（**公開デモ環境のみ** `simple-rule` 可。デモは `deploy-demo.yml` で専用 GCP プロジェクト必須）
- service account key をイメージや git に commit する
- クライアント A の secret / project 設定をクライアント B のデプロイに流用する
- 公開デモ deploy で本番 `GCP_PROJECT_ID` / `KNOWLEDGE_HUB_BUCKET` を流用する（`deploy-demo.yml` が拒否）

---

## 関連ドキュメント

- [setup-gcp.md](./setup-gcp.md) — WIF、IAP、Cloud Tasks、Secret Manager の詳細
- [security-review-prompts.md](./security-review-prompts.md) — 観点別セキュリティレビュー結果
- [p1-d-extraction-masking-quality-gate.md](./p1-d-extraction-masking-quality-gate.md) — eval ゲートの説明
- [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) — 本番 deploy の env / secret 正本

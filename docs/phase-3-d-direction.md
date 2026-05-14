# Phase 3-D 方向性メモ: CI/CD + IAP + AuditEvent

> 作成: 2026-05-14  
> 背景: Phase 3-C で Purpose → Strategist → Context Package のアプリ一巡が完了した。Phase 3-D は採点軸「まわす」「とどける」の evidence を作るため、Cloud Run への継続デプロイ、Cloud IAP による社内限定公開、最小監査ログを整備する。

---

## 1. ゴール

`main` への commit push で GitHub Actions が走り、`pnpm test` / `pnpm typecheck` / `pnpm build` を通した Docker image が Artifact Registry に push され、Cloud Run の新 revision として自動反映される。公開面は Cloud IAP で保護し、IAP identity を tenantId と監査ログの起点にする。

**Phase 3-D の一行定義:**

> commit push → 自動 test → 自動 build → Cloud Run 反映を作り、Cloud IAP で許可ユーザだけが触れる状態にする。

---

## 2. 決定済み事項

| 論点 | 決定 |
|---|---|
| Q1: GitHub Actions の GCP 認証 | Workload Identity Federation（WIF）。Service Account JSON key は使わない。 |
| Q2: tenantId の発生源 | IAP authenticated email の domain 部分。`KNOWLEDGE_HUB_TENANT_ID` があれば env override。actor は email 全体。 |
| Q3: Cloud Run public access | Cloud IAP 必須。発表時も `allow-unauthenticated` は使わない。 |
| Q4: AuditEvent 範囲 | `document.import` / `document.reimport` / `document.export`。実装順は import → reimport → export。 |
| Q5: Dockerfile build mode | `output: 'standalone'` + multi-stage Dockerfile。 |

補足: W1/W2 の初期デプロイでは「Buildpacks に任せる」方針だった。Phase 3-D では Dockerfile + Artifact Registry を正とし、`docs/tech-stack.md` もこの方針へ更新済み。

---

## 3. スコープ

### やること

| 優先 | 項目 | 内容 |
|---|---|---|
| 1 | Dockerfile + local image smoke | Next.js standalone を multi-stage image 化し、`docker build` と `docker run` で起動確認する。 |
| 2 | GitHub Actions CI/CD | `pnpm install --frozen-lockfile`、`pnpm test`、`pnpm typecheck`、`pnpm build`、Docker build/push、Cloud Run deploy。 |
| 3 | GCP CI/CD resources | Artifact Registry repo、GitHub OIDC 用 WIF pool/provider、deploy service account、Cloud Run runtime service account。 |
| 4 | Cloud IAP | Cloud Run を IAP 必須にし、許可 Google Workspace ユーザ/グループだけ通す。 |
| 5 | tenantId middleware hardening | IAP header から tenantId/actor を解決し、可能なら `x-goog-iap-jwt-assertion` 検証を追加する。 |
| 6 | AuditEvent collection | import/reimport/export の最小監査ログを `auditEvents/{eventId}` に append-only で記録する。 |
| 7 | Monitoring evidence | Cloud Run revision、Actions green、Artifact Registry image、IAP 設定、監査ログの screenshot を残す。 |

### やらないこと

- BYOC / Terraform / マルチリージョン
- microservices 分割
- Cloud DLP 本格 polish
- Cloud Armor / rate limit の本格実装
- tenant master 管理画面
- AuditEvent の全 action 配線

---

## 4. 既存コードとの接続点

Phase 3-D はビジネスロジックを触らない。触るのは deployment / auth / audit の境界だけ。

| 既存ファイル | 役割 | Phase 3-D の扱い |
|---|---|---|
| `next.config.ts` | `output: 'standalone'` 設定済み | Dockerfile で `.next/standalone` を使う。 |
| `package.json` | `pnpm build`, `typecheck`, `test`, `start` 定義済み | workflow の正本コマンドとして使う。`npm` は使わない。 |
| `src/middleware.ts` | auth context を request headers に注入 | `AUTH_MODE=iap` で IAP 必須。IAP JWT 検証追加候補。 |
| `src/lib/auth/resolveTenantIdFromAuth.ts` | IAP email → tenantId/actor 解決 | Q2 の正本。将来 tenant lookup もここに閉じ込める。 |
| `src/lib/audit/auditEvent.ts` | AuditEvent 型・actor 抽出・`.create()` 書き込み | 対象 route から呼ぶ。 |
| `src/app/api/documents/route.ts` | upload/import 相当の入口 | `document.import` を最初に配線する。 |
| `src/app/api/import/google-sheets/route.ts` | Sheets / Docs reimport 入口 | `document.reimport` を配線する。 |
| `src/app/api/context-package/route.ts` | Context Package export 入口 | `document.export` を配線する。 |

---

## 5. GCP リソース設計

### 固定値・命名

`PROJECT_ID` / `REGION` / runtime service account は [docs/setup-gcp.md](setup-gcp.md) の Fixed Values が正本。ここでは Phase 3-D で追加・参照する命名のみ明記する。

| 項目 | 値 | 備考 |
|---|---|---|
| Project ID | `ai-ready-knowledge-hub` | setup-gcp.md と同期。変更時は両方を更新する。 |
| Region | `asia-northeast1` | setup-gcp.md と同期。 |
| Cloud Run service (Phase 3-D 本番) | `ai-ready-knowledge-hub` | **新規作成**。W1 検証用の `ai-ready-knowledge-hub-w1` は隔離 service として残し、Phase 3-D の deploy 対象にはしない。混同しないよう deploy workflow では service 名を変数化せず固定する。 |
| Artifact Registry repo | `knowledge-hub` | Phase 3-D で新規作成。 |
| Docker image | `asia-northeast1-docker.pkg.dev/$PROJECT_ID/knowledge-hub/ai-ready-knowledge-hub` | |
| Deploy service account | `github-deployer@$PROJECT_ID.iam.gserviceaccount.com` | Phase 3-D で新規作成。 |
| Runtime service account | `aiknh-runner@ai-ready-knowledge-hub.iam.gserviceaccount.com` | setup-gcp.md にある既存 Cloud Run runner を流用する。`knowledge-hub-runner@` などを新規作成しない。 |
| IAP service agent | `service-$PROJECT_NUMBER@gcp-sa-iap.iam.gserviceaccount.com` | IAP を最初に有効化した時点で GCP が自動作成する。`roles/run.invoker` を付与する対象。 |
| WIF pool | `github-actions` | Phase 3-D で新規作成。 |
| WIF provider | `github` | Phase 3-D で新規作成。 |
| GitHub repo | 実 repo 名と一致する値を設定する（着手時に `gh repo view` で確認） | WIF attribute condition `assertion.repository` に埋め込む。typo すると WIF auth が刺さるので変数化せず実値を直書きする。 |
| GitHub Variables `GCP_PROJECT_NUMBER` | Step 2 で `gcloud projects describe $PROJECT_ID --format='value(projectNumber)'` を実行して実値を取得し、GitHub repo variables に設定する。 | プレースホルダー `123456789012` のまま push しない。 |

### Artifact Registry

作成する repository は Docker 用、region は `asia-northeast1`。

```bash
gcloud artifacts repositories create knowledge-hub \
  --repository-format=docker \
  --location=asia-northeast1 \
  --description="AI-Ready Knowledge Hub images"
```

### Service accounts

deploy service account は GitHub Actions が impersonate する。runtime service account は Cloud Run revision が GCS / Firestore / Vertex AI / DLP / Drive にアクセスする。

deploy service account に必要な最小権限:

| Role | Scope | 理由 |
|---|---|---|
| `roles/artifactregistry.writer` | Artifact Registry repo or project | image push |
| `roles/run.admin` | project | Cloud Run deploy |
| `roles/iam.serviceAccountUser` | runtime service account | Cloud Run revision に runtime SA を指定 |

runtime service account に必要な権限は `docs/setup-gcp.md` の Cloud Run runner 用権限を正とする。少なくとも Firestore / GCS / Vertex AI / DLP / Drive read の既存動作を壊さない。

### Workload Identity Federation

GitHub OIDC issuer は `https://token.actions.githubusercontent.com`。attribute condition は repo と branch を固定する。

最小条件:

```text
assertion.repository == "matz-d/ai-ready-knowledge-hub" &&
assertion.ref == "refs/heads/main"
```

必要に応じて `assertion.workflow` も固定してよい。ただし workflow rename で壊れやすくなるため、Phase 3-D の最初は repo + branch 固定を優先する。

GitHub Actions 側では `google-github-actions/auth` を使い、`workload_identity_provider` と `service_account` を指定する。Secrets に JSON key は置かない。

### Cloud Run + IAP

**構成の決め打ち**: Cloud Run **直接 IAP**（IAP for Cloud Run）を採用する。External HTTPS Load Balancer 経由の IAP は採用しない。理由は Phase 3-D ハッカソンスコープでは LB を挟む価値（カスタムドメイン、Cloud Armor 統合）が無く、構成と audience 検証を最小化したいため。Year 2 以降にカスタムドメインが必要になったら LB 経由に切り替えるが、その時に audience 形式の変更（§8 参照）が必要になる点だけ覚えておく。

Cloud Run は IAP 必須にする。`allow-unauthenticated` は使わない。

実装者が確認すること:

- Cloud Run service は `AUTH_MODE=iap` で動かす。
- IAP 許可対象は Google Workspace domain、または発表用の明示ユーザ/グループに限定する。
- IAP service agent `service-$PROJECT_NUMBER@gcp-sa-iap.iam.gserviceaccount.com` に `roles/run.invoker` を付与する。これが付いていないと IAP 通過後に Cloud Run が 403 を返す（典型的なハマりポイント）。
- アプリ側は `x-goog-authenticated-user-email` を actor として使う。
- セキュリティ hardening として、`x-goog-iap-jwt-assertion` を検証してから authenticated email header を信頼する（§8 参照）。

---

## 6. GitHub Actions workflow

### Trigger

Phase 3-D の deploy workflow は `main` push で動かす。**PR では `pnpm test` / `typecheck` / `build` までを実行し、deploy job は skip する**。これにより main merge 前に CI が壊れていることを検知でき、かつ PR から本番反映される事故を防ぐ。

実装方針:

- 単一 workflow 内で `deploy` job を `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` で囲む。
- または `ci.yml`（PR 用、build/test まで）と `deploy.yml`（main push 用）を分割する。Phase 3-D は単一 workflow で始め、複雑化したら分割する。

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
```

### Required permissions

GitHub OIDC を使うため `id-token: write` が必要。

```yaml
permissions:
  contents: read
  id-token: write
```

### Jobs

1. `pnpm install --frozen-lockfile`
2. `pnpm test`
3. `pnpm typecheck`
4. `pnpm build`
5. WIF auth
6. Docker auth configure
7. Docker build
8. Docker push (`latest` + short SHA)
9. `gcloud run deploy`

### Image tags

必ず 2 tag を push する。

| Tag | 用途 |
|---|---|
| `$SHORT_SHA` | Cloud Run revision と commit の対応追跡 |
| `latest` | デモ・手動復旧時の見やすさ |

Cloud Run deploy には `$SHORT_SHA` tag を使う。

### GitHub Variables / Secrets

Secrets には JSON key を置かない。Secret として置く可能性があるのは、GCP 以外の外部 API key が出てきた場合のみ。

| 種別 | 名前 | 例 |
|---|---|---|
| Variable | `GCP_PROJECT_ID` | `ai-ready-knowledge-hub` |
| Variable | `GCP_PROJECT_NUMBER` | `123456789012` |
| Variable | `GCP_REGION` | `asia-northeast1` |
| Variable | `CLOUD_RUN_SERVICE` | `ai-ready-knowledge-hub` |
| Variable | `ARTIFACT_REGISTRY_REPO` | `knowledge-hub` |
| Variable | `WIF_PROVIDER` | `projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/providers/github` |
| Variable | `DEPLOY_SERVICE_ACCOUNT` | `github-deployer@$PROJECT_ID.iam.gserviceaccount.com` |
| Variable | `RUNTIME_SERVICE_ACCOUNT` | `knowledge-hub-runner@$PROJECT_ID.iam.gserviceaccount.com` |
| Variable | `KNOWLEDGE_HUB_BUCKET` | `ai-ready-knowledge-hub-uploads` |
| Variable | `KNOWLEDGE_HUB_TENANT_ID` | optional fixed tenant id |

---

## 7. Dockerfile 方針

Next.js standalone output を前提にする。

期待する stage:

| Stage | 内容 |
|---|---|
| `deps` | pnpm と lockfile で依存 install |
| `builder` | source copy → `pnpm build` |
| `runner` | `.next/standalone`, `.next/static`, `public` だけを含める |

必須条件:

- package manager は pnpm。`npm install` / `npm run` / `package-lock.json` は使わない。
- Node は `package.json` の `engines.node >=22` に合わせる。
- container は `HOSTNAME=0.0.0.0` と `PORT=8080` を env で受け取り、standalone server (`node .next/standalone/server.js`) に渡す。**Next.js 13+ の standalone server は default で `localhost` にバインドするため、`HOSTNAME=0.0.0.0` が無いと Cloud Run revision が起動しても外から到達できない**（原因特定に時間を溶かす定番の罠）。Dockerfile の `ENV HOSTNAME=0.0.0.0` で固定するか、Cloud Run service env で必ず指定する。
- `.env.local` は image に入れない。
- `.dockerignore` で `.git`, `.next`, `node_modules`, local env, coverage を除外する。

local smoke:

```bash
docker build -t ai-ready-knowledge-hub:local .
docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e HOSTNAME=0.0.0.0 \
  -e AUTH_MODE=local \
  -e GOOGLE_CLOUD_PROJECT=ai-ready-knowledge-hub \
  -e KNOWLEDGE_HUB_BUCKET=ai-ready-knowledge-hub-uploads \
  ai-ready-knowledge-hub:local
```

---

## 8. Auth / tenantId / IAP middleware

### 現状

`src/middleware.ts` は `AUTH_MODE=iap` のとき IAP header が無ければ `401` を返す。IAP header があれば `x-knowledge-hub-tenant-id`, `x-knowledge-hub-actor-email`, `x-knowledge-hub-auth-provider` を request header として後段に渡す。

`src/lib/auth/resolveTenantIdFromAuth.ts` は以下を実装済み。

- `x-goog-authenticated-user-email` の `accounts.google.com:user@example.com` prefix を除去
- email domain から tenantId 生成
- `KNOWLEDGE_HUB_TENANT_ID` override
- local fallback

### Phase 3-D hardening

IAP を通ったことの証明として、`x-goog-iap-jwt-assertion` を検証する。検証が通った場合のみ authenticated email header を信頼する。

実装方針:

- `src/lib/auth/verifyIapJwt.ts` を追加する。
- Google public keys を使って JWT signature を検証する。
- audience は **Cloud Run 直接 IAP の形式** を env で渡す（§5 で構成を決め打ち済み）:

  ```text
  IAP_JWT_AUDIENCE=/projects/$PROJECT_NUMBER/locations/$REGION/services/$CLOUD_RUN_SERVICE
  例: /projects/123456789012/locations/asia-northeast1/services/ai-ready-knowledge-hub
  ```

  External HTTPS LB 経由 IAP の場合は `/projects/$PROJECT_NUMBER/global/backendServices/$BACKEND_SERVICE_ID` 形式になる。Phase 3-D では採用しないが、Year 2 で LB に切り替える場合はここを変更する。
- 実値は Step 2 で `gcloud projects describe $PROJECT_ID --format='value(projectNumber)'` で project number を取得し、上記 template に埋める。GitHub Variables `GCP_PROJECT_NUMBER` と整合させる。
- local/dev/test では `AUTH_MODE=local` のままにし、IAP JWT 検証を要求しない。

注意:

- JWT 検証を Phase 3-D で完了できない場合でも、少なくとも `AUTH_MODE=iap`、IAP 設定、IAP 経由以外 401/403 の evidence は必須にする。

---

## 9. AuditEvent

### 対象 action

| Action | 接続先 | target |
|---|---|---|
| `document.import` | `POST /api/documents` | upload された docId/fileName/sourceKind/sensitivity |
| `document.reimport` | `POST /api/import/google-sheets` と workspace freshness/reimport route | imported docId/fileName/sourceKind/externalSourceFileId/sensitivity |
| `document.export` | `POST /api/context-package` | package 対象 docId 群。MVP では代表 target か package-level target に寄せてもよい。 |

### 書き込み方針

- `recordAuditEvent()` は Firestore `.create()` を使うため、eventId 衝突時以外は append-only。
- import 成功時は orchestrator が docId と sensitivity を返した後に記録する。
- **Phase 3-D では成功監査 (`result: 'success'`) のみを配線する。失敗監査 (`result: 'failure'`) は Phase 3-G に後回しにする**。理由: `target.docId` が string で required（`auditEvent.ts` L33）のため、import 失敗時に `'unknown'` を流すと「失敗イベントは tenant 単位の集計でしか意味を持たない（docId で join できない）」という設計含意が永続化する。Q4「先に成功イベントを確実に通す」と整合させる。
- このため Phase 3-D の route 配線は orchestrator 成功完了後に `recordAuditEvent()` を呼ぶ形のみで、orchestrator throw を catch して失敗 audit を書く try/finally は導入しない。

### Firestore Rules

`auditEvents/{eventId}` には **client SDK からの read/create/update/delete をすべて拒否**する Rules を置く（`firestore.rules` の `match /auditEvents/{eventId}`）。**Admin SDK は Security Rules を通らない**ため、サーバ側の append 書き込みは従来どおり可能で、クライアント経路だけを閉じる形になる。

**Rules の実効性の整理**:

- 本プロダクトは **Admin SDK 一本構成**（client SDK で Firestore を直接読み書きしない）。
- append-only の**実効防御**は、`recordAuditEvent()` が **Firestore `.create()` のみ**を使い、同一 `eventId` への上書きや更新 API を呼ばないアプリ規律で担保される。Rules はこの規律の補強ではなく、将来クライアント SDK が紛れ込んだときのガードレールである。
- Rules は「将来 client SDK 経由の読み書きが追加された時の保険」として置く。Rules を明文化することでコードレビュー時に「`auditEvents` を client から読まない・更新しない」という規範を可視化できる。
- 確認観点（Phase 3-D）:
  - Admin SDK 経由の `recordAuditEvent()` は Rules の評価対象外であること（deploy 先の挙動で確認）。
  - update / delete（および本リポジトリの Rules では create/read も）は **client SDK 経由で拒否**されることを Firebase Emulator + rules テスト等で確認するのが望ましい。
- **本リポジトリには Firebase Emulator 用の `package.json` スクリプトや rules 単体テストが未整備のため**、Phase 3-D の evidence は **(1) `firestore.rules` / `firebase.json` の commit** と **(2) 本節および `docs/decisions.md`（D-P3-D）に「append-only の実効防御は `recordAuditEvent()` の `.create()` 規律が正本である」旨を明記したこと**で代替する。Emulator を追加したタイミングで client 経路の拒否テストに切り替える。

---

## 10. 実装順序

### Step 1: Dockerfile

- `Dockerfile` と `.dockerignore` を追加。
- `docker build` が通ることを確認。
- local container が `AUTH_MODE=local` で起動することを確認。
- `pnpm build` が Docker build 内で通ることを確認。

### Step 2: GCP resources

- Artifact Registry repo 作成。
- deploy service account 作成。
- runtime service account 確認。
- WIF pool/provider 作成。
- GitHub repo/branch condition を設定。
- deploy service account に WIF impersonation を許可。

### Step 3: Workflow

- `.github/workflows/deploy.yml` を追加。
- `main` push または `workflow_dispatch` で test/typecheck/build が通ることを確認。
- image が Artifact Registry に `latest` と `$SHORT_SHA` で push されることを確認。
- Cloud Run revision が `$SHORT_SHA` image で更新されることを確認。

### Step 4: Cloud Run env / service config

Cloud Run に最低限設定する env:

```text
AUTH_MODE=iap
GOOGLE_CLOUD_PROJECT=$PROJECT_ID
KNOWLEDGE_HUB_BUCKET=$KNOWLEDGE_HUB_BUCKET
KNOWLEDGE_HUB_TENANT_ID=$OPTIONAL_TENANT_ID
MASKER_PROVIDER=simple-rule or cloud-dlp
FIRESTORE_PREFER_REST=true
```

Vertex / Firestore / GCS / DLP / Drive は runtime service account の ADC を使う。service account JSON key は deploy 先にも GitHub にも置かない。

### Step 5: IAP

- Cloud Run service に IAP を有効化。
- 許可 user/group/domain を設定。
- 未ログイン/未許可ユーザが 401/403 になることを確認。
- 許可ユーザで UI と API が動くことを確認。
- `x-goog-authenticated-user-email` から tenantId/actor が解決されることを確認。

### Step 6: AuditEvent

- `document.import` を `POST /api/documents` に配線。
- `document.reimport` を Sheets/Docs import に配線。
- `document.export` を Context Package export に配線。
- Firestore に `auditEvents/{eventId}` が append されることを確認。
- client 経路での `auditEvents` の update/delete 拒否を Rules で確認する（Firebase Emulator + テストが repo にあればそれで検証。無い場合は §9 の evidence 代替に従い `firestore.rules` の commit と docs 明記で代替）。

### Step 7: Evidence

発表用に以下を残す。

- GitHub Actions green run
- Artifact Registry image 一覧（`latest` と short SHA）
- Cloud Run revision 履歴（image tag と commit が対応）
- Cloud IAP 設定画面
- 未許可アクセスの 401/403
- 許可ユーザでの UI
- `auditEvents` collection の document
- commit push から Cloud Run 反映までの所要時間

---

## 11. Definition of Done

- [ ] `main` push で deploy workflow が起動する。
- [ ] workflow 内で `pnpm install --frozen-lockfile` が通る。
- [ ] workflow 内で `pnpm test` が通る。
- [ ] workflow 内で `pnpm typecheck` が通る。
- [ ] workflow 内で `pnpm build` が通る。
- [ ] Docker image が Artifact Registry に `latest` と `$SHORT_SHA` で push される。
- [ ] Cloud Run が `$SHORT_SHA` image の新 revision に切り替わる。
- [ ] Cloud Run は IAP 必須で、匿名アクセスできない。
- [ ] 許可ユーザは IAP 経由で UI と主要 API を利用できる。
- [ ] middleware が IAP identity から tenantId/actor を解決する。
- [ ] `POST /api/documents` 成功で `auditEvents/{eventId}` に `document.import` が記録される。
- [ ] reimport/export でも AuditEvent が記録される。
- [ ] Firestore Security Rules で `auditEvents` の client 経路 update/delete 拒否を確認する（emulator テストまたは §9 の docs + rules commit evidence）。
- [ ] commit push から Cloud Run 反映まで 5 分以内を目標に計測する。
- [ ] 発表用 screenshot を docs または提出素材に保存する。

---

## 12. 失敗時の切り分け

| 症状 | 見る場所 | よくある原因 |
|---|---|---|
| WIF auth が失敗 | GitHub Actions auth step / GCP IAM | repo/ref condition 不一致、provider resource name typo、`id-token: write` 不足 |
| Docker build が失敗 | builder stage | pnpm version 不一致、lockfile drift、Next.js standalone output missing |
| Cloud Run deploy が失敗 | deploy step / Cloud Run IAM | deploy SA に `run.admin` or `iam.serviceAccountUser` がない |
| revision 起動が失敗 | Cloud Run logs | env 不足、runtime SA 権限不足、PORT listen 不備 |
| IAP 後に 403 | IAP policy / Cloud Run IAM | user/group 未許可、IAP service agent に invoker がない |
| app が 401 を返す | app logs / middleware | `AUTH_MODE=iap` なのに IAP header が届いていない |
| tenantId が想定外 | request header / auth helper tests | email domain 由来。必要なら `KNOWLEDGE_HUB_TENANT_ID` override |
| AuditEvent が出ない | route logs / Firestore | route に未配線、actor 解決失敗、target 作成前に例外 |

---

## 13. 参考

- [docs/decisions.md](decisions.md) — `D-P3-D` が意思決定ログの正本。
- [docs/phase-3-c-direction.md](phase-3-c-direction.md) — Phase 3-D の元になった認証・デプロイ方針。
- [docs/setup-gcp.md](setup-gcp.md) — 既存 GCP project / bucket / service account のセットアップ。
- [Google Cloud IAP: Getting the user's identity](https://cloud.google.com/iap/docs/identity-howto)
- [Google Cloud IAM: Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation)
- [Google Cloud IAM: Best practices for Workload Identity Federation](https://cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation)

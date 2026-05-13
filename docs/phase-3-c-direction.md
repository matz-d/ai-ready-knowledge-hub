# Phase 3-C 方向性メモ

> 作成: 2026-05-13  
> 背景: Phase 3-B 完了後、認証・デプロイ・配布形態について議論した内容を Phase 3-C スコープ設計の入力として残す。

---

## 1. 認証方針（実務目線）

### アプリ認証（誰が UI を使えるか）

**推奨（第一選択）: Cloud IAP + Google Workspace SSO**

- Cloud Run の前段に IAP を被せ、顧客ドメインのみ通す
- IAP 通過時の `x-goog-authenticated-user-email` が監査ログのキーになる
- MFA / Context-Aware Access (信頼デバイス制限) を GCP 設定だけで追加可能
- 士業事務所は Google Workspace 採用率が高い

**代替（顧客が M365 主体の場合）: Firebase Auth (Identity Platform) + OIDC**

- Azure AD / SAML を外部 IdP として使う
- 監査ログとの連動は自前で実装が必要

**非推奨: 独自メール+パスワード**

### Drive 認証（アプリが顧客 Drive にアクセスする方法）

**推奨: OAuth 2.0 User Delegation（3-legged、per-user）**

- scope は `drive.file`（アプリで開いたファイルだけ）を強く推奨
- 取り込み時のみアクセス前提なら `offline access` は取らない
- 「誰が取り込んだ」が OAuth identity で確定 → 監査の第一ピース
- 漏洩時のブラスト半径が「そのユーザの Drive」に限定

**Phase 3-B 時点の現状（Service Account 個別共有）**

- PoC では OK、スケーラビリティと監査の両方で詰む
- Phase 3-C で OAuth user delegation に移行するのが望ましい

---

## 2. 配布形態の方向性

3 段階の戦略として整理する。

```
Year 1: SaaS (Cloud Run hosted, あなたが管理)
  └─ 顧客は URL でアクセスするだけ

Year 2: SaaS + Lightweight BYOC (Docker on 顧客 GCP)
  ├─ SaaS: 小中規模士業
  └─ Lightweight: 「自社 GCP で管理したい」中規模

Year 3: 上記 + Full BYOC (Terraform で全構築)
  └─ エンタープライズ（大手士業法人）のみ
```

### 「Docker 配布」と「BYOC」の整理

「顧客が Docker image を自分の Cloud Run に deploy」は実質 Lightweight BYOC と同義。
本質的な分岐は **「顧客のクラウドで run するか、あなたのクラウドで run するか」** だけ。
配布形態（Docker vs Terraform）は secondary な違い。

---

## 3. ハッカソン向けデプロイ（Phase 3-C の実装目標）

採点軸「つくる・まわす・とどける」の「まわす」と「とどける」を満たすために：

**推奨: GitHub Actions + Artifact Registry + Cloud Run**

```
commit push (main)
  ↓
GitHub Actions
  ├─ pnpm test (vitest)
  ├─ pnpm typecheck
  └─ Cloud Build
       ├─ docker build (multi-stage)
       ├─ push to Artifact Registry
       │   └─ 自動 security scan
       └─ gcloud run deploy
```

**Dockerfile 方針**

- monolithic（1 image で全機能）、multi-stage build で size 最適化
- Artifact Registry は「バージョン管理」より「CI/CD pipeline の可視化・透明性」の位置づけ
- image tag = `latest` + `$SHORT_SHA`（git commit hash でトレーサビリティ確保）

**発表での見せ方**

- "commit から 5 分で本番反映、security scan も自動" を dashboard screenshot で示す
- Cloud Run URL で即デモ可能

---

## 4. データ保管・セキュリティの優先順序

### Phase 3-C で必須

| 項目 | 内容 |
|---|---|
| リージョン固定 | `asia-northeast1` 一本、データ越境排除 |
| Cloud Audit Logs | Data Access logs を明示的に ON（デフォルト無効に注意）|
| アプリ層 AuditEvent | `auditEvents/{eventId}` collection、append-only |

### Year 1 後半で整備

| 項目 | 内容 |
|---|---|
| CMEK | 顧客 KMS 鍵で GCS / Firestore を暗号化、「鍵を顧客が握る」営業力 |
| VPC Service Controls | GCS / Firestore / Vertex AI を perimeter で囲む |
| BigQuery 監査 export | 7 年保管 + 顧客向け監査レポート |

---

## 5. 監査ログの設計指針

「誰がどの文書を取り込んだか」を 5W1H で残す。

```ts
type AuditEvent = {
  eventId: string;       // ULID（時系列ソート可能）
  occurredAt: Timestamp;
  tenantId: string;

  actor: {
    userId: string;      // IAP identity (email)
    ipAddress: string;
    userAgent: string;
  };

  action:
    | 'document.import'
    | 'document.reimport'
    | 'document.view'
    | 'document.export'
    | 'document.delete'
    | 'chunk.access'
    | 'mask.override';

  target: {
    docId: string;
    fileName: string;
    sourceKind: 'upload' | 'google_workspace';
    externalSourceFileId?: string;
    sensitivity: string;
  };

  result: 'success' | 'failure' | 'partial';
  errorCode?: string;
};
```

`document.export` / `document.delete` / `mask.override` は Firestore Security Rules で update / delete を拒否し、append-only を強制する。

---

## 6. Phase 3-C での実装優先順序

```
優先 1: API 認証層
  └─ Cloud IAP (Google Workspace SSO)
  └─ tenantId の middleware 注入（後の Lightweight BYOC 移行コスト削減）

優先 2: GitHub Actions CI/CD + Dockerfile 整備
  └─ commit → test → build → Artifact Registry → Cloud Run
  └─ ハッカソン採点「まわす」の主要エビデンス

優先 3: AuditEvent collection 実装
  └─ document.import / reimport / export を最低限 record

優先 4: Cloud Run monitoring ダッシュボード整備
  └─ 発表資料用 screenshot

優先 X（やらない）:
  - BYOC / Terraform（Year 2 以降）
  - マルチリージョン対応
  - microservices 分割
```

---

## 7. 実装方式への影響

**SaaS → Lightweight BYOC を視野に入れても、実装コードの変化は小さい。**

変わらない部分：Curator / Masker ロジック、Firestore スキーマ、GCS 操作、API routes のビジネスロジック

変わる部分（config で切り替え可能にしておく）：
- 認証層（IAP か OAuth か）
- Secret / credential の取得先（Secret Manager の project が変わるだけ）
- deployment（Cloud Run hosting か 顧客 Cloud Run か）

Phase 3-C での準備として：
- env から全 config を読む習慣の徹底（既にほぼ達成）
- `resolveTenantIdFromAuth(req)` の abstraction を認証層に統一する
- Secret 管理の抽象化（呼び出しコードを変えずに取得先を切り替えられる形）

---

## 関連ドキュメント

- [docs/decisions.md](decisions.md) — 全意思決定ログ
- [docs/phase-3-b-workspace-resync.md](phase-3-b-workspace-resync.md) — Phase 3-B 正本（完了）
- [docs/tech-stack.md](tech-stack.md) — 技術スタック確定情報

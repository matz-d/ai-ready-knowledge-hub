# AI-Ready Knowledge Hub

> SMEの散らばった情報を、AIが使える会社の記憶に変える。

[DevOps × AI Agent Hackathon 2026](https://findy.notion.site/devops-ai-agent-hackathon-2026) (Findy × Google Cloud) 提出作品。

---

## 一行説明

機密文書を扱うSMEのPDF・CSV・メモ・テンプレートなどの雑多な情報を一箇所に集約し、AIが自動で分類・意味マッピングするエージェント。さらに目的を入力すると、Gemini / NotebookLM / Codex / RAG に渡すべき情報セット、不足している暗黙知、人間に確認すべき質問を生成し、AI活用前の Context Package を作成する。

初期デモ題材は会計・社労士事務所。ただし本作品は士業の専門判断を代替するものではなく、機密文書と暗黙知を多く持つSMEの「AI活用前の準備」を支援する前段プラットフォームとして位置づける。

---

## 現在のステータス (2026-05-14)

**フェーズ**: Phase 3-D（CI/CD + IAP + AuditEvent）完了。commit push → 自動 CI → Artifact Registry → Cloud Run の継続デプロイと Cloud IAP による社内限定公開が稼働中。

### 完了済み

- **W1 技術検証**: Genkit + Vertex AI で Curator 6 分類 + Masker A8 residualRisk + A9 Markdown export + Cloud Run デプロイを確認。
- **Phase 1 (Upload Walking Skeleton)**: `/upload` → GCS + Firestore + Curator + Masker → 結果表示。実 GCP 接続確認済み。
- **Phase 1 follow-up (Cloud DLP)**: Masker provider に `cloud-dlp` を選択可能。`MASKER_PROVIDER=cloud-dlp` で明示。
- **Phase 2 (KnowledgeChunk)**: CSV / `.xlsx` を spreadsheet chunk として `documents/{docId}/chunks/{chunkId}` に保存。`.txt` / `.md` は paragraph chunk として 1 文書 1 chunk。
- **Phase 3-A (Google Sheets import)**: Drive `files.export` で Sheets を `.xlsx` スナップショットに変換し Phase 2 パイプラインへ。
- **Phase 3-B (Workspace resync)**: schemaVersion 2 + 鮮度バッジ + `POST /api/workspace/freshness` で再取り込み。
- **Phase 3-C (App Loop)**:
  - Strategist flow（目的別 chunk 選別 LLM）を実装。safety gate（決定論的 PII フィルタ）で前段防御。
  - `StrategistOrchestrator` service 層（Firestore Inventory + chunks 取得 → safety gate → Strategist）。
  - `buildStrategistContextPackage()` で Strategist 結果を既存 `ContextPackageExportInput` に変換し Markdown を出力。
  - `POST /api/context-package` 同期 API。
  - `/context-package` UI（Purpose 入力 → 結果表示 → `.md` ダウンロード）。
  - Google Docs import route を接続。`docs.google.com/document/d/` URL を Docs importer に振り分け。
  - upload 直後の chunk 自動生成（`replaceChunksForDoc`、失敗時 500）。
  - malformed Inventory document は skip-and-warn で全体を落とさない。
  - source coverage 確認済み: upload `.txt` / `.md` / `.csv` / `.xlsx` + Google Sheets + Google Docs のすべてが Purpose Query まで到達。
- **Phase 3-D (CI/CD + IAP + AuditEvent)**:
  - `Dockerfile`（multi-stage / pnpm / Node 22 / standalone / 非 root）と `.dockerignore` を追加。image サイズ 442MB。
  - `.github/workflows/deploy.yml`：`main` push で test / typecheck / build → Docker build/push → `gcloud run deploy`。WIF 認証（Service Account JSON key 不使用）。
  - Artifact Registry `knowledge-hub` repo に `:latest` と `:<SHORT_SHA>` の 2 tag で push。
  - Cloud Run IAP 直接保護。`--no-allow-unauthenticated` 固定。IAP service agent に `roles/run.invoker` 付与済み。
  - `src/lib/auth/verifyIapJwt.ts` で `x-goog-iap-jwt-assertion` を検証し、signature OK 後のみ `x-goog-authenticated-user-email` を信頼。
  - `document.import` / `document.reimport` / `document.export` の AuditEvent を対象 route の成功後に append-only で記録（`auditEvents/{eventId}`）。
  - `firestore.rules` で `auditEvents` の update/delete を拒否（Admin SDK 規律が正本）。
  - deploy 3 分 32 秒。証跡 screenshot: `docs/iap-evidence/`。

### コードの位置 (Phase 3-D 完了時点)

```
src/
  agents/
    _shared/genkitClient.ts
    curator/{schema,prompt,flow}.ts       # R5 確定 enum + 4段フォールバック
    masker/{schema,prompt,flow}.ts        # A8 residualRisk + 3段フォールバック
    masker/{maskingSchema,simpleMasker,cloudDlpMasker,provider,pipelineSchema,pipelineFlow,upgrade,maskKnowledgeChunk}.ts
    strategist/{schema,prompt,flow}.ts    # chunk 選別 LLM（Vertex AI + Genkit）
    strategist/safetyGate.ts             # 決定論的 PII フィルタ（LLM を呼ばない）
    strategist/types.ts
  services/
    strategistOrchestrator/
      orchestrator.ts                    # Firestore + safety gate + Strategist を繋ぐ service 層
      toContextPackage.ts                # StrategistOrchestratorResult → ContextPackageExportInput + Markdown
      types.ts                           # StrategistOrchestratorResult（API response の正本型）
      index.ts
  lib/
    exportContextPackage.ts              # A9 Markdown export 純関数
    storage.ts / firestore.ts / documents.ts
    uploadOrchestrator.ts                # GCS / Firestore / Curator / Masker の副作用順序
    importedSnapshotOrchestrator.ts      # Sheets / Docs import の副作用順序
    inventory.ts / inventoryFirestoreAdapter.ts
    contextPackageInput.ts / contextPackageFirestoreAdapter.ts
    documentUploadResponseMapper.ts
    knowledgeChunkSchema.ts / chunkFirestoreAdapter.ts / chunkRegenerator.ts
    columnSensitivityRules.ts
    googleSheetsSnapshotImporter.ts / googleDocsSnapshotImporter.ts / googleWorkspaceClient.ts
    workspaceFreshness.ts / workspaceImport/types.ts
    extractors/{csvExtractor,xlsxExtractor,plainTextExtractor}.ts
    firestoreSchema.ts / parseFirestoreDocumentData.ts
    auth/
      resolveTenantIdFromAuth.ts         # IAP email → tenantId/actor 解決（Phase 3-D）
      verifyIapJwt.ts                    # x-goog-iap-jwt-assertion の JWT 検証（Phase 3-D）
    audit/
      auditEvent.ts                      # AuditEvent 型・recordAuditEvent()（Phase 3-D）
  middleware.ts                          # AUTH_MODE=iap で IAP JWT 検証 + auth header 注入
  app/
    api/
      context-package/route.ts           # POST /api/context-package（同期 Purpose Query）
      documents/route.ts                 # POST /api/documents（upload → auto-chunk）
      documents/[docId]/route.ts         # GET /api/documents/:docId
      import/google-sheets/route.ts      # POST /api/import/google-sheets（Sheets / Docs 振り分け）
      import/google-sheets/service-account-email/route.ts
      workspace/freshness/route.ts       # POST /api/workspace/freshness
      curator/route.ts                   # eval/smoke 専用、UI 非使用
    context-package/
      ContextPackageForm.tsx             # Purpose 入力 → API 呼び出し → 結果表示 + .md DL
      page.tsx
    documents/[docId]/page.tsx
    import/google-sheets/ImportForm.tsx / page.tsx
    upload/UploadForm.tsx / CuratorResultCard.tsx / MaskerResultCard.tsx / page.tsx
    page.tsx                             # Knowledge Inventory（Firestore 正本、失敗時 W1 fallback）
    layout.tsx                           # ナビゲーション（アップロード / Sheets 取り込み / Context Package）
  _components/ReimportButton.tsx
scripts/
  runCurator.ts / runCuratorAll.ts / runMaskerRisk.ts
  runMaskerPipeline.ts / runDlpMaskerSmoke.ts / runContextPackageDemo.ts
  runStrategist.ts                       # Strategist flow の手動 smoke
  regenerateChunks.ts                    # documents/{docId}/chunks 全置換
  backfillSourceKind.ts                  # schemaVersion 1 → 2 migration
  generateInventorySnapshot.ts
  scanMiniShaiHuludIocs.ts
docs/
  decisions.md                           # 意思決定ログ（D1〜D5 + Phase 別採用判断）
  open-questions.md                      # 未決定事項・次フェーズ候補
  phase-3-c-5-source-coverage.md         # Phase 3-C-5 source coverage 確認結果
  phase-3-c-direction.md                 # Phase 3-C 認証・デプロイ方針
  phase-3-d-direction.md                 # Phase 3-D CI/CD + IAP + AuditEvent 実装方針（完了）
  iap-evidence/                          # Phase 3-D 完了証跡（screenshot + verification.txt）
    iap-settings-console.png / unauthenticated-login.png / authorized-api-200.png / authorized-ui.png
    phase-3d-completion-verification.txt
  architecture.md / tech-stack.md / concept.md / scope.md
  firestore-schema.md / setup-gcp.md
  demo-runbook.md / demo-scenario.md / hackathon.md
  w1-artifacts/inventory.snapshot.json
Dockerfile                               # multi-stage / pnpm / Node 22 / standalone（Phase 3-D）
.dockerignore                            # Phase 3-D
firestore.rules                          # auditEvents append-only 規則（Phase 3-D）
.github/workflows/deploy.yml             # CI + Cloud Run deploy（Phase 3-D）
sample-data/
  accounting-office/                     # 原本 10 件
  masked/                                # Masker A8 評価のマスク済み入力 2 件
```

### pnpm scripts

| コマンド | 用途 |
|---|---|
| `pnpm dev` / `build` / `start` | Next.js |
| `pnpm typecheck` | tsc --noEmit (src + scripts 全体) |
| `pnpm test` / `test:watch` | Vitest unit |
| `pnpm test:e2e:smoke` | GCP なしの安定 E2E（fake Firestore/GCS + stub LLM） |
| `pnpm test:e2e:live` | 実 GCP/Vertex 用 E2E（デフォルト CI には含めない） |
| `pnpm curator [path]` | Curator flow を 1 ファイルに対し実行 |
| `pnpm curator:all [dir]` | sample-data 全件で smoke 実行 |
| `pnpm masker:risk [path]` | A8 residualRisk 評価 |
| `pnpm masker:pipeline [path]` | 原本 → SimpleMasker → A8 residualRisk → `ai_safe_ready` / `restricted_promoted` |
| `pnpm masker:dlp:smoke [path]` | Cloud DLP provider 単体の疎通確認 |
| `pnpm strategist` | Strategist flow の手動 smoke（`scripts/runStrategist.ts`） |
| `pnpm backfill:source-kind --dry-run` | `schemaVersion=1` document の対象件数と先頭 5 件 docId を表示（Firestore 書き込みなし） |
| `pnpm backfill:source-kind --confirm` | `schemaVersion=1` document を 500 件単位で schemaVersion 2 に更新 |
| `pnpm chunks:regenerate <docId>` | CSV / `.xlsx` / `.txt` / `.md` の GCS raw object から `documents/{docId}/chunks` を全置換。`--dry-run` で件数のみ確認。`--provider=simple-rule\|cloud-dlp` で masking provider を固定可能 |
| `pnpm inventory:snapshot` | 実 LLM 出力で `docs/w1-artifacts/inventory.snapshot.json` を再生成 |
| `pnpm context:demo` | Context Package demo の統一エントリ。デフォルトは live、`--w1` で fixture |
| `pnpm context:demo:live` | Firestore documents + chunks から Context Package Markdown を出力 |
| `pnpm context:demo:w1` | W1 snapshot fixture から Context Package Markdown を出力（offline） |
| `pnpm curator:ui` | Genkit dev UI で flow を観察 |
| `pnpm security:audit` | 依存パッケージの脆弱性監査 |

### schemaVersion 1 → 2 backfill 実行手順

1. dry-run（書き込みなし）

   ```
   pnpm backfill:source-kind --dry-run
   ```

2. dry-run の `targetCount` / `previewDocIds` を確認
3. confirm 実行（500 件単位で更新）

   ```
   pnpm backfill:source-kind --confirm
   ```

4. 完了ログの `failedDocIds` を確認（失敗があっても処理は継続）

### HTTP API

| エンドポイント | 用途 |
|---|---|
| `POST /api/documents` | 単票アップロード。multipart 検証 → `uploadOrchestrator`（GCS / Firestore / Curator / Masker）→ chunk 自動生成。 |
| `GET /api/documents/:docId` | Inventory document の詳細取得。 |
| `POST /api/context-package` | Purpose Query API。`{ purpose, limit? }` を受け、Strategist が chunk を選別し Context Package + Markdown を同期で返す。 |
| `POST /api/import/google-sheets` | Google Sheets / Google Docs の URL または fileId を受け、Drive export → Phase 2 パイプラインへ。Docs URL（`docs.google.com/document/d/`）は Docs importer に自動振り分け。 |
| `GET /api/import/google-sheets/service-account-email` | Sheets / Docs の共有先として必要な service account email を返す。 |
| `POST /api/workspace/freshness` | Workspace document の再取り込みトリガー。 |
| `POST /api/curator` | **UI 非使用。** Curator 単体の curl / eval / smoke 専用。 |

### セキュリティ境界の現状 (Phase 3-D 完了時点)

- **Cloud IAP**: Cloud Run を直接 IAP で保護。`allow-unauthenticated` 不使用。匿名アクセスは IAP が 302/401 で遮断。
- **IAP JWT 検証**: `src/lib/auth/verifyIapJwt.ts` が `x-goog-iap-jwt-assertion` を Google public keys で検証。検証通過後のみ `x-goog-authenticated-user-email` を信頼する。
- **tenantId / actor 解決**: `src/lib/auth/resolveTenantIdFromAuth.ts` が IAP email の domain から tenantId を生成。`KNOWLEDGE_HUB_TENANT_ID` override 可。
- **AuditEvent**: `document.import` / `document.reimport` / `document.export` を `auditEvents/{eventId}` に append-only で記録。Firestore Security Rules で update/delete を拒否。
- **Safety gate**: Strategist へ渡す前に決定論的ルールで chunk を除外（Restricted / blocked / masking 未完了 / クロス顧客機密）。LLM に依存しない。
- **Masking defense-in-depth**: `requires_masking` chunk に `maskedText` がない場合、`toContextPackage` は raw text を fallback で出さず throw する。
- **Cloud DLP**: Masker provider として導入済み。未指定は `simple-rule` fallback、`MASKER_PROVIDER=cloud-dlp` で明示。
- **Malformed document**: `listInventoryDocumentsFromFirestore` は parse エラーの document を skip-and-warn し、全体を落とさない。
- **Sheets / Docs 共有**: Google Workspace import の対象は、UI に表示される service account email への reader 共有が必要。
- **データ保管**: GCS `asia-northeast1`、raw object は `raw/{docId}/`、masked object は `masked/{docId}/`。chunk 本文（`maskedText` 含む）は Firestore subcollection に inline 保存。

### 次にやること

- **Phase 3-E**: Cloud DLP 本格統合（`minLikelihood` 調整 / replacement token 統一 / 日本向け custom dictionary）。W3 予定だったもの。
- **Phase 3-F**: デモ polish・動画シナリオ・見栄え調整。発表準備。
- Curator / Masker eval パイプライン。

---

## ドキュメント

| ファイル | 内容 |
|---|---|
| [docs/concept.md](docs/concept.md) | プロダクトコンセプト、提供価値、物語の核 |
| [docs/scope.md](docs/scope.md) | MVPでやること・やらないこと |
| [docs/decisions.md](docs/decisions.md) | 意思決定ログ（D1〜D5 + 各 Phase の採用判断・CodeRabbit 対応記録） |
| [docs/open-questions.md](docs/open-questions.md) | 未決定事項と次フェーズ候補 |
| [docs/architecture.md](docs/architecture.md) | システム構成、4エージェント、データフロー |
| [docs/firestore-schema.md](docs/firestore-schema.md) | Firestore document shape の正本 |
| [docs/phase-3-c-direction.md](docs/phase-3-c-direction.md) | Phase 3-C 認証・デプロイ方針（Cloud IAP / GitHub Actions / BYOC 戦略） |
| [docs/phase-3-d-direction.md](docs/phase-3-d-direction.md) | Phase 3-D CI/CD + IAP + AuditEvent 実装方針（**完了**） |
| [docs/iap-evidence/](docs/iap-evidence/) | Phase 3-D 完了証跡（screenshot + verification.txt） |
| [docs/phase-3-c-5-source-coverage.md](docs/phase-3-c-5-source-coverage.md) | Phase 3-C-5 source coverage 確認結果（全 source 確認済み） |
| [docs/phase-3-b-workspace-resync.md](docs/phase-3-b-workspace-resync.md) | Phase 3-B 正本（Workspace resync・schemaVersion 2・鮮度バッジ） |
| [docs/phase-2-design.md](docs/phase-2-design.md) | KnowledgeChunk / CSV・xlsx extractor / chunk-aware Context Package の設計正本 |
| [docs/phase-2-live-smoke.md](docs/phase-2-live-smoke.md) | Phase 2 live smoke の実行証跡 |
| [docs/tech-stack.md](docs/tech-stack.md) | 技術選定と理由・トレードオフ |
| [docs/demo-runbook.md](docs/demo-runbook.md) | Upload → Firestore/GCS → Inventory → Context Package の live demo 実行手順 |
| [docs/demo-scenario.md](docs/demo-scenario.md) | 3分デモのストーリーボード |
| [docs/hackathon.md](docs/hackathon.md) | ハッカソン要件、スケジュール、審査基準 |
| [docs/setup-gcp.md](docs/setup-gcp.md) | GCPセットアップ固定値と認証/検証手順 |

---

## 次に再開するとき、最初に読むべきもの

1. このREADMEの「現在のステータス」
2. [docs/open-questions.md](docs/open-questions.md) — 次フェーズ候補と未決定事項
3. [docs/decisions.md](docs/decisions.md) — Phase 3-D の採用判断（`D-P3-D` セクション）
4. Cloud Run URL: `https://ai-ready-knowledge-hub-mrvutsz24a-an.a.run.app`（IAP 保護済み、許可ユーザのみアクセス可）

---

## ライセンス

Apache License 2.0 (予定)

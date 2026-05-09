# AI-Ready Knowledge Hub

> SMEの散らばった情報を、AIが使える会社の記憶に変える。

[DevOps × AI Agent Hackathon 2026](https://findy.notion.site/devops-ai-agent-hackathon-2026) (Findy × Google Cloud) 提出作品。

---

## 一行説明

機密文書を扱うSMEのPDF・CSV・メモ・テンプレートなどの雑多な情報を一箇所に集約し、AIが自動で分類・意味マッピングするエージェント。さらに目的を入力すると、Gemini / NotebookLM / Codex / RAG に渡すべき情報セット、不足している暗黙知、人間に確認すべき質問を生成し、AI活用前の Context Package を作成する。

初期デモ題材は会計・社労士事務所。ただし本作品は士業の専門判断を代替するものではなく、機密文書と暗黙知を多く持つSMEの「AI活用前の準備」を支援する前段プラットフォームとして位置づける。

---

## 現在のステータス (2026-05-09)

**フェーズ**: W2 Walking Skeleton 初期縦串完了。MVP に進行中。

### 完了済み
- ハッカソン要件の調査・整理 / 作品コンセプト・技術スタック・4エージェント構成・MVPスコープ確定
- W1-1: Genkit + Vertex AI で Curator 6 分類項目 + rationale の structured output が sample-data 10/10 件で Zod parse 通過
- W1-2: Masker A8 residualRisk 判定 (`Restricted` 格上げ / `Confidential` 維持) を structured JSON で実観測
- W1-3: A9 Markdown export 純関数 (`src/lib/exportContextPackage.ts`)
- W1-4: Next.js 最小アプリを Cloud Run (`ai-ready-knowledge-hub-w1`, `asia-northeast1`) にデプロイ済み (組織ポリシーで `allUsers` 不可、認証付きで HTTP 200)
- **W1 統合 (5/8 PM)**: `poc/w1/` を削除し、Curator/Masker の schema・prompt・Genkit flow を `src/agents/{curator,masker,_shared}/` の正本へ昇格。固定デモ用 fixture は通常 UI から外し、W1 の実 LLM snapshot は `docs/w1-artifacts/` に回顧用 artifact として退避。
- **Task1 (W2 Walking Skeleton)**: `/upload` → `POST /api/documents` → Cloud Storage (`raw/{docId}/{safeOriginalFileName}`) → Firestore (`documents/{docId}`) → `curatorFlow` → 単票結果表示まで実装。実 GCP 接続で `HTTP 200`、GCS object、Firestore `status=curated` を確認済み。
- **Task2 (Masker Pipeline MVP)**: `SimpleMasker` → 既存 `maskerRiskFlow` → `ai_safe_ready` / `restricted_promoted` の pipeline と CLI (`npm run masker:pipeline`) を実装。実 Vertex 接続で契約書サンプルは `restricted_promoted`、顧客対応メモは `ai_safe_ready` を確認済み。
- **Task3 (Restricted 除外の受け皿)**: `applyMaskerUpgrade`、W1 snapshot adapter、Context Package input builder を実装。Restricted 文書は `Full AI-Ready Sources` から除外され、human review として出力される。`npm run context:demo` は **live default**（引数なしで live、`--w1` 指定で fixture）として動作する。`context:demo:live` は Firestore terminal metadata に加え、`ai_safe` は `aiSafeStoragePath`、`curated` は `storagePath` から GCS 本文を読み込んで export する（`src/lib/contextPackageFirestoreAdapter.ts` / `readTextObject`）。バケット名は `KNOWLEDGE_HUB_BUCKET`、GCP 認証は ADC（例: `gcloud auth application-default login`）。`context:demo:live` は fallback せず、Firestore/GCS 条件不備時は non-zero で終了する。オフライン検証は `npm run context:demo:w1`。トップページの Inventory は Firestore 正本を優先し、読み取り失敗時のみ W1 snapshot にフォールバック（フォールバック時のみプレースホルダ本文を許可）。
- 詳細振り返り: [docs/week1-retrospective.md](docs/week1-retrospective.md)

### コードの位置 (Task1/2/3 完了時点)

```
src/
  agents/
    _shared/genkitClient.ts
    curator/{schema,prompt,flow}.ts   # R5 確定 enum + 4段フォールバック
    masker/{schema,prompt,flow}.ts    # A8 residualRisk + 3段フォールバック
    masker/{maskingSchema,simpleMasker,pipelineSchema,pipelineFlow,upgrade}.ts
    strategist/types.ts               # Strategist の型境界（LLM本体は未実装）
  lib/
    exportContextPackage.ts           # A9 Markdown export 純関数
    storage.ts / firestore.ts / documents.ts / uploadOrchestrator.ts
    inventory.ts / inventoryFirestoreAdapter.ts
    contextPackageInput.ts / contextPackageFirestoreAdapter.ts
    documentUploadResponseMapper.ts   # POST /api/documents 成功レスポンス組み立て
  app/
    api/curator/route.ts              # Curator 単体 eval/smoke（UI からは未使用）
    api/documents/route.ts            # multipart 検証 → uploadOrchestrator
    upload/                           # 単票アップロード UI
    page.tsx                          # Firestore Inventory（失敗時 W1 fallback）+ Context Package プレビュー + /upload CTA
scripts/
  runCurator.ts / runCuratorAll.ts / runMaskerRisk.ts
  runMaskerPipeline.ts / runContextPackageDemo.ts
  generateInventorySnapshot.ts        # W1 回顧用 snapshot artifact を更新
docs/
  w1-artifacts/inventory.snapshot.json # W1 実 LLM 出力の退避先
sample-data/
  accounting-office/                  # 原本 10 件
  masked/                             # Masker A8 評価のマスク済み入力 2 件
```

### npm scripts

| コマンド | 用途 |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | tsc --noEmit (src + scripts 全体) |
| `npm run test` / `test:watch` | Vitest unit（`src/**/*.test.ts`、E2E は除外） |
| `npm run test:e2e:smoke` | GCP/Vertex なしの安定 E2E。fake Firestore/GCS + stub Curator/Masker で upload → Inventory → Context Package を検証 |
| `npm run test:e2e:live` | 実 GCP/Firestore/GCS/Vertex 用の live E2E 枠。デフォルト CI には含めない。env 不足時は skip |
| `npm run curator [path]` | Curator flow を 1 ファイルに対し実行 |
| `npm run curator:all [dir]` | sample-data 全件で smoke 実行 |
| `npm run masker:risk [path]` | A8 residualRisk 評価 |
| `npm run masker:pipeline [path]` | 原本 → SimpleMasker → A8 residualRisk → `ai_safe_ready` / `restricted_promoted` |
| `npm run inventory:snapshot` | 実 LLM 出力で `docs/w1-artifacts/inventory.snapshot.json` を再生成 |
| `npm run context:demo` | Context Package demo の統一エントリ。デフォルトは live、`--w1` 指定で fixture (`npm run context:demo -- --w1`) |
| `npm run context:demo:live` | Firestore documents + GCS bodies から Context Package Markdown を出力（fallback なし。Firestore/GCS 条件不備時は終了コード 1） |
| `npm run context:demo:w1` | W1 snapshot fixture から Context Package Markdown を出力する offline demo（Firestore/GCS 非接続） |
| `npm run curator:ui` | Genkit dev UI で flow を観察 |

### セキュリティ境界の現状 (MVP)

- Cloud DLP / Document AI / Drive 連携は**未導入**（次ステップ）。
- 現在のマスキングは `SimpleMasker` + Gemini residual risk 判定 (`maskerRiskFlow`)。
- `context:demo:live` では、GCS 本文取得に失敗した文書は export 全体を落とさず human review に回し、読めた文書のみ `Full AI-Ready Sources` に含める。

### HTTP API（upload と Curator 単体）

| エンドポイント | 用途 |
|---|---|
| `POST /api/documents` | `/upload` UI からの単票アップロード。検証後は `src/lib/uploadOrchestrator.ts` の `orchestrateUploadProcessing` に委譲し、GCS / Firestore / Curator / Masker の順序付き副作用はここに集約される。成功 JSON は `documentUploadResponseMapper` で組み立てる。 |
| `POST /api/curator` | **UI 非使用。** Curator 単体の curl / eval / smoke 専用。upload の本線は `/api/documents` のみ。 |

### 次にやること
- Knowledge Inventory の機能拡張（フィルタ、詳細ドリルダウン、エラー時の運用導線など）
- Purpose Query UI + Strategist / Interviewer flow を実装し、A9 export を実 Context Package に接続する
- Cloud DLP を `SimpleMasker` provider 境界へ差し替える
- Curator / Masker eval パイプライン (W6 マイルストーン)

---

## ドキュメント

| ファイル | 内容 |
|---|---|
| [docs/concept.md](docs/concept.md) | プロダクトコンセプト、提供価値、物語の核 |
| [docs/scope.md](docs/scope.md) | MVPでやること・やらないこと |
| [docs/demo-runbook.md](docs/demo-runbook.md) | Upload → Firestore/GCS → Inventory → Context Package の live demo 実行手順 |
| [docs/demo-scenario.md](docs/demo-scenario.md) | 3分デモのストーリーボード |
| [docs/hackathon.md](docs/hackathon.md) | ハッカソン要件、スケジュール、審査基準 |
| [docs/architecture.md](docs/architecture.md) | システム構成、4エージェント、データフロー |
| [docs/tech-stack.md](docs/tech-stack.md) | 技術選定と理由・トレードオフ |
| [docs/decisions.md](docs/decisions.md) | 意思決定ログ (D1〜D5 + 追加判断) |
| [docs/open-questions.md](docs/open-questions.md) | 未決定事項と次に決めるべきこと |
| [docs/setup-gcp.md](docs/setup-gcp.md) | GCPセットアップ固定値と認証/検証手順 |

---

## 次に再開するとき、最初に読むべきもの

1. このREADMEの「現在のステータス」
2. [docs/architecture.md](docs/architecture.md) — Task1/2/3 後の実装状態とデータフロー
3. [docs/decisions.md](docs/decisions.md) — 何を決めたか、なぜか

その後、実装再開なら [docs/open-questions.md](docs/open-questions.md) と [docs/tech-stack.md](docs/tech-stack.md)。

---

## ライセンス

Apache License 2.0 (予定)

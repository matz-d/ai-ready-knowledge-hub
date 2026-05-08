# AI-Ready Knowledge Hub

> SMEの散らばった情報を、AIが使える会社の記憶に変える。

[DevOps × AI Agent Hackathon 2026](https://findy.notion.site/devops-ai-agent-hackathon-2026) (Findy × Google Cloud) 提出作品。

---

## 一行説明

機密文書を扱うSMEのPDF・CSV・メモ・テンプレートなどの雑多な情報を一箇所に集約し、AIが自動で分類・意味マッピングするエージェント。さらに目的を入力すると、Gemini / NotebookLM / Codex / RAG に渡すべき情報セット、不足している暗黙知、人間に確認すべき質問を生成し、AI活用前の Context Package を作成する。

初期デモ題材は会計・社労士事務所。ただし本作品は士業の専門判断を代替するものではなく、機密文書と暗黙知を多く持つSMEの「AI活用前の準備」を支援する前段プラットフォームとして位置づける。

---

## 現在のステータス (2026-05-08)

**フェーズ**: Week 1 クローズ。MVP に進行中 (Walking Skeleton 着手前)。

### 完了済み
- ハッカソン要件の調査・整理 / 作品コンセプト・技術スタック・4エージェント構成・MVPスコープ確定
- W1-1: Genkit + Vertex AI で Curator 6 分類項目 + rationale の structured output が sample-data 10/10 件で Zod parse 通過
- W1-2: Masker A8 residualRisk 判定 (`Restricted` 格上げ / `Confidential` 維持) を structured JSON で実観測
- W1-3: A9 Markdown export 純関数 (`src/lib/exportContextPackage.ts`)
- W1-4: Next.js 最小アプリを Cloud Run (`ai-ready-knowledge-hub-w1`, `asia-northeast1`) にデプロイ済み (組織ポリシーで `allUsers` 不可、認証付きで HTTP 200)
- **W1 統合 (5/8 PM)**: `poc/w1/` を削除し、Curator/Masker の schema・prompt・Genkit flow を `src/agents/{curator,masker,_shared}/` の正本へ昇格。固定デモ用 fixture は通常 UI から外し、W1 の実 LLM snapshot は `docs/w1-artifacts/` に回顧用 artifact として退避。
- 詳細振り返り: [docs/week1-retrospective.md](docs/week1-retrospective.md)

### コードの位置 (W2 着手前)

```
src/
  agents/
    _shared/genkitClient.ts
    curator/{schema,prompt,flow}.ts   # R5 確定 enum + 4段フォールバック
    masker/{schema,prompt,flow}.ts    # A8 residualRisk + 3段フォールバック
  lib/exportContextPackage.ts         # A9 Markdown export 純関数
  app/page.tsx                        # fixture なしの実データ接続待ち UI
scripts/
  runCurator.ts / runCuratorAll.ts / runMaskerRisk.ts
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
| `npm run curator [path]` | Curator flow を 1 ファイルに対し実行 |
| `npm run curator:all [dir]` | sample-data 全件で smoke 実行 |
| `npm run masker:risk [path]` | A8 residualRisk 評価 |
| `npm run inventory:snapshot` | 実 LLM 出力で `docs/w1-artifacts/inventory.snapshot.json` を再生成 |
| `npm run curator:ui` | Genkit dev UI で flow を観察 |

### 次にやること (W2)
- Walking Skeleton (Cloud Storage + Firestore + Upload UI + Curator Route Handler 接続)
- Masker + Cloud DLP 統合
- Strategist / Interviewer と A9 export の実 Context Package 接続
- Knowledge Inventory UI を実 Firestore 接続で実装
- Curator / Masker eval パイプライン (W6 マイルストーン)

---

## ドキュメント

| ファイル | 内容 |
|---|---|
| [docs/concept.md](docs/concept.md) | プロダクトコンセプト、提供価値、物語の核 |
| [docs/scope.md](docs/scope.md) | MVPでやること・やらないこと |
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
2. [docs/open-questions.md](docs/open-questions.md) — Week 1到達点と次の論点
3. [docs/decisions.md](docs/decisions.md) — 何を決めたか、なぜか

その後、実装再開なら [docs/architecture.md](docs/architecture.md) と [docs/tech-stack.md](docs/tech-stack.md)。

---

## ライセンス

Apache License 2.0 (予定)

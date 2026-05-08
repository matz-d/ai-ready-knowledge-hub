# AI-Ready Knowledge Hub

> SMEの散らばった情報を、AIが使える会社の記憶に変える。

[DevOps × AI Agent Hackathon 2026](https://findy.notion.site/devops-ai-agent-hackathon-2026) (Findy × Google Cloud) 提出作品。

---

## 一行説明

機密文書を扱うSMEのPDF・CSV・メモ・テンプレートなどの雑多な情報を一箇所に集約し、AIが自動で分類・意味マッピングするエージェント。さらに目的を入力すると、Gemini / NotebookLM / Codex / RAG に渡すべき情報セット、不足している暗黙知、人間に確認すべき質問を生成し、AI活用前の Context Package を作成する。

初期デモ題材は会計・社労士事務所。ただし本作品は士業の専門判断を代替するものではなく、機密文書と暗黙知を多く持つSMEの「AI活用前の準備」を支援する前段プラットフォームとして位置づける。

---

## 現在のステータス (2026-05-08)

**フェーズ**: Week 1 技術リスク検証中。Genkit / A8 / A9 / Cloud Run 最小デプロイは通過。

### 完了済み
- ハッカソン要件の調査・整理
- 作品コンセプトの確定 (機密文書を扱うSME向け、初期デモは士業題材、AI参照可能化までを価値に含める)
- 技術スタックの確定 (Vertex AI API + Cloud DLP + Genkit TypeScript + Cloud Run + Firestore)
- 4エージェント構成の設計 (Curator / Masker / Strategist / Interviewer)
- MVPスコープの確定 (Vector Search / Masker eval / 本格PDF解析は後回し)
- デモシナリオの確定 (Purpose Query を主役に、3分編集動画前提)
- Genkit + Vertex AI PoC (`poc/w1`): Curator structured output が sample-data 10/10 件で Zod parse 通過
- A8 residualRisk PoC (`poc/w1`): `Restricted` 格上げ / `Confidential` 維持の structured JSON 出力を確認
- A9 Markdown export PoC (`src/lib/exportContextPackage.ts`): Package Manifest、下流AI向けInstructions、Included/Excluded、Missing Knowledge、Full AI-Ready Sources をMarkdown生成
- Next.js 最小アプリを Cloud Run にデプロイ
  - Service: `ai-ready-knowledge-hub-w1`
  - Region: `asia-northeast1`
  - URL: `https://ai-ready-knowledge-hub-w1-mrvutsz24a-an.a.run.app`
  - Note: 組織ポリシーにより `allUsers` 公開は不可。認証付きリクエストで HTTP 200 を確認済み。

### 次にやること
- Week 2 以降のマイルストーン再調整
- Walking Skeleton (Cloud Storage + Firestore + Upload UI + Curator)
- Masker + Cloud DLP 統合
- Strategist / Interviewer と A9 export の実Context Package接続
- Knowledge Inventory UI
- Curator / Masker eval パイプライン

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

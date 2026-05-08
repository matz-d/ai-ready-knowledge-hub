# 技術スタック

## 確定構成

| 領域 | 採用技術 | 理由 |
|---|---|---|
| Frontend / Backend | **Next.js 16 (App Router)** | TypeScript統一、Server Actions/Route Handlersで素早く構築 |
| 実行環境 | **Cloud Run** | ハッカソン必須要件、Dockerfileで配信 |
| AI Framework | **Genkit (TypeScript)** | TS統一、Google公式、構造化出力 + flow + eval が揃う |
| AI Provider | **Vertex AI API (Gemini 2.5 Pro)** | 顧客機密データ前提のため (学習に使われない、リージョン固定) |
| Genkit プラグイン | `@genkit-ai/vertexai` | Vertex AI 接続用 |
| PII 検出/マスキング | **Cloud DLP + Vertex AI ハイブリッド** | 構造化PII = DLP決定論、文脈PII = Gemini推論 |
| ファイルストレージ | **Cloud Storage** | 原本保存、Cloud Run と相性良し |
| メタデータDB | **Firestore** | ドキュメント形式のメタデータ + tags。Vector Searchは将来拡張 |
| Embeddings | **Vertex AI text-embedding-005** | 将来拡張。MVPでは生成しない |
| CI/CD | **GitHub Actions** | ハッカソンテーマ「まわす」、デファクト |
| Eval | **Genkit Eval + custom** | フレームワーク標準 + カスタム指標 |
| ライセンス | **Apache 2.0** | 商用利用可、特許条項あり |

---

## なぜこの組み合わせか (主要トレードオフ)

### Next.js を選んだ理由

Next.js は「本格Webアプリ基盤」ではなく、**薄いデモUI + Cloud Run配信用の器**として採用する。

**Next.js に置くもの:**
- デモUI
- Genkit flow 呼び出しの薄い入口
- Context Package export
- Cloud Run 配信

**Next.js に置かないもの:**
- 本格認証
- 複雑な状態管理
- 重いアップロード処理
- DB設計の先行作り込み

プロダクトの知性は Genkit / Vertex AI 側に置き、Next.js は審査員に価値を伝える舞台装置として薄く保つ。詳細は [docs/decisions.md](decisions.md) の A10 を参照。

---

### Genkit を選んだ理由

**候補:**
- (a) ADK (Agents Development Kit) — Python
- (b) Vertex AI API 直接 hand-roll — TypeScript
- (c) **Genkit (TypeScript)** ← 採用
- (d) Firebase Genkit + Functions

**Genkit を選んだ理由:**
- TypeScript統一でNext.jsと相性◎
- Google公式フレームワーク = 「実装力」アピール
- Flow構造で agent workflow が見える化
- Eval機能組み込み = 「まわす」軸で活きる
- Cloud Run へ通常のNode.jsアプリとしてデプロイ可

**ADKを採用しなかった理由:**
- Python = TypeScriptと別言語、マイクロサービス分割が必要
- MVP段階で構成が重くなる
- ただし将来拡張として Agent Engine / ADK への移植可能性は README で言及

**保険プラン:**
Genkit の初期PoC (構造化出力 + Cloud Run デプロイ + 簡易eval) が **数日で通らない場合**、Gemini API直ではなく **Vertex AI API 直接呼び出し** で hand-roll に切替。

---

### Vertex AI API を選んだ理由 (Gemini API直接ではなく)

**理由:**
- 顧客機密データを扱う前提 (機密文書を扱うSME向け、初期デモは士業題材)
- Vertex AI: データを学習に使わない、リージョン固定 (asia-northeast1)、IAM権限制御
- Gemini API直接: 開発者向け、データ取り扱いが Vertex AI ほど厳密でない
- ハッカソン提出時点では、AI呼び出しは Vertex AI API に統一する

**コスト的な差:**
- Vertex AI は若干高い (per-token単価ほぼ同じだが、minimum chargesなどの差あり)
- ハッカソンスケールでは無視できる差

**README/発表資料での訴求点:**
「**顧客機密データを扱う前提でVertex AI APIを採用**」を明記 → 審査基準#2 (課題アプローチ力) と #5 (実装力) の両方で得点。

---

### Cloud DLP を選んだ理由 (openai/privacy-filter ではなく)

**比較:**

| | openai/privacy-filter | Cloud DLP |
|---|---|---|
| 言語 | Python (1.5Bパラメータ) | フルマネージドAPI |
| 主言語対応 | 英語主体 | 日本語含む多言語、**日本特化InfoType** |
| インフラ | 自前でホスト | フルマネージド |
| Google Cloud加点 | なし | あり |
| マイナンバー検出 | 不可 | `JAPAN_INDIVIDUAL_NUMBER` で標準対応 |

**Cloud DLP を選んだ理由:**
- 日本語の特殊PII (マイナンバー、健康保険証、銀行口座) に対応
- Google Cloud AI技術の追加採用 = 加点要素
- Vertex AI と組み合わせてハイブリッド検出 = 「実装力」アピール
- フルマネージドで実装速度が出る

**openai/privacy-filter の活用:**
本採用はしないが、**比較ベンチマーク** としてリポジトリに含める。
日本語マイナンバー検出率の比較データを `eval/benchmark/` に出力し、技術選定の納得度の根拠に使う。

---

### Firestore を選んだ理由

**候補:**
- (a) **Firestore** (tags中心、将来vector search対応) ← 採用
- (b) Cloud SQL / AlloyDB + pgvector
- (c) Vertex AI Vector Search

**Firestore を選んだ理由:**
- ドキュメント形式 = 文書メタデータ + tags を1箇所に持てる
- Vector Search 対応済なので将来拡張しやすい
- スケール無視でMVPに十分
- Firebase連携 (将来拡張) が楽

**注意点:**
MVPでは Vector Search と embeddings 生成は行わず、タグ検索 + LLM選定で Purpose Query の体験を作る。複雑な「ベクトル類似度 + 複合フィルタ」が必要になったら pgvector への移行検討。

---

### Next.js + Cloud Run の構成

**Cloud Run へのNext.jsデプロイ:**
- 標準的なNode.jsサーバーモード (Vercelに依存しない)
- Dockerfile に `next build` + `next start`
- Cloud Run のポートは `PORT` 環境変数を参照

**長時間処理の扱い:**
- Curator/Masker は10〜30秒かかる可能性
- Cloud Runのデフォルトタイムアウトは300秒なので、MVPでは同期で十分
- 将来的にはCloud Tasks/Pub-Subで非同期化検討

**Server Actions vs API Routes:**
- 短時間処理 (Inventory表示等) → Server Actions
- 長時間処理 (Curator/Masker) → API Routes (Server Actionsはタイムアウト制約厳しい)

---

## Google Cloud サービス利用一覧

| サービス | 用途 | 必須要件カテゴリ |
|---|---|---|
| Cloud Run | アプリ実行環境 | **必須1** |
| Vertex AI API (Gemini 2.5 Pro) | 4エージェントのLLM | **必須2** |
| Cloud DLP | PII検出/マスキング | 加点 (AI技術) |
| Cloud Storage | ファイル保存 | 加点 |
| Firestore | メタデータDB + 将来のVector Search | 加点 |
| Vertex AI text-embedding-005 | 将来の埋め込み生成 | 将来拡張 |

→ 5サービスのGoogle Cloud活用。「実装力」(審査基準#5) で「Google Cloud活用幅」を訴求できる。

---

## 関連ドキュメント

- [docs/architecture.md](architecture.md) — システム構成図
- [docs/decisions.md](decisions.md) — 意思決定の経緯
- [docs/hackathon.md](hackathon.md) — 必須要件・審査基準

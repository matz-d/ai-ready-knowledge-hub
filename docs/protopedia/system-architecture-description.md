# システム構成（Protopedia 提出用）

SME に散らばった社内文書（PDF・CSV・Google Sheets・メモ・旧版資料・暗黙知）を、**AI に安全に渡せる Context Package** へ変換する前段プラットフォームです。NotebookLM / Gemini / RAG を置き換えるのではなく、それらに投入する情報を「実務で使える粒度」と「セキュリティ観点」で準備します。全体は **Genkit（TypeScript）の 3 エージェント** を中心に、Next.js を Cloud Run に載せて構成しています。

## 全体の流れ

ユーザーは `/upload` から複数ファイルをまとめて投入します。HTTP 境界（`POST /api/documents`）は multipart の検証だけを行い、副作用の順序は **uploadOrchestrator** にすべて委ねます。orchestrator が「Cloud Storage への原本保存 → Firestore へのメタデータ作成 → Curator → 必要時 Masker」を rollback 付きで直列実行し、結果を UI に返します。文書の準備が整ったら、ユーザーは目的（例:「新人スタッフ向けに月次の給与計算業務を安全に学べる AI を作りたい」）を入力し、Strategist が Context Package を生成します。

## 3 エージェント（Genkit / Vertex AI）

**Curator** が文書を分類します（種別・業務領域・機密度・鮮度・AI 利用可否）。機密度から AI 利用方針を自動派生し、`direct`（そのまま AI 参照可）・`blocked`（AI 参照不可）・`requires_masking`（マスキングが必要）へ振り分けます。

**Masker** は `requires_masking` の文書だけを受け取り、**Cloud DLP による構造化 PII 検出**（マイナンバー・口座番号・氏名など）と **Vertex AI（Gemini）による文脈依存 PII 判定**を組み合わせてマスクし、さらにマスク後の残存リスク（特定企業・取引・個人が再識別できないか）を再評価します。

**Strategist** が目的を分解し、Inventory から候補を選び、「使える情報 / 除外すべき情報 / 足りない情報」に整理します。さらに不足領域から、暗黙知を人間から引き出すための「確認すべき質問」も Strategist が生成します。

### 中核となる逆フィードバック（図中の赤い矢印）

Masker が再識別リスクありと判断した場合、`recommendedSensitivity: "Restricted"` を返し、**Curator が付けた機密度を Restricted に格上げ**します。格上げされた文書は Strategist によって Context Package から自動除外され、本文は下流 AI に渡りません。これがエージェント同士の協調を成立させる中核的な自律判断点です。

## データ層と出力

原本は Cloud Storage（`raw/`）、AI 参照用のマスク済み本文は `masked/`（`ai_safe` のときのみ）に保存し、**GCS を正本**とします。Firestore にはメタデータと Curator / Masker の監査ブロックのみを保持し、本文そのものは持ちません（GCS パス参照とハッシュのみ）。

出力の **Context Package** は「使える情報」「除外すべき情報」「足りない情報」「人間に確認すべき質問」を明確に区別し、Markdown または **NotebookLM 用の source bundle（.zip）** としてエクスポートできます。これをそのまま NotebookLM / Gemini / RAG に投入し、根拠つきの回答を得ます。

## DevOps（まわす）

main への push で **GitHub Actions** が Cloud Run へ自動デプロイします。PR では Curator eval・conversion eval・P1-D quality gate を回し、Vitest・typecheck・masker drift チェックで抽出とマスキングの品質を継続的に検証しています。

## 技術スタック

Next.js 16（App Router）/ Cloud Run / Genkit（TypeScript）/ Vertex AI（Gemini 3.x Flash、scan-PDF OCR は Flash-Lite）/ Cloud DLP / Firestore / Cloud Storage / GitHub Actions。AI 呼び出しは、機密データを学習に使わず IAM で制御できる Vertex AI に統一しています。

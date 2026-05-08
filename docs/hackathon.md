# ハッカソン要件

## 基本情報

- **名称**: DevOps × AI Agent Hackathon 2026
- **主催**: Findy × Google Cloud Japan
- **公式ページ**: https://findy.notion.site/devops-ai-agent-hackathon-2026
- **提出プラットフォーム**: Proto Pedia

---

## テーマ (3つのコンセプト)

| キーワード | 意味 |
|---|---|
| **つくる** | Google CloudのAIを中核に、実務で役立つ独創的なAIエージェントを設計・実装する |
| **まわす** | GitHub連携やCI/CDなどDevOpsのフローを構築し、AIを継続的に改善するサイクルを体験する |
| **とどける** | Cloud Runへのデプロイを通じ、スケーラブルな環境で本番品質のプロダクトをユーザーへ届ける |

---

## スケジュール

| # | テーマ | 期間 | 備考 |
|---|---|---|---|
| ① | 参加登録 | 2026/4/27 - 7/10 | Findy Conferenceから |
| ② | チームビルディングイベント | 2026/6/7 (日) | オフライン、Findyイベントスペース |
| ③ | Boot Camp | 2026/6月 | Google Cloud Japan ハンズオン |
| ④ | **プロジェクト提出〆切** | **2026/7/10 (金) 23:59** | Proto Pedia |
| ⑤ | 一次審査 | 2026/7/13 - 7/17 | 運営事務局 |
| ⑥ | 二次審査 | 2026/7/21 - 7/24 | 外部有識者 |
| ⑦ | 受賞・決勝進出告知 | 2026/7/30 (木) | 公式サイト + Google Cloud Japan ブログ |
| ⑧ | **最終発表** | **2026/8/19 (水)** | 渋谷ストリームGoogleオフィス、決勝10チーム登壇 |
| ⑨ | アフターイベント | 2026/9月予定 | 審査員推し作品オンラインイベント |

**逆算スケジュール感**: 6月中旬までに動くMVP + デモ動画 + Proto Pedia登録、6月下旬〜7月上旬で磨き込み。

---

## 必須要件

### 【必須1】Google Cloud アプリケーション実行プロダクト
以下のいずれかを1つ以上使用:
- App Engine / GCE / GKE
- **Cloud Run** ← 本作品
- Cloud Functions
- Cloud TPU / GPU

### 【必須2】Google Cloud AI 技術
以下のいずれかを1つ以上使用:
- **Gemini Enterprise Agent Platform (旧Vertex AI)** ← 本作品
- Gemini API
- Gemma / Imagen / Agent Builder
- ADK (Agents Development Kit)
- Speech-to-Text / TTS
- Vision AI / Natural Language AI / Translation AI

### 【任意】その他の技術
Flutter, Firebase, Veo, Elasticsearch (スポンサー), 他

---

## 審査基準 (5項目)

| # | 項目 | 内容 |
|---|---|---|
| 1 | **AIエージェントが価値の中心になっているか** | 自律的な振る舞い (判断・タスク実行) があるか、"AIエージェントである必然性"があるか |
| 2 | **設定した課題へのアプローチ力** | 課題背景・対象ユーザー・提供価値の一貫性・妥当性・新規性 |
| 3 | **ユーザビリティ** | 直観的に使える機能・デザイン |
| 4 | **実用性・体験価値の魅力** | 課題解決の実用性、突き抜けた体験価値は加点 |
| 5 | **実装力** | 技術選定の納得度、拡張性、実運用への配慮 |

### 本作品の審査基準への対応

| 審査項目 | 対応 |
|---|---|
| #1 AIエージェント中心 | 4エージェント協調 (Curator/Masker/Strategist/Interviewer)、各エージェントが自律的判断 |
| #2 課題アプローチ力 | 機密文書を扱うSME向け、初期デモは士業題材、AI活用前段階という新規ポジショニング |
| #3 ユーザビリティ | Knowledge Inventory ヒートマップ、Purpose Query は自然言語入力 |
| #4 実用性・体験価値 | マスキングによる「AIに渡せない情報の参照可能化」が突き抜けた体験価値 |
| #5 実装力 | Vertex AI + Cloud DLP + Genkit + Cloud Run + GitHub Actions Curator評価パイプライン |

---

## 提出物

- **プラットフォーム**: Proto Pedia (事前アカウント作成必要)
- **〆切**: 2026年7月10日 (金) 23:59
- **応募ステップ**:
  1. ハッカソン参加申し込み
  2. 作品をつくって Proto Pedia に登録
  3. 作品提出フォームから最終応募

---

## 関連ドキュメント

- [docs/concept.md](concept.md) — プロダクトコンセプト
- [docs/architecture.md](architecture.md) — 技術構成
- [docs/decisions.md](decisions.md) — 意思決定ログ

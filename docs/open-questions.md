# 未決定事項

次に再開する時、ここから議論を始める。

---

## R4: Knowledge Inventory のビジュアル形式

**決定**: ヒートマップ (業務領域 × 文書種別)

**決定理由:**
- このビジュアルは作品の「視覚的アイコン」になる = デモ動画のサムネイルにもなる重要要素
- SMEの「うちの情報、こんなに偏ってたんだ」体験が一番出る
- x軸/y軸ラベルがそのままCurator分類体系になる

**次のアクション:** Curator分類体系 (R5) の enum を確定。

---

## R5: Curator 分類体系の最終確定

**仮置き**: 以下の6項目
- 文書種別 (契約書、テンプレ、案内文、メモ、表 etc)
- 業務領域 (給与計算、年末調整、就業規則、契約 etc)
- 機密度 (Public / Internal / Confidential / Restricted)
- 鮮度 (現行 / 旧版候補)
- 正本候補 (重複候補のフラグ)
- AI参照可否 (機密度から自動派生)

**未確定の理由:**
- 各カテゴリの enum 値の最終リストが未定
- Inventoryヒートマップに表示する単位として、業務領域と文書種別の粒度を決める必要がある

**例: 業務領域の enum 候補 (初期デモ向け)**
- 顧問契約管理
- 給与計算
- 年末調整
- 就業規則
- 助成金相談
- 顧客対応
- 法改正対応
- 社内手順
- 教育・研修
- その他

**次のアクション:** enum を確定。

---

## R9: 2ヶ月マイルストーン

**全体ゴール (仮置き):**
- 6月中旬: 動くMVP + デモ動画 + Proto Pedia登録
- 6月下旬-7月上旬: 磨き込み

---

### Week 1 (5/5-5/11) — 確定

**位置付け: 「実装完成」ではなく「技術リスク検証」**

残り3日 (5/9・5/10・5/11) で、Vertex AI / Genkit / Cloud Run / A8 / A9 の **実装可能性を確認** することがゴール。Cloud Storage / Firestore / DLP / Upload UI / Inventory UI / eval は Week 2 以降に回す。

**到達点:**

| # | 検証項目 | 成果物 |
|---|---|---|
| W1-1 | Genkit + Vertex AI で structured output が返る | Genkit flow が JSON schema 準拠の出力を返すミニ実装 |
| W1-2 | A8 residualRisk 判定が動く | mock maskedContent を入力に、Vertex AI が `{detected, recommendedSensitivity, reason}` JSON を返す |
| W1-3 | A9 Markdown export が動く | mock Context Package を入力に、`exportContextPackage.ts` が Package Manifest + Instructions + AI-Ready Sources の Markdown を生成 |
| W1-4 | Next.js 最小アプリが Cloud Run にデプロイできる | "Hello" レベルの Next.js が Cloud Run URL でアクセス可能 |

**Week 1 で意図的にやらないこと:**
- Cloud Storage バケット作成・接続
- Firestore スキーマ実装・接続
- Cloud DLP 統合
- ファイルアップロード UI
- Knowledge Inventory UI
- Curator/Masker eval パイプライン

**理由:**
これらは「未知数の少ない作業」(=実装すれば動くと分かっている)。先に未知数の多い Vertex AI API / Genkit / A8/A9 設計の検証を済ませることで、Week 2 以降に詰まるリスクを減らす。

---

### Week 2 以降 (5/12-7/10) — 仮置き、要再調整

Week 1 を「技術リスク検証」に絞ったため、Walking Skeleton の構築は Week 2 に移動。下記は元の仮置きで、**Week 1 終了時 (5/11) に再調整する**。

| 週 | 期間 | マイルストーン (仮置き) |
|---|---|---|
| Week 2 | 5/12-5/18 | Walking Skeleton (Cloud Storage + Firestore + Upload UI + Curator) |
| Week 3 | 5/19-5/25 | Masker + Cloud DLP 統合、A8 逆feedback を実データに繋ぎ込み |
| Week 4 | 5/26-6/1 | Strategist + Interviewer 実装、A9 を実Context Packageに繋ぎ込み |
| Week 5 | 6/2-6/8 | Knowledge Inventory UI、Purpose Query UI |
| Week 6 | 6/9-6/15 | Curator評価パイプライン、サンプルデータ整備 |
| Week 7 | 6/16-6/22 | デモ動画撮影・編集、Proto Pedia登録 |
| Week 8 | 6/23-6/29 | 磨き込み、UIブラッシュアップ |
| Week 9 | 6/30-7/6 | バグ修正、ドキュメント整備 |
| Week 10 | 7/7-7/10 | 最終調整、提出 |

**次のアクション:** Week 1 終了時 (5/11) に Week 2 以降を再調整。

---

## 進め方の選択 (前回保留)

**選択肢A**: 即PoC開始 (R5/R9 は実装と並行で詰める)
**選択肢B**: R5/R9 を先に確定してから PoC

**前回の推奨**: A
- ハッカソンの2ヶ月制約 + Genkit/DLPの未知数を考えると、技術リスクを最速で潰す方が有利
- R4 はヒートマップで確定、R9 は次回叩き台を出す前提

**次のアクション:** 進め方の最終確認。

---

## 細かい未決定事項

### Genkit 設定の詳細
- Cloud Run へのデプロイ方式 (Next.js統合 vs 別Cloud Run)
- Genkit Flow の Server Action からの呼び出し方
- 環境変数 (Vertex AIプロジェクトID、リージョン等) の管理

### Cloud Storage バケット設計
- 単一バケット vs 環境別バケット
- ライフサイクルポリシー (検証用は短期削除?)

### Firestore スキーマ
- documents コレクションの詳細フィールド
- ai_safe_versions サブコレクションの構造
- vector index はMVPでは作らない (将来拡張)

### CI/CD認証
- Workload Identity Federation の設定
- GitHub Secrets の管理範囲
- Cloud Run サービスアカウントの権限

### サンプルデータの中身

**確定済み (scope.md `サンプルデータ方針` および `sample-data/README.md` 参照):**
- ファイル数: 全10ファイル (3ペア×2 + 単体4件) — 作成済み
- ペア構造: 顧問契約書 / 顧客対応メモ / 給与計算 の3ペアで、それぞれ異なるエージェント挙動を担当
- 単体: 就業規則テンプレート、年末調整案内文、料金表(現行+旧版)
- 個人情報の演出: 顧問契約書_実案件サンプルにのみ集中させ、架空の社名・人名・住所・電話 (XXXX形式) を埋め込み済み
- 旧版料金表との差分: 約10%値上げ + 「法改正対応含む」「軽微な改定」の文言追加
- 各実案件版の発火想定ルール: R1/R2/R6 (顧問契約書実案件), S2 (顧客対応メモ匿名化), Strategist不足質問 (給与計算例外メモ) — `sample-data/README.md` に表で整理

**残未決:**
- ground truth ラベルファイル (`eval/expected-labels.json`) の作成 — D-3 で対応予定
- 各ファイルが Curator 評価で期待される機密度・業務領域・文書種別ラベルの確定

### eval ground truth の作り方
- 手動アノテーション vs Geminiで生成→手動修正
- ラベルの粒度

---

## 関連ドキュメント

- [docs/decisions.md](decisions.md) — 確定事項
- [docs/architecture.md](architecture.md) — 技術構成
- [docs/concept.md](concept.md) — プロダクトコンセプト

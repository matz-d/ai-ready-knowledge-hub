# MVPスコープ

## MVPの成功条件

3分デモで「散らばった機密文書が、AIに渡せるContext Packageへ変換される」ことが伝わる状態を作る。

実装の優先順位は以下:

1. **Walking Skeleton**: ファイル投入 → Curator分類 → 結果表示 → Cloud Run デプロイ
2. **Masker Demo**: Confidential文書のマスク済みAI参照版を生成し、原本との差分を見せる
3. **Purpose Query**: 目的入力 → Context Package + 不足質問を生成
4. **Knowledge Inventory**: ヒートマップで文書分布を見せる
5. **DevOps**: Cloud Run自動デプロイ + Curator分類の簡易評価をGitHub Actionsで回す

---

## やること (確定版)

1. text / markdown / CSV / テキスト抽出済みPDF のアップロード
2. Cloud Storage への保存
3. Firestore への文書メタデータ保存
4. **Curator Agent** による自動分類
   - 文書種別
   - 業務領域
   - 機密度
   - 鮮度
   - AI利用方針
   - 重複/旧版候補フラグ
5. **Masker Agent** によるデモ対象文書のマスキング
   - MVPでは text / markdown / CSV / 抽出済みテキストを対象
   - Cloud DLP + Vertex AI のハイブリッド方針は維持
   - 位置情報の厳密な評価より、原本 → AI参照版の変換体験を優先
   - **残存リスク判定 (A8)**: マスク後の文章を Vertex AI で再評価し、再識別リスクが残る場合は `recommendedSensitivity: "Restricted"` を返す
6. Firestore への原本版 + AI参照版メタデータ保存
   - **逆feedback (A8)**: `recommendedSensitivity === "Restricted"` の場合、文書 metadata の機密度を Restricted に格上げ
7. **Knowledge Inventory** 画面
   - ヒートマップ (業務領域 × 文書種別) で確定
   - Restricted 格上げ済み文書は専用バッジ表示
8. **Purpose Query** 入力UI
9. **Strategist Agent** による AI-ready Context Package 生成
   - 使える情報
   - 除外すべき情報 (Masker による Restricted 格上げ済みを含む)
   - 足りない情報
   - 確認質問
10. **Export Context Package (A9)**
    - Purpose Query 実行後、選ばれた文書セットだけを Markdown 形式でダウンロード可能にする
    - Package Manifest + Instructions + Full AI-Ready Sources の構成で出力
    - 採用文書のAI参照版本文は省略せず含める
    - NotebookLM / Gemini / Codex / RAG に貼り付けられる成果物を出力
11. GitHub Actions による Cloud Run デプロイ + **Curator簡易評価**

---

## MVPで削ること (今回確定)

| 項目 | MVPでの扱い | 理由 |
|---|---|---|
| Firestore Vector Search | やらない。タグ検索 + LLM選定で代替 | Purpose Queryの体験はタグとサンプル文書で十分出せる |
| Embeddings生成 | やらない | Vector Searchを削るため不要 |
| Maskerの厳密な位置評価 | やらない | デモでは変換体験が主役。precision/recallは後回し |
| Masker eval CI | やらない | 初期はCurator評価に集中し、「まわす」を軽量に見せる |
| Strategist A/B評価 | やらない | 複雑度が高く、デモ価値に直結しない |
| PDF本格解析 | やらない。テキスト抽出済みPDFまたは簡易抽出まで | OCRやレイアウト解析で時間を溶かさない |
| 画像PDF OCR | やらない | Cloud Vision等は将来拡張 |
| Interviewer独立実装 | 実装上はStrategist flow内の質問生成でよい | 画面上の体験を優先し、内部構成を軽くする |
| Evalダッシュボード | やらない。CIログ/PRコメントで十分 | UI実装コストを削る |
| `openai/privacy-filter` 比較ベンチマーク | 後回し | 発表の補強材料だがMVPの中核ではない |
| Live大量処理デモ | やらない。少数サンプルの実行経路と投入済みデータ状態で見せる | 3分デモでは安定性を優先。通常UIは固定fixtureを読ませない |

---

## やらないこと (明示的スコープアウト)

| 項目 | 理由 |
|---|---|
| Google Drive OAuth 本格連携 | 認証実装で時間溶ける |
| NotebookLM代替のRAGチャットUI | 本作品の独自性 (前段) が薄まる |
| Drive 全体クロール | スコープ大、SME向けでない |
| 自動ファイル移動 | 副作用が読めない |
| マルチユーザ認証 | デモ用は単一ユーザで十分 |
| 本格 OCR (画像PDF) | 沼る、Cloud Vision呼ぶなら別途検討 |
| 音声 / 動画対応 | スコープ外 |
| 複雑な権限管理 | 単一ユーザ前提 |
| Strategist の A/B 評価 | Curator評価で十分、複雑度爆発を避ける |
| Vertex AI Agent Engine 本番デプロイ | Cloud Run で十分、Agent Engine は将来拡張 |
| 永続化の本気設計 | デモ後にデータ消えてOK前提 |
| Firestore Vector Search | MVPではタグ検索 + LLM選定で十分 |
| Embeddings生成 | MVPでは不要 |
| Masker eval / PII precision-recall | Curator評価を優先 |
| Evalダッシュボード | CIログ/PRコメントで十分 |

---

## サンプルデータ方針

- **完全フィクション** (架空の事務所名・架空の顧客名・架空の番号類)
- README に「サンプルは全て架空」と明記
- Curator が「個人情報あり」と検出するデモ用に、**意図的に個人情報っぽい架空データを混ぜる**

### ペア構造の設計方針

「テンプレ版」と「実案件版」を **3ペアに限定して** 用意する。
目的は **「テンプレと実案件の違いがエージェントの判定を変える」ことを見せる** ことであり、ペア構造を全文書に網羅することではない。
それ以外の文書は単体サンプルとして配置する。

各ペアは異なるエージェントの異なる挙動を担当する:

| ペア | テンプレ版 | 実案件版 | 担当エージェントの挙動 |
|---|---|---|---|
| ペア1 | 顧問契約書テンプレ.md | 顧問契約書_実案件サンプル.txt | **Masker → Curator 逆feedback**: マスクしても再識別リスクが残るため、実案件版だけ Restricted に格上げ |
| ペア2 | 顧客対応メモ_書式.md | 顧客対応メモ_匿名化.txt | **Masker 通常マスク**: 実案件版はマスク後 AI-safe として AI参照版を保持 |
| ペア3 | 給与計算チェックリスト.md | 給与計算_例外対応メモ.txt | **Strategist 不足知識検出**: 実案件版は使えるが、Strategist が不足知識・確認質問を出す |

### サンプル想定構成

```
sample-data/
  accounting-office/
    顧問契約書テンプレ.md              # ペア1 テンプレ版
    顧問契約書_実案件サンプル.txt        # ペア1 実案件版 → Restricted 格上げ
    顧客対応メモ_書式.md               # ペア2 テンプレ版
    顧客対応メモ_匿名化.txt             # ペア2 実案件版 → AI参照版を保持
    給与計算チェックリスト.md           # ペア3 テンプレ版
    給与計算_例外対応メモ.txt           # ペア3 実案件版 → 不足質問を誘発
    就業規則テンプレート.md             # 単体
    年末調整_案内文.txt                # 単体
    料金表_2026.csv                  # 単体
    古い料金表_2023.csv               # 単体 (鮮度=旧版候補のデモ)
```

---

## 比較ベンチマーク (将来拡張)

`openai/privacy-filter` (英語PII検出OSS) と日本語マイナンバー検出率を比較し、Cloud DLP + Vertex AI ハイブリッドの優位性を示すデータを `eval/` 配下に置く。

これは「技術選定の納得度」(審査基準#5 実装力) を高めるための材料。ただしMVPでは後回しにし、デモ体験とCurator簡易評価を優先する。

---

## 関連ドキュメント

- [docs/concept.md](concept.md) — プロダクトコンセプト
- [docs/architecture.md](architecture.md) — 技術構成
- [docs/open-questions.md](open-questions.md) — 未決定事項

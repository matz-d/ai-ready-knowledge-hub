# 3分デモシナリオ

> この文書は動画デモのストーリーボードです。実行手順は [docs/demo-runbook.md](demo-runbook.md) を参照してください。

## 主役

**Purpose Query** (Strategist Agent の知性)

- Auto Mapping (Curator) は導入演出
- Human Completion (Interviewer) は結果として出す位置づけ
- Phase 3-E では「この目的でAIに渡してよい理由を説明できる」ことを主役にする

---

## デモ動画構成 (3分編集前提)

| 秒数 | シーン | 見せたいもの |
|---|---|---|
| 0:00-0:15 | 課題提起 | 機密文書を扱うSMEの散らばった文書の山 (デモ題材は士業事務所) |
| 0:15-0:40 | Dump → Curator | ファイルを投入、自動分類が走る (Pre-processed可) |
| 0:40-1:05 | Knowledge Inventory | ヒートマップで「うちの情報、こんなに偏ってたんだ」 |
| 1:05-1:20 | cloud-managed + Cloud DLP + Masker | 標準 profile では管理されたクラウド境界で受け取り、個人情報を安全化してからAI参照版を作る |
| 1:20-1:35 | **Masker→Curator 逆feedback (A8)** | **顧問契約書を Masker が「マスク後も特定され得る」と判定 → Restricted に格上げ → AIに渡さない理由が残る瞬間** |
| 1:35-2:15 | Purpose Query | 「新人スタッフ向けに給与計算業務を学べるAIを作りたい」と入力 |
| 2:15-2:40 | Strategist の出力 | 使える情報 / 除外すべき情報 / 足りない情報 / 質問リスト。各判断を目的に結びつけて見せる |
| 2:40-3:00 | **クロージング + Export (A9)** | **Context Package を export → purpose binding が残る → NotebookLM / Gemini / RAG に渡す前段が完成** |

---

## デモシナリオ詳細

### 初期デモの想定企業
従業員12名の会計・社労士合同事務所

この題材は、機密文書と暗黙知を多く持つSMEの代表例として使う。税務・労務などの専門判断をAIが代替するのではなく、AIに渡す前の文書分類、マスキング、Context Package化、不足情報の質問化を見せる。

Phase 3-E の説明では、標準 profile は `cloud-managed` として扱う。つまり、SMEが文書をアップロードすると、管理されたクラウド境界で分類・構造化し、Cloud DLP + Masker で安全化してから、目的に合う情報だけを Context Package にまとめる。将来の高セキュリティ profile である `cloud-sanitized-ingress` は「顧客側でサニタイズしてから送る選択肢も設計済み」程度に短く触れ、今回のデモの中心には置かない。

### 想定の悩み
- 顧問契約、給与計算、年末調整、就業規則、助成金相談、顧客対応メモ等がPDF/CSV/Excel/テンプレート/個人メモに散らばっている
- GeminiやNotebookLMを使いたいが、どの情報を入れてよいか分からない
- 古い料金表や過去の顧客メモも混在
- 担当者ごとの暗黙知も多い

### デモの流れ (詳細)

**1. 雑多な資料を Dump Box へ投入**
契約書、料金表、給与計算チェックリスト、就業規則テンプレ、年末調整案内、顧客対応メモ、古い資料など。

**2. Curator Agent が自動分類**
- 文書種別 (契約書、テンプレ、案内文、メモ、表 etc)
- 業務領域 (給与計算、年末調整、就業規則、契約 etc)
- 機密度 (Public / Internal / Confidential / Restricted)
- 鮮度 (現行 / 旧版候補)
- 正本候補 (重複候補のフラグ)
- AI利用方針 (direct / requires_masking / blocked)

**3. Masker Agent が機密文書をマスキング**
顧客名簿の個人名・マイナンバー・住所が Cloud DLP + Masker でマスクされ、AI参照版として保存される。

> ナレーション例: 「標準の cloud-managed profile では、文書を管理されたクラウド境界で受け取り、AIに渡す前に個人情報と再識別リスクを落とします。」

**3.5. Masker が Curator の判定を覆す (逆feedback / A8)**
顧問契約書については、Masker がマスキング後の文章を Vertex AI で再評価し、「特定顧客との契約条件が再識別可能」という残存リスクを検出する。
Masker は `recommendedSensitivity: "Restricted"` を返し、Curator が管理する文書 metadata の機密度を `Confidential` から `Restricted` に格上げする。
UI では当該文書カードに赤いバッジが付き、`ai_safe_version` は生成されず、以降の Strategist 処理から自動除外される。

> ナレーション例: 「マスクで渡せる情報もあれば、マスクしても渡せない情報もあります。この文書は、AIに渡さない理由まで残します。」

このシーンは作品の Agent性を一番明確に見せる山場。直列パイプラインではなく、エージェント間の協調と権限委譲が起きていることを伝える。

**4. Knowledge Inventory を表示**
ヒートマップで業務領域 × 文書種別の分布を可視化。「税務領域に古い資料が偏ってる」が一目で分かる。

**5. ユーザが目的を入力**
> 「新人スタッフ向けに、給与計算業務を学べるAIを作りたい」

**6. Strategist Agent が AI-ready Context Package を生成**
- **使える情報** : 給与計算チェックリスト (現行版)、就業規則テンプレ、年末調整案内文
- **除外すべき情報** : 古い料金表、顧客固有のメモ、マスク後も危険な契約書
- **足りない情報** : 例外処理ケース、過去のトラブル事例
- **確認質問** (Interviewer Agent から):
  - 「給与計算で必ず先輩確認が必要な条件は何ですか?」
  - 「顧客ごとに例外処理が発生するパターンは何ですか?」
  - 「法改正時にどの資料を正本として更新しますか?」

ここでは「この目的なら使える」「この目的でも渡せない」「この目的にはまだ足りない」という目的単位の説明に寄せる。技術的な内部名より、担当者が上司や顧客に説明できる判断結果として見せる。

**7. Export Context Package**
Purpose Query に対して選ばれた文書セットだけを Markdown で出力する。冒頭に Package Manifest と下流AI向けInstructionsを置き、採用文書のAI参照版本文は `Full AI-Ready Sources` に省略せず含める。Restricted文書や旧版候補の本文は含めず、除外理由だけを残す。Context Package には purpose binding が残るため、「どの目的でこの情報セットをAIに渡したのか」を後から説明できる。

---

## 重要な演出ポイント

### Pre-processed mode の活用
- 50ファイルを実時間で処理するとデモ尺で苦しい
- 事前にCurator結果を流し込んだデモ用データ状態を用意する場合でも、通常 UI は固定 fixture を読まない
- W1 の実 LLM 出力は `docs/w1-artifacts/inventory.snapshot.json` に回顧用 artifact として残す
- デモ動画は実 Firestore / API 経路に投入済みの状態から開始できるようにする
- ただし「Live mode」も用意 (Proto Pediaで判定者が触る場合)

### マスキングの見せ方
- 「機密で渡せない」→「マスクで渡せる」の変化を視覚的に
- 顧客名簿の人名が `[REDACTED:PERSON_NAME]` などに置換される瞬間を見せる
- 「この目的ならAIに渡せる状態になりました」のメッセージを添える
- Cloud DLP や Masker の名前は短く出し、説明は「個人情報を落とす」「マスク後も危ないものは止める」に寄せる

### 逆feedback の見せ方 (A8)
- マスク済みプレビュー画面に Masker のコメントを吹き出しで表示する: 「マスク後も特定顧客との契約条件が再識別可能です」
- Curator の機密度バッジが `Confidential` (黄) から `Restricted` (赤) に **アニメーションで切り替わる** カットを入れる
- バッジの隣に `Promoted by Masker` の小さなラベルを置き、Curator 単体ではなく Masker からの提案で格上げされたことを明示する
- 「変換する。でも危険なら止める」というキャプションを添えると物語が締まる

### Purpose Query の知性を強調
- 「使える情報」だけでなく「足りない情報」を出すのが肝
- 「確認質問」が出ることで、人間との協業感を演出
- Strategist の判断理由を短く可視化 (「これを使う理由」を表示。内部推論そのものは出さない)
- Excluded セクションに Restricted 文書を `Status: Restricted / human review only` として並べる。これにより A8 の逆feedback の結果が Strategist の出力にも引き継がれていることが視覚的に伝わる
- purpose binding を「このAIの用途に対する利用根拠」として見せる。監査用語として深掘りしすぎず、「あとから説明できる」ことを強調する

### Export の見せ方 (A9)
- `[Export as Markdown]` ボタンをクリック → `.md` ファイルがダウンロード
- ダウンロードした `.md` をエディタで開いて全体構造を見せる: `Package Manifest` → purpose → `Instructions for Downstream AI` → `Included Documents` → `Excluded Documents` → `Full AI-Ready Sources`
- そのまま NotebookLM の `Add source` 領域にドラッグするカット (実 NotebookLM 画面でも、モックUIでも可)。Gemini や RAG に渡す場合も同じ前段成果物だと一言添える
- キャプション: 「AIに渡す前に、使う理由と除外する理由が揃いました」
- このシーンを最後に置くことで、「前段プラットフォーム」の主張が物理的に成立した状態でデモを閉じる

---

## NG演出 (避けるべき)

- NotebookLMやGeminiの代替に見せる演出 (本作品は前段)
- RAGチャットの実演 (今回スコープ外)
- 税務・労務などの専門判断をAIが代替するように見せる演出
- 複雑な技術用語の連発 (機密文書を扱うSMEの経営者目線で説明する)

---

## 関連ドキュメント

- [docs/concept.md](concept.md) — プロダクトコンセプト
- [docs/scope.md](scope.md) — MVPスコープ

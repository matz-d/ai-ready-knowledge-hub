# 意思決定ログ

すべての決定について、**何を選んだか・なぜか・代替案・撤退条件** を残す。

---

## D1: エージェント実装方針

**決定**: Genkit (TypeScript) + Vertex AI API

**代替案:**
- (a) ADK (Python) + Next.js (TypeScript) のマイクロサービス
- (b) Vertex AI API 直接呼び出しで TypeScript hand-roll
- (c) **Genkit (TypeScript)** ← 採用

**選定理由:**
- 本作品に必要なのは本格マルチエージェント基盤ではなく、機密文書を扱うSMEの雑多情報を読み取り意味づけし目的に応じてContext Packageを生成する **体験**
- TypeScript統一で開発速度が出る
- Google公式 + flowベース = 「agentic workflow」と「まわす」の説明力が出る
- Eval機能組み込み

**撤退条件 (保険プラン):**
Genkit初期PoC (構造化出力 + Cloud Runデプロイ + 簡易eval) が **数日で通らない場合**、Gemini API直ではなく (b) Vertex AI API hand-roll に切替。

**やらない判断:**
ADKは本採用しない。ただしREADMEで「将来拡張として ADK / Agent Engine に載せ替え可能な構成」と言及してよい。

---

## D2: 「まわす」の見せ方

**決定**: CI/CD + **Curator評価パイプライン**

**代替案:**
- (a) CI/CDのみ
- (b) **CI/CD + Curator評価パイプライン** ← 採用
- (c) (b) + Strategist の A/B 評価

**選定理由:**
- (a) では「まわす」軸で差別化できない (誰でもやる)
- (c) はMVPには複雑すぎる
- (b) はAIの分類品質を継続評価する仕組み = ハッカソン作品では稀
- 評価対象は Curator の6項目 (文書種別/業務領域/機密度/鮮度/AI参照可否/正本候補)

**追加:**
Maskerの評価 (PII検出 precision/recall) もこのパイプラインに乗せる。

---

## D3: チーム構成

**決定**: 個人開発前提

**理由:**
- コンセプトが思想寄り、M-Grow AI事業資産にも直結
- チーム化は方向性すり合わせコストが利益を上回る

**例外:**
- チームビルディングイベント (2026/6/7) には参加してよい
- そこで良い相手がいれば **役割を限定** して組むのはあり (UI/デザイン担当 or Google Cloud / DevOps補助)
- **コンセプト設計・プロダクト方針は他人に渡さない**

---

## D4: ターゲットとデモシナリオの業界設定

**決定**: ターゲットは「機密文書と暗黙知を多く持つSME」。初期デモ題材は士業 (会計事務所・社労士事務所)。

**選定理由:**
- 士業の専門判断を解くのではなく、AI活用前の文書分類・マスキング・Context Package化を解く
- デモ題材を士業にすると、機密文書と暗黙知が混在する状況を短時間で伝えやすい
- M-Grow AI営業資産に転用可能
- 紙・PDF・Excel・テンプレ・暗黙知が混在しやすい = コンセプトが伝わりやすい
- 機密情報の塊 = マスキング機能の価値が直感的
- 審査員が業界をイメージしやすい

**代替案として検討したもの:**
- (a) 街の不動産屋
- (b) 中小製造業
- (c) 飲食チェーン本部
- (d) **機密文書を扱うSME、初期デモは士業 (会計事務所/社労士)** ← 採用

**初期デモの想定企業:**
従業員12名の会計・社労士合同事務所

**やらない判断:**
- 税務判断、労務判断、法的助言の自動化はしない
- 給与計算や年末調整の正解判定はしない
- 専門業務そのものではなく、AIに渡す前の情報整理・変換・不足確認に集中する

**3分デモ主役:**
Purpose Query (Strategist の知性)

---

## D5: 命名・初期コミット範囲・ライセンス

**リポジトリ名**: `ai-ready-knowledge-hub`

**プロダクト名**: AI-Ready Knowledge Hub

**サブコピー**: SMEの散らばった情報を、AIが使える会社の記憶に変える。

**ハッカソン説明文:**
> AI-Ready Knowledge Hub は、機密文書を扱うSMEのPDF・CSV・メモ・テンプレートなどの雑多な情報を一箇所に集約し、AIが自動で分類・意味マッピングするエージェントです。さらに目的を入力すると、Gemini / NotebookLM / Codex / RAG に渡すべき情報セット、不足している暗黙知、人間に確認すべき質問を生成し、AI活用前のContext Packageを作成します。初期デモでは、会計・社労士事務所を題材にします。

**ライセンス**: Apache-2.0

**初期コミット範囲 (予定):**
```
README.md
LICENSE
.gitignore
Dockerfile
.github/workflows/deploy.yml
.github/workflows/eval.yml
docs/architecture.md
docs/demo-scenario.md
sample-data/accounting-office/
eval/expected-labels.json
eval/run-curator-eval.ts
src/
```

---

## 追加判断 (D1-D5の議論後に発生したもの)

### A1: AI Provider — Gemini API直接 → **Vertex AI API** へ変更

**理由:** 顧客機密データを扱う前提のため。
- Vertex AI = データを学習に使わない、リージョン固定 (asia-northeast1)、IAM権限制御
- Genkit プラグイン: `@genkit-ai/googleai` → `@genkit-ai/vertexai` に変更
- ハッカソン提出時点では AI 呼び出しを Vertex AI API に統一する
- READMEで「顧客機密データを扱う前提でVertex AI API採用」を明記 → 審査基準#2/#5 で得点

### A2: PII検出 — `openai/privacy-filter` 検討 → **Cloud DLP + Vertex AI ハイブリッド** 採用

**理由:**
- `openai/privacy-filter` は英語主体、日本語マイナンバー類は不対応
- Python実装でTypeScriptスタックと不整合
- Cloud DLP は日本特化InfoType (`JAPAN_INDIVIDUAL_NUMBER` 等) を持ち、フルマネージド
- Vertex AI と組み合わせて二段検出 = 構造化PII (DLP決定論) + 文脈PII (Gemini推論)
- Google Cloud AI技術の追加採用 = 加点

**`openai/privacy-filter` の扱い:**
本採用はしないが、**比較ベンチマーク** としてリポジトリに含める。日本語マイナンバー検出率の比較データを発表資料の根拠に使う。

### A3: マスキング設計の格上げ — 「AI参照可否 (binary)」 → **「マスキングで参照可能化」**

**Before:**
```
機密度判定 → AI参照可否 (binary) → 「使える」or「使えない」
```

**After:**
```
機密度判定 → マスキング処理 → 「マスク前=人間用」「マスク後=AI参照可能」
```

**意味:**
- 「整理する」プロダクトから「変換する」プロダクトへ
- 元は渡せなかった情報も、マスクで渡せる形に変わる
- 「AI活用したいけど機密情報が壁」というSMEの代表的悩みに直接的な解
- エージェントが3体 → **4体 (Masker追加)** に進化
- 機密度4段階のうち `Confidential` を「Masker で変換 → 参照可」に再定義

**新しい機密度設計:**
| レベル | 例 | AI参照 |
|---|---|---|
| Public | 営業資料、料金表 | そのまま参照可 |
| Internal | 業務手順、教育資料 | 社内のみ参照可 |
| **Confidential** | 顧客名簿、契約書 | **Maskerで変換 → 参照可** |
| Restricted | 個人情報の核心、契約秘密の詳細 | マスクしても危険、人間のみ |

### A4: デモ尺対応 — 編集前提

**判断:** デモ動画は3分編集前提。Live mode/Pre-processed modeの2モード分岐は **デモ動画演出としては不要**。

**ただし残す機能:**
Proto Pediaで判定者がブラウザで触る場合に備え、**Pre-processed状態の自動投入endpoint** は実装。「Demo初期化 endpoint」として用意 (5分で書ける)。

### A5: 重複/旧版判定スコープ

**判断:** Curator単体での「正本確定」は精度が出にくいため、**MVPでは「重複/旧版候補をフラグ立てて並べる」までで止める**。正本確定はユーザの選択に委ねる。

これにより「Curatorが提案 → ユーザが確定」というhuman-in-the-loopが見え、agent性のアピールにも繋がる。

### A6: サンプルデータ方針

**判断:** **完全フィクション** (架空の事務所名・架空の顧客名・架空の番号類) で統一。READMEに「サンプルは全て架空」を明記。

Curatorが「個人情報あり」と検出するデモ用に、**意図的に個人情報っぽい架空データを混ぜる**。

### A7: MVP削減版の確定

**判断:** MVPは「3分デモで価値が伝わる最小構成」に絞る。

**やること:**
- ファイル投入 → Curator分類 → 結果表示 → Cloud Run デプロイの Walking Skeleton
- Confidential文書のマスク済みAI参照版生成
- Purpose Query から Context Package と確認質問を生成
- Knowledge Inventory はヒートマップ (業務領域 × 文書種別) で確定
- GitHub Actions は Cloud Run デプロイ + Curator簡易評価まで

**MVPで削ること:**
- Firestore Vector Search
- Embeddings生成
- Masker eval / PII precision-recall
- PDF本格解析 / 画像PDF OCR
- Interviewerの独立実装 (内部的にはStrategist flow内の質問生成でよい)
- Evalダッシュボード
- `openai/privacy-filter` 比較ベンチマーク
- Live大量処理デモ

**理由:**
- デモ価値は「分類」「マスキングでAI参照可能化」「目的に応じたContext Package生成」に集中している
- Vector Searchや厳密evalは実装力の補強にはなるが、初期MVPの体験価値には直結しない
- 個人開発では、技術リスクを早く潰しながらデモ可能な縦sliceを完成させる方が勝率が高い

**将来拡張として残すもの:**
- Firestore Vector Search + Vertex AI embeddings
- MaskerのPII位置評価
- `openai/privacy-filter` との比較ベンチマーク
- Interviewerの複数ラウンド対話
- OCR / Drive連携 / 権限管理

### A8: Agent性の押し込み — Masker→Curator 逆feedback

**判断:** 4エージェントが直列パイプラインに見えるリスクを回避するため、**Masker が Curator の機密度判定を覆す権限を持つ** 設計を採用する。

**Before (直列):**
```
Curator (機密度=Confidential) → Masker (マスク済み版を生成) → Strategist (使える)
```

**After (逆feedback):**
```
Curator (機密度=Confidential) → Masker (マスク後も残存リスクあり) →
  ↑ 機密度を Restricted に格上げ
Curator (再判定 = Restricted) → Strategist (除外、人間確認が必要)
```

**Masker出力の拡張:**
```ts
type MaskerOutput = {
  maskedContent: string;
  maskedSpans: Array<{ start: number; end: number; type: string }>;
  residualRisk: {
    detected: boolean;
    reasons: string[]; // 例: "顧客固有の契約条件が再識別可能"
  };
  recommendedSensitivity: "Confidential" | "Restricted";
};
```

`recommendedSensitivity === "Restricted"` の場合、Firestore の文書 metadata を `Restricted` に更新し、Strategist は当該文書を Context Package から自動除外する。

**選定理由:**
- 審査基準#1 (agent性) で「自律的判断 + エージェント間協調」を見せられる唯一の構造的演出
- 作品の物語「変換する / でも危険なら止める」と一致
- 「マスクしても渡せない (Restricted)」レベルが UI 上で発生する瞬間を作れる = デモ動画の山場が増える
- Maskerが「拒否」する権限を持つことで、作品の倫理性・信頼性の演出にもなる

**代替案として検討したもの:**
- (a) Strategist↔Interviewer 閉ループ (情報不足→質問→回答→再評価) — 普通のAI対話に見える
- (b) Curator確信度ベース分岐 (確信度低→Masker保守起動) — 地味、デモ映えしない
- (c) **Masker→Curator 逆feedback** ← 採用

**MVPスコープ:**
- residualRisk 判定は Vertex AI (Gemini) のプロンプト1段で実現
- 判定基準は Masker内部プロンプトに記載 (例: 「マスク後の文章で特定企業・特定取引が再識別可能か」を Gemini に判定させる)
- 厳密な precision/recall 評価は将来拡張 (A7と整合)

**やらない判断:**
- 多段の循環フィードバック (Masker→Curator→Masker→...) はやらない。1往復のみ
- `recommendedSensitivity` を Curator が拒否する逆権限は持たせない (権限はMasker側に集約)

**残存リスク判定プロンプト (TODO: 仕上げ要):**

`src/agents/masker.ts` 内で Vertex AI (Gemini 2.5 Pro) に投げる判定プロンプトの骨組み。
判定の中核ロジック (どういう条件で「再識別可能」と判定するか) は本作品の精度を直接決めるため、
ここで明文化しておく。

```ts
const RESIDUAL_RISK_PROMPT = `
あなたは士業事務所の機密文書レビュアーです。
以下のマスク済みテキストを読み、AIに渡した場合に
特定の企業・個人・取引が再識別される可能性があるかを判定してください。

# 入力
- 元文書の業務領域: {{businessDomain}}
- 元文書の文書種別: {{documentType}}
- マスク済み本文:
{{maskedContent}}

# 判定基準

## 再識別リスクありと判定する条件 (該当が1件でもあれば detected=true)

R1. 顧客の属性が3要素以上組み合わさって残っており、
    その組み合わせが業界内で絞り込み可能な水準である。
    属性要素の例: 業界、地域、規模、役職、事業フェーズ、顧客層、取扱商材、拠点数。
    例: "都内・従業員50名規模・製造業・代表取締役"

R2. 契約金額・顧問料・取引規模の具体値またはレンジが残っており、
    個別条件と組み合わさっている。
    個別条件の例: 業務範囲、契約開始時期、支払条件、特約、対象人数、顧客属性、例外対応条件。
    金額だけでなく「金額 + 個別条件」の組み合わせで特定契約を推定できる場合に検出する。
    例: "月額顧問料 [Amount]、年商規模 [Range]、業務範囲は給与計算+年末調整"

R3. 特殊な事業内容・業態・取扱商材の記述が残り、業界内で該当者が稀少と推定される。
    例: "○○業向け××認証の取得支援に特化"、"医療機器の輸入販売"

R4. 個別具体的な案件・係争・トラブル対応の経緯が3点以上の時系列で残っている。
    例: "初回相談 → 行政への照会 → 顧客との再交渉 → 契約条件変更"
    マスクされた固有名詞が消えていても、出来事の組み合わせで特定可能になりうる。

R5. 役職・経歴・職務範囲の組み合わせが業界内で稀少 (例: "元監査法人パートナーで現職は単独税理士")。

R6. 住所・所在地・拠点情報が十分に一般化されずに残っている。
    番地、丁目、建物名、最寄り駅、狭い商圏、支店名などが残る場合は検出する。
    都道府県・地方ブロック程度に一般化され、かつ R1-R5 のいずれにも該当しない場合は検出しない。
    例: "東京都渋谷区○○1丁目のクリニック" は検出、"首都圏の医療機関" は検出しない。

## 再識別リスクなしと判定する条件 (S1-S3のいずれかで detected=false)

S1. テンプレート・汎用手順・案内文など、特定組織や個人を含まない一般化された記述のみで構成されている。
    placeholder すら登場しないか、登場しても文脈が一般論。
    例: 就業規則テンプレ、給与計算チェックリスト、年末調整案内文

S2. placeholder (`[Person_001]`, `[Company_001]`, `[Amount]` 等) のみで個別固有名詞が消えており、
    かつ R1-R6 のいずれにも該当しない。
    つまり「誰の話か」を絞り込む組み合わせ情報が残っていない。

S3. テンプレート例外:
    テンプレート、記入例、雛形、チェックリスト、一般手順であることが文脈上明らかで、
    実在顧客の案件経緯・金額・住所・日付・担当者属性を含まず、
    R1-R6 のいずれにも該当しない。
    例: "顧問契約書テンプレートの条項例"、"年末調整案内文の雛形"、"給与計算チェックリスト"

## 判定で迷った場合の振る舞い

原則は安全側 (Restricted) に倒す。
ただし、迷いの原因が「実案件かテンプレートか不明」だけであり、
本文が S3 のテンプレート例外条件をすべて満たす場合のみ detected=false を許容する。
テンプレート例外に該当しない迷いは Restricted とする。
理由: 士業の機密性を尊重する設計とする。誤って Restricted にしても Strategist が除外する
だけで失われるのは1文書の活用機会、誤って Confidential のまま AI に流すと顧客機密漏洩。
非対称なリスクなので保守的に倒す。

# 出力 (JSON)
{
  "detected": boolean,        // 再識別リスクが残っているか
  "reasons": string[],        // detected=trueの場合、根拠を1-3項目
  "recommendedSensitivity": "Confidential" | "Restricted"
}
`;
```

**この判定基準が決める作品の挙動:**
- 厳しめに書く → Restricted 格上げが頻発 → 「変換する」より「止める」が前面に出る
- 緩めに書く → Restricted 格上げが稀 → 逆feedbackシーンが発火しないリスク
- デモ用サンプルデータ (顧問契約書_サンプル.pdf) で **必ず1件だけ Restricted 格上げが発生する** ように設計するのが理想

### A9: Export Context Package

**判断:** Purpose Query 実行後、Strategist がデータベースから目的に合う文書セットを選び、生成した Context Package を **Export Context Package** ボタンからMarkdownとして出力できるようにする。

**選定理由:**
- 「前段プラットフォーム」を主張するなら、出口がなければ主張が物理的に成立しない
- NotebookLM / Gemini / Codex / RAG にコピペで渡せる = 「変換する」プロダクトの出口を視覚化
- 実装コストが低い (5-10行) のに、作品主張の根拠としての重みが大きい
- 審査員に「このプロダクトはエコシステム協調的」というシグナルを送れる

**Exportタイミング:**
- 全ナレッジベースの一括exportではなく、Purpose Query に対して選ばれた文書セットのみをexportする
- Restricted文書、旧版候補、目的に関係しない文書の本文は含めない

**Export仕様:**
- 形式: Markdown (Phase 1) / JSON (Phase 2、将来拡張)
- 冒頭は `Package Manifest` と `Instructions for Downstream AI`
- 要約は含めない。AIが重要情報を落とさないよう、採用文書のAI参照版本文を省略せず含める
- `Included Documents` には文書名、採用理由、文書種別、機密度を記録
- `Excluded Documents` には文書名と除外理由のみを記録し、本文は含めない
- Restricted文書は `Restricted / human review only` として表示
- AI参照版 (`ai_safe_version`) の本文は `Full AI-Ready Sources` に inline で含める
- マスク済みplaceholder (`[Person_001]`, `[Company_001]` など) はそのまま残す
- ヘッダーには生成日時、Purpose Query 原文、対象文書数、Included/Excluded/Human review required の件数を含める

**Markdown出力サンプル:**
```md
# AI-Ready Context Package

## Package Manifest

- Purpose: 新人スタッフ向けに給与計算業務を学べるAIを作りたい
- Generated at: 2026-05-07 10:00 JST
- Source documents reviewed: 7
- Included documents: 3
- Excluded documents: 2
- Human review required: 1

## Instructions for Downstream AI

Use only the included AI-ready sources below.
Do not use excluded documents.
Do not infer missing operational rules.
If required information is missing, ask the human owner.

## Included Documents

- 給与計算チェックリスト.csv
  - Reason: 現行版であり、給与計算の基本手順を含む
  - Source type: CSV
  - Sensitivity: Internal
- 就業規則テンプレート.md
  - Reason: 勤務時間、休暇、控除ルールの参照元
  - Source type: Markdown
  - Sensitivity: Internal
- 顧客対応メモ_匿名化.txt
  - Reason: 例外対応の参考になる。個人情報はマスク済み
  - Source type: Text
  - Sensitivity: Confidential -> AI-safe

## Excluded Documents

- 古い料金表_2023.csv
  - Reason: 旧版候補。今回の目的には使わない
- 顧問契約書_サンプル.pdf
  - Reason: Masker detected residual re-identification risk
  - Status: Restricted / human review only

## Missing Knowledge

- 給与計算で先輩確認が必要な例外条件
- 顧客ごとの特殊ルールの管理方法
- 法改正時にどの資料を正本として更新するか

## Questions for Human Owner

1. 給与計算で必ず先輩確認が必要な条件は何ですか?
2. 顧客ごとに例外処理が発生する代表パターンは何ですか?
3. 新人スタッフに参照させてはいけない資料はありますか?

---

# Full AI-Ready Sources

## Source: 給与計算チェックリスト.csv

```text
勤怠データを確認する
残業時間、欠勤、控除項目を確認する
支給前に先輩確認が必要なケースを確認する
```

## Source: 顧客対応メモ_匿名化.txt

```text
[Person_001] 社では月途中入社時の日割り計算について確認が必要。
[Company_001] では交通費精算の締め日が通常と異なる。
```
```

**やらない判断:**
- NotebookLM / Gemini への直接 API 連携はしない (OAuth実装で時間溶ける)
- Markdown レンダラー実装はしない (素のMarkdown文字列で十分)
- export 履歴の永続化はしない

---

## 関連ドキュメント

- [docs/concept.md](concept.md) — プロダクトコンセプト
- [docs/architecture.md](architecture.md) — 技術構成
- [docs/open-questions.md](open-questions.md) — 未決定事項

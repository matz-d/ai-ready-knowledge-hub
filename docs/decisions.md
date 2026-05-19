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

**W1-1 検証結果 (2026-05-08):**
`poc/w1` で Genkit + Vertex AI + Gemini 2.5 Flash + Zod structured output を実装し、`sample-data/accounting-office` 10件すべてで Zod parse 通過を確認。D1 は継続採用で進める。

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
- 評価対象は Curator の6分類項目 (文書種別/業務領域/機密度/鮮度/AI利用方針/正本候補)

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
next.config.ts
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
- Genkit プラグイン: `@genkit-ai/googleai` → `@genkit-ai/google-genai` (Vertex AI 経由) に変更
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

`src/agents/masker/flow.ts` 内で Vertex AI (Gemini 2.5 Flash) に投げる判定プロンプトの骨組み。
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

### A10: Next.js の位置付け

**判断:** Next.js は採用を継続する。ただし「本格Webアプリ基盤」ではなく、**薄いデモUI + Cloud Run配信用の器**として使う。

**選定理由:**
- Cloud Run に載せやすく、ハッカソン必須要件の「とどける」を説明しやすい
- TypeScript / Genkit と同じ言語で、UI、API Route、Server Action、A9 export をまとめやすい
- Purpose Query、Knowledge Inventory、Export など、3分デモに必要な画面を素早く作れる
- 現時点で別基盤に切り替えるより、体験価値の実装へ集中した方が得点に直結する

**Next.js に背負わせること:**
- デモUI
- sample-data 固定または最小永続化の画面状態
- Genkit flow 呼び出しの薄い入口
- Context Package export
- Cloud Run 配信

**Next.js に背負わせないこと:**
- 本格認証
- 複雑な状態管理
- 重いアップロード処理
- DB設計の先行作り込み
- NotebookLM / Gemini への直接連携

**設計原則:**
プロダクトの知性は Genkit / Vertex AI 側に置く。Next.js はそれを審査員に伝える舞台装置として薄く保つ。

**代替案:**
- Vite + Express: 軽いが、Cloud Run上でUI/API統合を自前で作る部分が増える
- Firebase Hosting + Cloud Run API: 構成は綺麗だが、MVP段階ではサービス分割が早い
- Streamlit / Gradio: デモは速いが、Google Cloud / DevOps作品としての説明力が弱い
- React SPA + API: 分割が早く、ハッカソン初期MVPには運用面の重さが出る

**撤退条件:**
Next.js App Router / build / Cloud Run deploy 起因の詰まりが継続し、エージェント体験の実装速度を阻害する場合は、Vite + Express の単一Nodeサービスへ切り替える。

---

## D-W1-Close: W1 PoC 統合と Curator schema 正本化 (2026-05-08)

**決定**: `poc/w1/` は削除し、Curator/Masker の Zod schema・prompt・Genkit flow を `src/agents/` 配下の正本へ昇格させる。固定デモ用 fixture は通常 UI から外し、W1 の実 LLM snapshot は `docs/w1-artifacts/` に回顧用 artifact として退避する。R5 確定 enum (`DocumentTypeEnum` / `BusinessDomainEnum` / `SensitivityEnum` / `FreshnessEnum` / `AiUsePolicyEnum`) の正本は `src/agents/curator/schema.ts` とする。

**背景:**
W1 の見た目作り込みフェーズで `src/demo/inventory.ts` に独自 enum が混入し、PoC で R5 確定した日本語 enum と二重管理になりかけていた。さらに固定 fixture 表示が実装済み機能に見えやすく、W2 の実データ接続に向けた判断を曇らせるため、通常 UI から切り離す。

**新しいレイアウト:**
```
src/agents/
  _shared/genkitClient.ts         # Vertex AI + Genkit プラグイン共通
  curator/{schema,prompt,flow}.ts # R5 確定 enum + 4段フォールバック
  masker/{schema,prompt,flow}.ts  # A8 residualRisk + 3段フォールバック
scripts/
  runCurator.ts / runCuratorAll.ts / runMaskerRisk.ts
  generateInventorySnapshot.ts    # sample-data/accounting-office を curatorFlow に通し docs/w1-artifacts/inventory.snapshot.json を生成
docs/w1-artifacts/
  inventory.snapshot.json         # W1 実 LLM 出力の回顧用 artifact
sample-data/
  accounting-office/              # 10 件の原本サンプル
  masked/                         # PoC 由来のマスク済みサンプル 2 件
```

**npm scripts (root):**
- `npm run curator` / `curator:all` / `masker:risk` — PoC と同じ smoke 検証
- `npm run inventory:snapshot` — 実 LLM 出力を JSON snapshot として docs/w1-artifacts に保存
- `npm run typecheck` / `npm run build` — Next.js 込みで通過確認済み

**狙い:**
- 通常 UI は固定 fixture を読まず、実データ経路へ接続する前提を保つ
- W1 の実 LLM 出力は `docs/w1-artifacts/` に残し、回顧・比較・再生成のための artifact として扱う
- Walking Skeleton では、既存の `src/app/api/curator/route.ts` を Upload UI / Cloud Storage / Firestore へ接続していく

**撤退条件:**
- Next.js のビルド時に Genkit/Node 専用依存が静的バンドルに混入してビルドが破綻する場合は、`src/agents/` を `'use server'` 境界の裏に閉じる、または `services/` 別パッケージに切り出す。

---

## D-W2-Task1: Upload Walking Skeleton は GCS + Firestore 直結で作る (2026-05-08)

**決定**: `/upload` の単票アップロード UI と `POST /api/documents` を追加し、Next.js Route Handler が multipart file を受けて、Cloud Storage 保存、Firestore metadata 作成、`curatorFlow` 実行、Firestore 更新、結果返却までを 1 リクエストで行う。

**採用した設計:**
- Storage backend は GCS + Firestore 直結のみ。ローカル fallback は作らない。
- Upload 方式は server passthrough。Signed URL は MVP では採用しない。
- GCS object path は `raw/{docId}/{safeOriginalFileName}`。
- Firestore metadata は `documents/{docId}`。
- 既存 `POST /api/curator` は classify-only seed として温存し、新 route は `curatorFlow` を直接呼ぶ。
- 対象ファイルは `.txt` / `.md` / `.csv` / `.xlsx`、最大 5MB。`.txt` / `.md` / `.csv` は UTF-8、`.xlsx` は OOXML zip package として解析し、Curator/Masker 入力には normalized markdown を渡す。

**検証結果:**
実 GCP 接続で `/upload` 表示、`POST /api/documents` `HTTP 200`、GCS object 作成、Firestore `status='curated'` と Curator 結果保存を確認済み。異常系 `400` / `415` / `413` も確認済み。

---

## D-W2-Task2: MVP Masker は SimpleMasker + residual risk pipeline で通す (2026-05-08)

**決定**: Cloud DLP 本格統合の前に、決定的な `SimpleMasker` で原本をマスクし、既存 `maskerRiskFlow` に渡す `maskerPipelineFlow` を実装する。pipeline は `aiUsePolicy === 'requires_masking'` の文書だけを受け付ける。

**採用した設計:**
- 既存 `src/agents/masker/{flow,schema,prompt}.ts` は変更しない。
- `SimpleMasker` は email / phone / postal / 12桁番号 / bank account / amount / label-based name/company hints を対象にする。
- 出力 decision は `ai_safe_ready` と `restricted_promoted` の 2 値。
- `restricted_promoted` の場合は `aiSafeVersion: null` とし、`curatorFeedback` に `Restricted` / `blocked` を返す。
- Firestore / API / UI への接続は後続に回す。

**検証結果:**
実 Vertex 接続で `npm run masker:risk` と `npm run masker:pipeline` を確認済み。契約書実案件サンプルは `restricted_promoted`、顧客対応メモは `ai_safe_ready` になった。

---

## D-W2-Task3: Restricted 昇格は実効 `sensitivity` に反映し、Package 入力で除外する (2026-05-08)

**決定**: Masker が `recommendedSensitivity === 'Restricted'` を返した場合、文書 metadata の実効値として `sensitivity: 'Restricted'` / `aiUsePolicy: 'blocked'` を使う。由来は `sensitivitySource: 'masker'`、`originalCuratorSensitivity`、`sensitivityReason` に残し、`restrictedByMasker` のような重複 boolean は作らない。

**採用した設計:**
- Restricted 昇格ルールは `src/agents/masker/upgrade.ts` の pure function に置く。
- W1 snapshot JSON は変更せず、`src/lib/inventory.ts` の adapter で読み取り時に `InventoryDocument` へ変換する。
- Context Package へ渡す直前に `src/lib/contextPackageInput.ts` で Restricted / blocked / 未マスク機密を除外または human review に回す。
- `exportContextPackageMarkdown()` 本体は変更しない。
- Strategist は型境界だけ先に置き、LLM 実装は後続に回す。

**検証結果:**
`npm run context:demo` で `included=8` / `humanReview=2` を確認。Restricted 昇格された顧問契約書実案件の本文は `Full AI-Ready Sources` に含まれない。

---

## D-W2-Schema: Firestore document shape と lifecycle (2026-05-08)

**決定**: `documents/{docId}` を「effective top-level + audit block 分離」型で定義し、status state machine は `uploaded → curating → curated | blocked | masking → ai_safe | restricted | failed` の 8 状態とする。詳細は [docs/firestore-schema.md](firestore-schema.md) を正本とする。本決定は Step 2（`/api/documents` への Masker 接続）以降の前提となる設計境界。

**採用した設計:**
- Effective fields (`sensitivity` / `aiUsePolicy` / `sensitivitySource` / `originalCuratorSensitivity` / `sensitivityReason`) は document の top-level に置き、Inventory クエリ (`where sensitivity == 'Restricted'`) を可能にする。
- Curator が出した生の判定値は `curator: {...}` ブロックに不変記録として保持する。Masker 昇格があっても `curator.sensitivity` は書き換えない。
- Masker の評価結果（生データ）は `masker: {...}` ブロックに集約する。`masker.maskedSpansCount` と `masker.ruleHits` は UI 集計表示用に block 内に置く。
- マスク済み本文 (`maskedContent`) は **Firestore に直書きせず**、GCS `masked/{docId}/{safeOriginalFileName}` に保存する。Firestore document には `aiSafeStoragePath` パスのみ持つ。
- 原本コンテンツの SHA-256 (`contentSha256`) は `uploaded` 時に書く。Masker 側の `sourceContentHash` と照合できる足場とする。
- 終端 status は文書の扱い方を表す。`curated` は Curator だけで AI 参照可、`blocked` は Curator 時点で AI 参照不可、`ai_safe` は Masker 後に AI 参照版あり、`restricted` は Masker 後に AI 参照不可へ昇格。
- Masker pipeline 失敗時は `status='failed'` 一本化。`curator` ブロックの成功記録は保持され、`maskerError` ブロックに失敗詳細を残す。UI 側で「Curator 成功・Masker 失敗」を組み立てる。
- **Masker による Restricted 昇格は不可逆**。一度 `sensitivitySource: 'masker'` になった document を Curator 値に戻す経路は持たない（A8 と整合）。
- Firestore document 自体に `schemaVersion: 1` を持たせる。マイグレーション時にインクリメント。

**やらない判断:**
- `maskedSpans` の詳細位置を Firestore に書かない（件数集計のみ）。詳細は GCS masked オブジェクト側に置くか、必要になったら subcollection 化する。
- `ai_safe_ready` 時の冗長キャッシュ（GCS と Firestore 両方持つ）はやらない。GCS が正本。
- Masker の `recommendedSensitivity` を Curator が拒否する逆権限は持たせない（A8 を継承）。
- `masking_failed` のような中間 status は導入しない。`failed` 一本化で UI 側に組み立て責任を寄せる。

**この決定が解消する論点（W2 レビュー指摘との対応）:**
- 3.c (Firestore Masker shape 未定義)
- 3.e (sensitivitySource 一方通行の規約明示)
- 1.f (重複検出の足場確保)
- 4.a (Inventory adapter の正本型固定で重複防止)

**撤退条件:**
- Firestore document が 1 MiB 上限に張り付くケースが MVP 範囲（metadata + Curator block + Masker block）で頻発した場合、`masker.ruleHits` を subcollection 化、または `masker` ブロックを別 document に分離する。原本本文と AI-safe 本文は GCS 正本であり、Phase 2 の chunk inline 本文は `documents/{docId}/chunks/{chunkId}` 側の 500 KiB guard で別管理する。
- `status='failed'` 一本化が UI で「成功成分の表示」を作りづらくし、デモ表現を阻害する場合は `masking_failed` を後追いで追加する。

---

## D-W2-Step2: Upload Orchestrator と Masker 接続 (2026-05-08)

**決定**: `POST /api/documents` に跨る GCS / Firestore / Curator / Masker の副作用順序を `src/lib/uploadOrchestrator.ts` に集約し、Route Handler は multipart 検証とレスポンス直列化に限定する。Walking Skeleton では疑似分散トランザクションは採用せず、明示的な rollback と `failed` 記録で整合する。

**採用した設計:**
- `/api/documents` から GCS / Firestore / Curator / Masker の順序制御を切り出し、`uploadOrchestrator` に一手にまとめる。
- 処理順は **raw object upload → Firestore 初期書き込み (`status='uploaded'`) → `status='curating'` への更新 → Curator → 必要時のみ Masker** とする。
- Masker が `ai_safe_ready` を返した場合は、**masked GCS object を先に作成**し、その後 Firestore を `ai_safe` に更新する。
- masked object 作成後に Firestore 更新が失敗した場合は、**masked object を rollback delete** する。
- Masker が `restricted_promoted` を返した場合は **masked object は作らず**、Firestore を `restricted` に更新する。
- `POST /api/curator` は **UI の upload flow からは外し**、Curator 単体の curl / eval / smoke 用 route として残す。

**やらない判断:**
- GCS と Firestore をまたぐ疑似 Transaction 化はしない。
- masked object を残置して後続 retry に回す設計は採用しない。
- `/api/curator` は削除しない。評価・疎通確認用として残す。

**理由:**
- Route Handler を HTTP 境界に限定し、副作用順序と rollback 方針を一箇所で読めるようにするため。
- Firestore が存在しない GCS path を指す瞬間を避けるため、`ai_safe_ready` では **GCS 先・Firestore 後** にする。
- GCS / Firestore の完全な分散 transaction は過剰で、Walking Skeleton では rollback と `failed` status 記録で十分と判断する。

**撤退条件:**
- `uploadOrchestrator.ts` が肥大化し、Curator / Masker / rollback / Firestore shape の責務が読みにくくなったら、段ごとの service / helper に分割する。
- retry 要件や監査要件が強くなり、masked object の一時残置・再試行キューが必要になったら設計を見直す。

---

## Phase 3-A: Google Sheets Snapshot Import（D-P3-A-1〜D-P3-A-10）

**要約**: Drive `files.export` で `.xlsx` スナップショットを取り Phase 2 パイプラインへ載せる方式、`sourceKind` / `externalSource` と defaulting、SA 共有前提、`gid` 無視の全シート import、重複許容、orchestrator 分割、`src/` 本線、Drive export fixture、原本名 / document 名 / 保存パス / AI 処理名の責務分離など、Phase 3-A の採用判断 **D-P3-A-1** から **D-P3-A-10** までの本文・代替案・撤退条件は [docs/phase-3-google-sheets-import.md](phase-3-google-sheets-import.md) の **「2. 採用判断ログ（Phase 3-A の合意）」** に正本として記録している。

---

---

## Phase 3-C 事前方針: 認証・デプロイ・配布形態（2026-05-13）

**決定**: Phase 3-C の設計方針として以下を確定した。詳細は [docs/phase-3-c-direction.md](phase-3-c-direction.md) に正本として記録。

**アプリ認証**: Cloud IAP + Google Workspace SSO を第一選択。`x-goog-authenticated-user-email` を監査ログのキーとして一気通貫させる。

**Drive 認証**: OAuth 2.0 User Delegation（drive.file scope、offline access なし）を推奨。Phase 3-B の Service Account 個別共有は Phase 3-C で移行。

**配布形態戦略**: SaaS（Year 1） → Lightweight BYOC / Docker on 顧客 Cloud Run（Year 2） → Full BYOC（Year 3）の 3 段階。「Docker 配布 on 顧客 Cloud Run」は実質 Lightweight BYOC と同義。

**ハッカソン向けデプロイ**: GitHub Actions + Artifact Registry + Cloud Run。monolithic Dockerfile（multi-stage）で commit → test → build → push → deploy を自動化し、採点軸「まわす」のエビデンスとする。Artifact Registry の役割は「バージョン管理」より「CI/CD pipeline の可視化・透明性」。

**Phase 3-C 実装優先順序**: (1) Cloud IAP + tenantId middleware、(2) GitHub Actions CI/CD 整備、(3) AuditEvent collection、(4) monitoring ダッシュボード。BYOC / Terraform / マルチリージョンはやらない。

**実装方式への影響**: ビジネスロジック（Curator / Masker / Firestore / GCS）はほぼ変わらない。認証・Secret・deployment 層を env / middleware に集約して pluggable にしておくことが Year 2 移行コストを下げる唯一の準備。

---

---

## D-P3-C: Phase 3-C App Loop 完了（2026-05-14）

**決定**: Phase 3-C を「Purpose → Strategist → Context Package までアプリを一巡させる」フェーズとして完了した（認証・CI/CD・AuditEvent はスコープ外）。

### 3-C で確定した設計採用判断

**StrategistOrchestratorResult を C-4 API response の正本とする**
- `src/services/strategistOrchestrator/types.ts` に `StrategistOrchestratorResult` を export し、API route は markdown と counts を足すだけにする。
- 理由: service 層の型が API response の形状を決めることで、API route が薄くなり、service 層のテストが API 仕様のテストを兼ねる。

**Safety gate の defense-in-depth: masking unavailable で throw**
- `toContextPackage.ts` の `includedBodyForChunk()` は、`requires_masking` chunk に `maskedText` が無い場合、rawtext を fallback で出すのではなく `throw` する。
- 理由: safety gate がすでに `masking_required_unavailable` で除外しているので通常到達不可。ただし safety gate のルールが変わった際に無音でPII を流すより、크래시して警報する方が安全。defense-in-depth として throw が正しい。
- **代替案として検討したもの**: `[Content redacted]` placeholder への置換。採用しなかった理由は、「なぜ exclude されなかったか」の原因を隠すより、壊れた前提を loudly fail させた方が将来的な安全性が高い。

**Malformed Inventory document は skip-and-warn、全体を落とさない**
- `listInventoryDocumentsFromFirestore()` の flatMap 内で parse error を catch し、`console.warn` して skip。
- 理由: legacy document 1件で全 Inventory（= Context Package）を落とすのは read path としての方針として誤り。修復不能な document は skip して観測可能にしておくのが正しい。

**Upload 直後に chunk 自動生成（同期、失敗時 500）**
- `POST /api/documents` の `orchestrateUploadProcessing` 完了直後に `replaceChunksForDoc` を同期で呼ぶ。失敗時は 500 で返す。
- 理由: upload 成功なのに Purpose Query に出ない中途半端な状態を作らないことを優先（PoC 段階で「アプリ一巡」を DoD とするため）。warning-and-continue よりも fail-fast が体験として強い。

**Google Docs import route: URL でルーティング分岐**
- `POST /api/import/google-sheets` に Docs URL（`docs.google.com/document/d/`）判定を追加し、`orchestrateImportedDocsSnapshotProcessing` へ振り分ける。bare fileId は Sheets 扱いのまま（Drive metadata fetch コストを避ける）。
- 理由: UI 文言がすでに Docs URL を案内しており、route behavior の不一致を解消する最小コストの実装として URL pattern マッチが適切。

**ContextPackageExportInput を Strategist 経路でも流用**
- 新しい export 型は作らず、既存 `ContextPackageExportInput` に map する。
- `safetyExcluded` → `humanReviewDocuments`、`strategist.excluded` → `excludedDocuments`。
- 理由: export ロジック（Markdown 生成）の正本を1本に保つ。Strategist 経路と全 chunk 経路の出力フォーマットを同一に保証できる。

### コードレビュー（CodeRabbit）採用・不採用の記録（2026-05-14）

**採用（5件）:**
- React key: index → `${i}-${item}` 組み合わせ（`missing` / `humanReviewQuestions`）
- `URL.revokeObjectURL` 前の `setTimeout(100)` 追加（download race 対策）
- `chunk_generation_failed` → 日本語ユーザ文言定数に統一（ファイル内の他エラーと揃える）
- `includedBodyForChunk` の masking fallback を throw に変更（上記 defense-in-depth と連動）
- docs の 700文字超行を bullet 化（読みやすさ）

**不採用（主な理由別）:**
- **ハルシネーション**: `await runSafetyGate` 追加 → `runSafetyGate` は同期関数。CodeRabbit が実装を確認せずに推測して誤検知。
- **誤検知**: `next-env.d.ts` 手動編集警告 → Next.js typed routes が自動生成する行であり手動編集ではない。
- **デバッグ性の低下**: `console.error` でエラー全体を log しない → stack trace を捨てるとデバッグ困難になり、orchestrator error に PII が混入する具体的根拠もない。
- **フェーズ範囲外**: skip 件数の metric/alert 追加 → Phase 3-C スコープ外（監視は後フェーズ）。
- **スタイル / 波及大**: discriminated union（included/excluded 型分離）→ `reason?:` で意味的に分離されており、リファクタリングコストに対してメリットが小さい。

---

## D-P3-D: Phase 3-D CI/CD + IAP 完了（2026-05-14）

**決定・完了**: Phase 3-D は「commit push → test/typecheck/build → Artifact Registry push → Cloud Run deploy → Cloud IAP で社内ユーザだけが利用」のパイプラインを構築し、**DoD 全 15 項目を達成した**。実装正本は [docs/phase-3-d-direction.md](phase-3-d-direction.md)。証跡は [docs/iap-evidence/](iap-evidence/)。

**完了事実（commit a57713e / 2026-05-14）:**
- GitHub Actions run `25845188187` green（ci + deploy）
- Artifact Registry に `:a57713e` / `:latest` push 済み
- Cloud Run revision `ai-ready-knowledge-hub-00003-2jt` Ready、image `:a57713e`
- Cloud IAP 直接保護。匿名 302/401 確認済み。許可ユーザ `makoto@m-grow-ai.com` のみ通過
- `document.import` / `document.reimport` / `document.export` の AuditEvent を `tenantId=m-grow-ai.com` で記録済み
- `verifyIapJwt.ts` 実装・middleware 統合済み（hardening 完了）
- deploy 3 分 32 秒（5 分以内目標達成）

### Q1: GitHub Actions の GCP 認証方式

**決定**: Workload Identity Federation（WIF）を採用する。Service Account JSON key は採用しない。

**理由:**
- 長寿命の秘密鍵を GitHub Secrets に置かず、GitHub OIDC token と GCP 側の trust 設定で短命 credential を発行できる。
- 「顧客機密文書を扱う前提」のプロダクト説明と整合する。
- WIF provider には `assertion.repository == "matz-d/ai-ready-knowledge-hub"` と `assertion.ref == "refs/heads/main"` 相当の attribute condition を付け、trusted repo / branch 以外の impersonation を拒否する。

**代替案:**
- Service Account JSON key: セットアップは速いが、漏洩・ローテーション・監査の負債が大きいため不採用。

### Q2: tenantId の発生源

**決定**: MVP/SaaS 初期は IAP の authenticated email の domain 部分を tenantId とする。`KNOWLEDGE_HUB_TENANT_ID` が設定されている場合は env override を優先する。actor identity は email 全体を audit log に残す。

**理由:**
- 既存 `src/lib/auth/resolveTenantIdFromAuth.ts` と `src/middleware.ts` がこの形で実装済み。
- 初期顧客を Google Workspace domain 単位で許可する Cloud IAP 方針と自然に対応する。
- 将来の tenant master lookup / BYOC OIDC へ移行する場合も、呼び出し側は `resolveTenantIdFromAuth()` のままにできる。

**撤退条件:**
- 同一 email domain 内に複数 tenant を切りたい、または顧客の認証 domain と契約 tenant が一致しない場合は、Firestore の tenant master lookup へ移行する。

### Q3: Cloud Run public access の扱い

**決定**: Cloud Run は Cloud IAP 必須とし、発表時も `allow-unauthenticated` による一時公開はしない。

**理由:**
- プロダクトの中心価値が「AI に渡す前の情報を安全に準備する」ことであり、公開デモ都合で匿名アクセスを許すと説明が弱くなる。
- IAP の 401/403、IAP 設定画面、許可ユーザだけが UI に到達できる証跡を「とどける」の evidence として使える。
- Cloud Run IAM と IAP の両方が効く構成では、IAP 通過後に IAP service agent が Cloud Run invoker として呼び出せるようにする。

**代替案:**
- `allow-unauthenticated` で発表時のみ一時開放: 速度は出るが、セキュリティ主張と逆行するため不採用。

### Q4: AuditEvent を先に書く範囲

**決定**: Phase 3-D の対象 action は `document.import` / `document.reimport` / `document.export` とする。実装順は `document.import` を最初に通し、その後 reimport/export を接続する。

**理由:**
- `docs/phase-3-c-direction.md` の監査ログ設計にある最低限の 5W1H に対応する。
- 実装済みの `src/lib/audit/auditEvent.ts` が `recordAuditEvent()` と `auditActorFromRequest()` を提供しているため、route ごとの配線に集中できる。
- `auditEvents/{eventId}` は `.create()` で append-only に書く。Firestore Security Rules でも client からの update/delete（本 repo では read/create も含む）拒否を `firestore.rules` で明文化する。
- **append-only の実効防御**は Rules ではなく、`recordAuditEvent()` が **`.create()` だけ**を使い既存ドキュメントを更新しないアプリ規律が正本である。Rules は Admin SDK 非経由の将来経路向けの規範・ガードレール。

**やらない判断:**
- Phase 3-D では `document.view` / `chunk.access` / `mask.override` の全面配線はしない。

### Q5: Dockerfile の Next.js build mode

**決定**: `next.config.ts` の `output: 'standalone'` を維持し、multi-stage Dockerfile で standalone server を Cloud Run に載せる。

**理由:**
- 既に `next.config.ts` が standalone 出力になっており、Docker image を軽くできる。
- Artifact Registry に image を push し、`latest` と GitHub Actions の `$SHORT_SHA` tag を残すことで、commit と Cloud Run revision の対応を追跡できる。
- `docs/tech-stack.md` の「Buildpacks に任せる」方針は W1/W2 の初期デプロイ速度を優先したもの。Phase 3-D では CI/CD と Artifact Registry の evidence を優先し、Dockerfile 方針で上書きする。

**代替案:**
- Buildpacks: 初期 PoC には速いが、今回の「build artifact を見せる」目的では evidence が弱い。
- 通常 Next.js build: image が大きくなりやすく、standalone の既存設定を捨てる理由がない。

### Phase 3-D の境界

**触る領域:**
- deployment 層: `Dockerfile`, `.dockerignore`, `.github/workflows/deploy.yml`
- auth 層: `src/middleware.ts`, `src/lib/auth/*`
- audit 層: `src/lib/audit/*`, 対象 API routes, Firestore rules
- docs: setup/runbook/evidence checklist

**触らない領域:**
- Curator / Masker / Strategist の LLM 判断ロジック
- KnowledgeChunk / Context Package の選定ロジック
- Firestore document shape の大幅変更
- BYOC / Terraform / multi-region / microservices

---

## D-P3-E: Phase 3-E Processing Boundary + Cloud DLP Trust Modes 方針（2026-05-15）

**決定**: Phase 3-E は `cloud-managed` を MVP の標準 ProcessingProfile として磨く。`cloud-sanitized-ingress` は高セキュリティ顧客向けの将来 profile として契約・スキーマ・監査仕様だけ先に定義し、Edge Sanitizer の実装は後続へ送る。正本は [docs/phase-3-e-direction.md](phase-3-e-direction.md)。

### Q1: 標準 ProcessingProfile

**決定**: MVP 標準は `cloud-managed` とする。属性は `tenant-cloud / post-ingress / shared-cloud`。

**理由:**
- 既存の upload / Google Workspace import / GCS / Firestore / Cloud DLP / Vertex AI 経路と最も整合する。
- Phase 3-D で IAP と AuditEvent が入り、クラウド境界の説明材料が揃っている。
- ハッカソン段階では Profile-A の完成度を上げる方が、複数 profile を浅く作るより「まわす」「とどける」の evidence が強い。

### Q2: `local-only` という呼称

**決定**: MVP の説明では `local-only` を使わない。物理境界と信頼境界が混同されるため、TCB と ProcessingProfile で表現する。

**理由:**
- ブラウザやPCで処理しても、ルール配信元・更新経路・証跡がクラウド側にある場合、監査人にとって純粋な local-only とは言いにくい。
- 営業・契約・監査でブレない説明にするには、「どのプロセスがどのデータを見る権限を持つか」を先に固定する方が安全。

### Q3: ブラウザ WASM DLP / sanitize-local-then-cloud

**決定**: ブラウザ WASM DLP は Phase 3-E / MVP では採用しない。

**理由:**
- PDF / xlsx parsing + DLP を SME のPC上で安定運用する検証コストが高い。
- WASM bundle と rule set の配信元が当社である以上、サプライチェーン証明が弱く、"local" と訴求しにくい。
- 顧客側セットアップを増やすと、SME 向け導入容易性が落ちる。

### Q4: 高セキュリティ将来 profile

**決定**: `cloud-sanitized-ingress` を contract-only profile として予約する。属性は `tenant-edge / pre-ingress / shared-cloud`。

**理由:**
- 「当社クラウド境界に生データを入れない」顧客要件には、顧客 GCP プロジェクト内 Edge Sanitizer の方が説明しやすい。
- 顧客側 Cloud Audit Logs と当社 AuditEvent を correlation id でつなげば、境界越え証跡を第三者検証しやすい。
- Phase 3-E ではスキーマと reject 方針だけ決め、実装を後続に送ることで標準 profile の完成度を優先できる。

### Q5: AuditEvent / purposeBinding

**決定**: Context Package export は `purposeBinding` を監査単位として扱う。Phase 3-E では `document.export` AuditEvent への追加方針を固める。

**理由:**
- 同じ文書が複数 purpose で再利用されるため、document 単位だけでは「どの目的でAIに渡したか」を後から追えない。
- 目的外利用を説明・検知するには、Context Package 1個 = purpose 1個の不変条件を監査メタデータに寄せる必要がある。

### Phase 3-E の境界

**触る領域:**
- Cloud DLP provider: `minLikelihood=POSSIBLE`, replacement token `[REDACTED:<INFO_TYPE>]`, `ruleSetVersion=dlp-ruleset-2026-05-15-v1`
- ProcessingProfile / TCB docs
- AuditEvent shape の拡張方針
- `document.export` の purposeBinding
- DLP / Masker eval の最小設計
- Document Conversion Eval の評価契約（Q8 を参照）

**触らない領域:**
- Edge Sanitizer 実装
- 顧客 GCP プロジェクト deploy / BYOC / Terraform
- BigQuery write-once audit 本実装
- VPC-SC / CMEK 本格構築
- PDF / 画像 / Slide の `cloud-sanitized-ingress` 対応
- Strict local only / ローカル LLM
- Document Conversion Eval: `src/` への `ConversionEvalResult` 型実装 / 評価器ランナー実装 / golden fixture 作成 / `poc/document-conversion/` ディレクトリ作成 / CI への評価器接続

### Q8: Document Conversion Eval の評価契約

**決定**: Phase 3-E は、PDF / 画像 / Slide / Office 変換そのものは扱わないが、**変換後の構造化結果に対する評価契約**だけは固定する。`docs/phase-3-e-direction.md` の第 10 節を正本とする。

**Phase 3-E で固定するもの:**
- 6 評価軸: `schema_validity` / `coverage` / `locator_quality` / `semantic_retention` / `safety_readiness` / `context_package_readiness`
- `ConversionEvalResult` 型（評価器インターフェース）
- 三段階成熟度: health check → heuristic eval → golden eval
- `overall.status` ロールアップ規約（下記）

**ロールアップ規約**: **案 B（ブロッカー軸方式）**を採用する。

- `schema_validity` と `safety_readiness` を blocker 軸とし、fail 条件に該当した場合 `overall.status = 'fail'`。
- 非 blocker 軸の fail は `'warn'` に降格し、`reasons` に「降格された fail」として残す。
- blocker 軸の warn は `overall.status = 'warn'` に昇格する。
- **非 blocker 軸の warn 単独は `overall.status` を昇格させず、`reasons` にも積まない**（軸ごとのフィールドにのみ反映する）。これにより `reasons.length > 0 ⇒ warn` のショートカットを安全に成立させる。
- 軸ごとの fail / warn / pass 閾値関数は Phase 3-H で確定する。Phase 3-E では関数の存在だけ予約する。

**`safety_readiness` の意味の明確化:**
- Conversion Eval が見るのは「Masker / DLP が span 単位で捕捉・置換できる構造になっているか」であり、「Masker 適用後に PII が残るか」ではない。
- 後者は A8 / `maskerRiskFlow` の責任領域（`recommendedSensitivity` 昇格）であり、Conversion Eval は触らない。
- そのため `ConversionEvalResult.safetyReadiness` の主軸フィールドは `unmaskablePiiFindings`（DLP/Masker が span 化できない形で混入している PII 件数）と `maskableChunkRate`（構造上 Masker 適用可能な chunk 比率）とする。

**理由（A8 との整合）:**
- A8（Masker→Curator 逆 feedback）の「非対称リスクで安全側に倒す」哲学を、評価層にも持ち込む。
- ただし役割は分ける: A8 は Masker 後の残存リスクで Sensitivity を昇格する。Conversion Eval は **Masker をかけられる構造になっているか** を blocker として扱う。両者が直列に並ぶことで、変換層と Masker 層がそれぞれの責任で安全側に倒せる。
- それ以外の品質低下（locator・coverage・semantic retention）は「人間判断材料」として `reasons` で扱う。CI を red にして変換器選定を止める性質ではない。

**代替案として検討したもの:**
- 案 A（単純多数決）: safety_readiness と他軸の重みが等価になり、downstream 契約を守れない。不採用。
- 案 C（成熟度別運用）: health / heuristic / golden で blocker 軸を変える方式。**Phase 3-H 以降の検討候補として future memo に残す**。Phase 3-E では案 B 一本で固定する。

**やらない判断（Phase 3-H で着手）:**
- `ConversionEvalResult` を `src/` に落とす型実装（TypeScript 正本化、Zod / OpenAPI 化を含む）。
- 評価器ランナーの実装。
- 各軸の fail / warn 閾値の確定。
- golden fixture の作成。
- `poc/document-conversion/` ディレクトリ作成。
- CI への評価器接続。

**撤退条件:**
- Phase 3-H で複数変換器を試走した結果、案 B では downstream を守れない / 過剰に fail する事例が出た場合、案 C への移行または軸の再設計を検討する。

---

## D-P3-H: Phase 3-H 前倒しと提供形態の整理（2026-05-18）

**決定**: Phase 3-E 完了後、Phase 3-F のデモ polish よりも Phase 3-H Document Conversion PoC を先に進める。正本は [docs/phase-3-h-direction.md](phase-3-h-direction.md)。また、将来の提供形態を [docs/offering-model.md](offering-model.md) に文書化する。

### Q1: 次フェーズの優先順位

**決定**: 次に着手するのは Phase 3-H。PDF / Slide / 画像 / Office 系ファイルを `DocumentIR` / `KnowledgeChunk` 相当へ変換する PoC を前倒しする。

**理由:**
- 提出まで一ヶ月以上あり、見た目の polish よりプロダクト本体価値を伸ばす時間がある。
- SME の実際の情報源は PDF、スライド、画像化された資料、古い帳票に多く残っている。
- 既に text / markdown / CSV / xlsx / Google Sheets / Google Docs は Purpose Query まで到達しているため、次に価値が伸びるのは source coverage の拡張である。
- Phase 3-E で Conversion Eval 契約を固定済みなので、PoC の評価軸がある状態で着手できる。

### Q2: 提供形態

**決定**: Managed SaaS だけを前提にしない。ライトな顧客には Managed SaaS、士業・法人の本命には Dedicated SaaS / Private deployment、さらに慎重な顧客には Customer-managed / BYOC、最厳格な顧客には `cloud-sanitized-ingress` を将来 option として扱う。

**理由:**
- フリーランスまたは小規模事業者が運営する単一 Managed SaaS に、会社や士業が顧客情報・契約書・給与資料を入れる心理的ハードルは高い。
- ただし最初から Customer-managed / BYOC を主戦場にすると、Terraform、監視、更新、障害対応、権限設計が重くなりすぎる。
- Dedicated SaaS / Private deployment は、Managed SaaS より信頼境界を説明しやすく、Customer-managed より導入が軽いため、商用化時の本命になりやすい。
- `cloud-sanitized-ingress` は Phase 3-G の高セキュリティ prototype 候補として残すが、今すぐの本体価値は Document Conversion の方が大きい。

### 次の優先順位

1. Phase 3-H: Document Conversion PoC
2. Phase 3-F: Document Conversion を含むデモ polish
3. Phase 3-G: `cloud-sanitized-ingress` prototype
4. Phase 4: Dedicated / customer-managed 商用設計

---

## D-P3-H-2: Phase 3-H 組織軸を subtype 起点へ組み直し（2026-05-18）

**決定**: Phase 3-H の PoC 組織軸を「変換器の並列比較」から「source subtype 起点」に組み直す。正本は [docs/phase-3-h-direction.md](phase-3-h-direction.md) v2（§2.5・§3・§4）。

**前提**: D-P3-H で Phase 3-H 着手は確定済み。本決定はその **内部構造** の方針確定。

### Q1: PoC の組織軸

**決定**: source subtype 4 分類（`official-doc-pdf` / `slide-pdf` / `scan-pdf` / `office-native`）を組織軸に据える。変換器の選定・評価器の閾値・本線統合判断のすべてがこの軸に従う。

**代替案として検討したもの:**
- (a) 変換器並列比較（MarkItDown / Gemini 直 / MarkItDown→Gemini / pptx parser の 4 列）← v1 案
- (b) **source subtype 起点（4 分類 × 各 subtype に first-choice 1 + fallback 1）** ← 採用
- (c) 拡張子起点（PDF / Slide / 画像 / Office）

**選定理由:**
- PDF / Slide / 画像という拡張子グループは変換アプローチを束ねきれない。`official-doc-pdf` は決定論的 text extractor で十分、`scan-pdf` は OCR 必須、と振る舞いが正反対。拡張子起点 (c) では評価軸が立たない。
- 変換器並列比較 (a) は「subtype X では Gemini が勝つ／subtype Y では決定論的 extractor が勝つ」という答えが出る性質。converter-first では結論を一意化できない。
- subtype 起点 (b) は本線統合の単位（Phase 3-H-2 のフラグ gating 単位）とも自然に一致する。

### Q2: 最初の縦串 subtype

**決定**: `official-doc-pdf`（構造化公的文書 PDF、text layer あり）を最初に縦串で抜く。

**理由:**
- text layer ありの PDF は `pdf-parse` で決定論的に抽出できるため、DocumentIR → KnowledgeChunk → eval の縦串が最短で通る。
- adapter の lossy 判断、`ConversionEvalResult` の暫定閾値、CI gate 雛形を最初にここで固定すれば、subtype 2 以降は runner を流用できる。
- 公的様式（国税庁・厚労省・年金機構・中小機構）が PII フリーで取得可能で、fixture 確保コストが最低。

### Q3: MarkItDown の扱い

**決定**: MarkItDown を本線統合候補から外し、subtype 1 で `pdf-parse` との品質差分を見るための **PoC 内比較材料に限定** する。

**理由:**
- MarkItDown は Python ツールで、本線統合すると Dockerfile / 本線ビルドに Python ランタイムを持ち込むことになる。本リポジトリは TypeScript + pnpm 統一（CLAUDE.md 確定）で、ランタイム追加は重大決定。
- subtype 1 の first-choice は `pdf-parse`（Node 系）で十分達成可能。MarkItDown は「決定論的 extractor の品質上限」を測る比較材料としてのみ価値がある。
- PoC 配下に閉じる限り `uv` / `pipx` ローカル実行で済み、本線への汚染がない。

**撤退条件:**
subtype 1 の比較で `pdf-parse` の表抽出品質が `ConversionEvalResult.coverage.tableCandidates` で著しく劣り、かつ MarkItDown が大幅に上回る場合、Phase 3-H-2 で Python ランタイム導入の妥当性を再検討する。

### Q4: fixture の調達方針

**決定**: 自作を最小化し、公的機関の公開文書を取得して `sample-data/document-conversion/{subtype}/` に配置する。PII 入り fixture は厚労省 雇用契約書ひな型に `sample-data/accounting-office/顧問契約書_実案件サンプル.txt` 流の XXXX 形式合成 PII を埋め込んで 1〜2 件だけ自作する。

**理由:**
- 「すべて自作」は効率が悪く、かつ士業ドメインの様式リアリティを再現しきれない。
- 国税庁・厚労省・年金機構・中小機構の様式はすべて公開・PII フリーで、士業現場の実情報源と一致する。再配布条件は各機関の利用条件を `sample-data/document-conversion/README.md` に記録する。
- `safety_readiness` 軸は PII を含まない fixture では評価意味が立たないため、合成 PII 入り fixture を 1 件は必ず作る。subtype 2 以降は subtype 1 の PII 入り fixture を再利用または slide 化して使い回す。

### Q5: 本線統合の単位

**決定**: 本線統合の単位は「変換器」ではなく「subtype」とする。Phase 3-H-2 では subtype 1（`official-doc-pdf`）のみ本線 upload route に統合し、subtype 2 / 3 はフィーチャーフラグで gating する。

**理由:**
- subtype ごとに first-choice 変換器・コスト性質・評価閾値が異なるため、まとめて統合すると本線の AuditEvent / ProcessingProfile 接続が複雑化する。
- subtype 1 は Vertex AI 呼出なしで動かせる路線が現実的で、コスト・障害面の境界が綺麗。
- subtype 2（Gemini 直読み）以降は `inferenceDestination` の AuditEvent 拡張が必要で、別フェーズとして扱う方が安全。

### 影響範囲

- `docs/phase-3-h-direction.md` v2 で §3〜§9 全面差し替え済み。
- `docs/open-questions.md` の「Document Conversion Eval（Phase 3-H に向けた未決）」は引き続き有効。各軸の閾値確定は subtype 1 で実行する。
- 新規 npm 依存（`pdf-parse` 等）は CLAUDE.md `minimumReleaseAge: 4320` に従う。

---

## D-P3-H-1: Phase 3-H 実装結果の固定（2026-05-19）

**決定**: Phase 3-H 実装結果として、`official-doc-pdf`（subtype 1）を **本線統合候補** に固定する。統合候補の変換方法は `pdf-parse` first-choice の TypeScript/pnpm 縦串（`DocumentIR` → subtype-aware adapter → `KnowledgeChunk` draft → health eval）とし、MarkItDown は本線に入れない。

### Q1: subtype 1 を本線統合候補にするか

**決定**: する。Phase 3-H-2 で最初に本線統合を検討する対象は subtype 1 のみとする。

**代替案として検討したもの:**
- (a) **subtype 1 のみ本線統合候補に固定** ← 採用
- (b) subtype 1 + subtype 2 を同時に候補化
- (c) どの subtype も候補化せず PoC 継続

**選定理由:**
- `poc/document-conversion/official-doc-pdf/runner.ts` と `official-doc-pdf/adapter/toKnowledgeChunk.ts` で、subtype 1 の縦串が TS 側で完結している。
- `pnpm typecheck` は `tsc --noEmit && tsc -p poc/document-conversion/tsconfig.json --noEmit` で PoC 型検証まで接続済み。
- `poc/document-conversion/output/official-doc-pdf/compare-summary.md` の実装結果では、`pdf-parse` 側が全 fixture で health stage `pass` を維持している。
- subtype 2 / 3 は Gemini コスト・クォータ・失敗時 SLA 設計が未確定で、同時統合は Processing Boundary の説明を複雑化する。

### Q2: 本線統合候補の変換方法

**決定**: subtype 1 の本線候補は `pdf-parse` first-choice を採用し、PoC で固めた `DocumentIR` 変換・adapter・health eval を移植単位にする。

**変換方法（候補）:**
1. `pdf-parse` で text/table を抽出し `sourceSubtype: "official-doc-pdf"` の `DocumentIR` を生成。
2. subtype-aware adapter で `KnowledgeChunk` draft に落とす（構造差分は metadata / locator 合成で吸収）。
3. `ConversionEvalResult` の health stage（`schema_validity` / chunk 妥当性）を必須 gate として適用。
4. upload 本線では subtype flag で段階的に有効化し、subtype 2 / 3 は後続フェーズで分離する。

### Q3: MarkItDown を本線に入れない判断

**決定**: MarkItDown は本線統合しない。subtype 1 の PoC 比較材料としてのみ維持する。

**理由:**
- MarkItDown は Python ランタイム前提で、Dockerfile / 本線 build に新ランタイム境界を持ち込むため、TypeScript + pnpm 統一方針と衝突する。
- 実装結果として `poc/document-conversion/output/official-doc-pdf/compare-summary.md` では、MarkItDown 側は fixture により chunk 粒度が過剰に増え、`pageCoverage` も不安定（例: 0.25）で、本線デフォルトとしては扱いにくい。
- `poc/document-conversion/official-doc-pdf/compare/README.md` の運用どおり、`uvx` ローカル比較に閉じることで本線汚染を避けられる。

**撤退条件:**
- subtype 1 の golden/heuristic で `pdf-parse` が継続的に必須情報 recall を満たせず、MarkItDown 系が再現性を持って上回る場合は、Python 導入の再検討を行う。
- 本線統合準備で subtype 1 health gate を安定維持できない（schema invalid / empty chunk / oversized chunk が常態化）場合は、統合を中断して PoC 側で再調整する。
- subtype 1 のみ統合する前提が崩れ、subtype 2/3 の同時統合が必須になった場合は、D-P3-H-2 の統合単位（subtype 単位）を再審議する。

### 未決事項（継続）

- `ConversionEvalResult` 各軸の fail / warn 閾値最終値（特に `coverage` / `context_package_readiness` / `safety_readiness`）。
- subtype 1 本線統合時の feature flag 粒度と `uploadOrchestrator` への接続手順の最終確定。
- subtype 2 / 3 統合時に必要な AuditEvent `inferenceDestination` 拡張の仕様固定。
- slide-pdf / scan-pdf のコスト上限・quota 超過時挙動・fail-open/fail-closed の最終方針。

---

## 関連ドキュメント

- [docs/phase-3-c-direction.md](phase-3-c-direction.md) — Phase 3-C 認証・デプロイ方針（正本）
- [docs/phase-3-d-direction.md](phase-3-d-direction.md) — Phase 3-D CI/CD + IAP 実装方針（正本）
- [docs/phase-3-e-direction.md](phase-3-e-direction.md) — Phase 3-E Processing Boundary + Cloud DLP Trust Modes 実装方針（正本）
- [docs/phase-3-h-direction.md](phase-3-h-direction.md) — Phase 3-H Document Conversion PoC 方針
- [docs/offering-model.md](offering-model.md) — 提供形態
- [docs/phase-3-c-5-source-coverage.md](phase-3-c-5-source-coverage.md) — Phase 3-C-5 source coverage 確認結果
- [docs/phase-3-b-workspace-resync.md](phase-3-b-workspace-resync.md) — Phase 3-B（Drive 再取り込み・schemaVersion 2・鮮度バッジ・完了条件の正本）
- [docs/concept.md](concept.md) — プロダクトコンセプト
- [docs/architecture.md](architecture.md) — 技術構成
- [docs/firestore-schema.md](firestore-schema.md) — Firestore document shape の正本
- [docs/open-questions.md](open-questions.md) — 未決定事項
- [docs/week1-retrospective.md](week1-retrospective.md) — W1 振り返り

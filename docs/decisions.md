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

## D-P3-H-3: subtype 1 の薄い本線統合と評価育成（2026-05-19）

**決定**: 評価器（heuristic / golden）を完成させる前に、`official-doc-pdf`（subtype 1）を feature flag 付きで本線 upload 経路へ薄く統合する。目的は商用デフォルト有効化ではなく、`uploadOrchestrator` 境界における実運用に近い観測データを集め、評価軸を育成することとする。

### Q1: 評価完成前に本線統合するか

**決定**: する。対象は subtype 1 のみ、段階的有効化とする。

**理由:**
- PoC 内だけで heuristic / golden を先に作り込むと、本線の副作用順序（`uploadOrchestrator`）、保存形式、Masker 接続との前提差分が後で顕在化しやすい。
- subtype 1 は `pdf-parse` の決定論的経路で Vertex AI 依存がなく、観測・切り戻し境界を最小化できる。
- 本線ログ（変換結果 + eval 結果）を使う方が、閾値調整のサイクルが短い。

### Q2: 統合方式（薄い配線）の定義

**決定**: 本線統合は次の最小構成で行う。

1. `official-doc-pdf` 判定時のみ `DocumentIR` 変換と adapter を実行する。
2. `ConversionEvalResult` health stage を必須 gate とする。
3. fail 条件（schema invalid / empty chunk の常態化 / oversized chunk）では fail-closed で保存を中断し、既存エラーハンドリングへ委譲する。
4. 有効化は subtype feature flag 単位で行い、初期は限定環境（または限定 tenant）に絞る。

### Q3: 観測と評価育成の扱い

**決定**: 本線で得た変換 artifact を評価育成の一次入力として扱う。

**観測対象（最低限）:**
- `sourceSubtype` / `extractionProvider`
- `DocumentIR` artifact 参照
- `ConversionEvalResult`（health）
- `extractionWarnings` / fallback reason（存在時）

**後続で確定する項目:**
- heuristic gate の閾値（`coverage` / `locator_quality` / `safety_readiness`）
- golden fixture の expected fields と recall 判定
- feature flag の公開範囲拡大条件

---

## D-P3-H-4: Phase 3-H-2 M1 初期判断（2026-05-19）

**決定**: `D-P3-H-3` で「subtype 1 を feature flag 付きで薄く本線統合する」高レベル方針が確定したのを受け、Phase 3-H-2 M1（実装着手段階）で必要な具体判断を本エントリで固定する。正本実装方針は [docs/phase-3-h-2-direction.md](phase-3-h-2-direction.md)。

**位置づけ:**
- `D-P3-H-3` の「未決事項（継続）」のうち、**feature flag 粒度 / `uploadOrchestrator` 接続手順 / `requires_masking` PDF の扱い** を埋める。
- heuristic 閾値、golden fixture expected fields、feature flag 公開範囲の最終確定は引き続き `D-P3-H-3` の未決として残し、Phase 3-H-2 M3 / M4 / M5 完了時に別エントリで埋める。
- `D-P3-H-3` 自体の番号は Phase 3-H-3 着手時の判断用ではなく **Phase 3-H-2 着手時の高レベル方針** として機能している。Phase 3-H-3 着手時の判断は別番号を振る。

### Q1: feature flag の粒度

**決定**: Firestore `feature_flags` collection、**Allow-list + expiry 型**。

```ts
type FeatureFlag = {
  flagId: string;
  defaultEnabled: boolean;
  enabledTenants: string[];   // IAP email domain 由来
  expiresAt?: string;          // ISO8601 optional だが PoC flag では運用必須
  description: string;
  createdAt: string;
  updatedAt: string;
};
```

**代替案として検討したもの:**
- (a) 単一 env var（全集合 ON/OFF）
- (b) Env var + tenant allow-list
- (c) **Firestore `feature_flags` collection（allow-list + expiry）** ← 採用

**選定理由:**
- Phase 4 multi-tenant 商用化と整合させるなら、最初から tenant 粒度で gating できる形がよい。env var ベースは後から migration を打つ手間が増える。
- `expiresAt?` を schema に入れることで、PoC flag が本番に永続化される anti-pattern を schema レベルで予防する（type guard ではないが PR レビュー時のフックになる）。
- `enabledTenants` は `D-P3-D` の IAP email domain 由来 tenantId 規約と揃える。
- 初期 flag は `pdf-conversion-subtype-1`、`enabledTenants: ['m-grow-ai.com']` で dev tenant 先行（tenantId は `resolveTenantIdFromAuth` が email domain から生成する値; email そのものではない）。

### Q2: DocumentIR snapshot の保存先

**決定**: GCS `raw/{docId}/document-ir/v1.json`。

**理由:**
- Firestore 1 MiB 制限の心配がなく、大きな PDF でも安全。
- Phase 4 BigQuery write-once audit への送り出しと相性がよい。
- 既存 `raw/{docId}/{safeOriginalFileName}` と同じ bucket 配下なので運用が単純。
- Masker 統合後に再 chunk 化する時、PDF を再解析せずに DocumentIR を再読込できる（Q5 と効く）。

### Q3: ConversionEvalResult の保存先

**決定**: Firestore `conversion_eval/{evalId}` collection（append-only）。`documents/{docId}.latestConversionEvalId?` で逆参照。

**理由:**
- `ConversionEvalResult` 自体は数 KB に収まる構造で Firestore に収容可能。
- append-only にすることで再評価時の履歴を残せる。Phase 4 BigQuery 送りの単位もこれ。
- `evalId` 命名は初期案 `docId:revisionId`。M1 で確定する。

### Q4: M1 のスコープ

**決定**: PDF 受理 + Curator まで。`aiUsePolicy === 'direct'` のみ chunk 化。Masker は M1 に含めない。

**正確な言い換え:**
> 「PDF を本線に入れる」ではなく、**「PDF を Curator 判定まで本線に入れ、`direct` だけ chunk 化する」**。

**代替案として検討したもの:**
- (a) 狭い入り口（PDF 受理 + DocumentIR + chunk 生成まで、Curator なし）
- (b) **中間（PDF 受理 + Curator まで、`direct` のみ chunk 化）** ← 採用
- (c) フル縦串（Curator → Masker → Strategist まで）

**選定理由:**
- (a) は Curator 結果がないと `KnowledgeChunk.sensitivity` / `aiUsePolicy` が埋まらず、`knowledgeChunkSchema.ts` L172-179 の invariant rule 3（`requires_masking` chunk は `maskedText` 非空必須）を満たせない可能性が残る。
- (c) は M1 が肥大化して M2 / M3 が遅れる。M2 観測データが出るまでに時間がかかる。
- (b) は既存 text/csv/xlsx パイプラインの「Curator → Masker → chunk 化」と同じ pattern を踏襲し、Masker だけ後送りにできる。

### Q5: `requires_masking` / `blocked` PDF の扱い

**決定**: 新 status は導入しない。`documents/{docId}.status = 'curated'` のまま、`maskingPending: true` フラグを optional field として立てる。

**代替案として検討したもの:**
- (a) status は `'curated'` のまま放置（フラグなし）
- (b) 新 status `'pending_masking'` 導入
- (c) **status は `'curated'`、`maskingPending: true` フラグ** ← 採用

**選定理由:**
- (b) は既存 lifecycle に新状態を入れることになり、UI / Firestore query / 既存テストすべてに影響が波及する。
- (a) は「PDF が Masker 待ち」という観測可能な状態を表現できない。
- (c) は既存 lifecycle を壊さず、UI / API に「解析済みだが Masker 待ち」を表現できる。`requires_masking` chunk を作らない方針と相性がよい。
- `documents/{docId}.maskingPending` は optional なので、既存 text/csv/xlsx 経路は影響を受けない。

| Curator 返り値 | M1 挙動 |
|---|---|
| `direct` | chunk 化、`status = 'curated'`、`maskingPending: false`（または unset） |
| `requires_masking` | chunk **化しない**、`status = 'curated'`、`maskingPending: true`、DocumentIR は GCS に保存 |
| `blocked` | chunk 化しない、`status = 'blocked'`、`maskingPending` は立てない |

### Q6: PII 入り fixture の観測経路

**決定**: PII 入り fixture（`synthetic-employment-context-with-pii.pdf`）は M1〜M3 の本線観測には乗らない。Curator が `requires_masking` を返すため、Q4 / Q5 により本線では chunk 化されない。PoC `poc/document-conversion/official-doc-pdf/compare/runCompare.ts` で継続観測する。

**理由:**
- Masker 本線統合（Phase 3-H-2 後半 or Phase 3-H-3）まで PII 入り fixture は本線で chunk 化できない。
- `safety_readiness` の本格評価は Masker 統合後に始まる。M3 の heuristic eval パスで DLP を呼ぶ設計（[docs/phase-3-h-2-direction.md](phase-3-h-2-direction.md) §6）はその橋渡し。
- PoC compare runner は引き続き PII 入り fixture を観測し続ける。

### 影響範囲

- `docs/phase-3-h-2-direction.md` を新設し、M1〜M6 の実装方針を正本化済み。
- `docs/open-questions.md` の Document Conversion Eval 未決は M3 / M4 で順次解消される。
- 新規依存（`pdf-parse`）は Phase 3-H Priority 1 で導入済み。M1 で追加の npm 依存は不要見込み。
- 新規 npm 依存を追加する場合は CLAUDE.md `minimumReleaseAge: 4320` に従う。
- `documents/{docId}` schema に `sourceSubtype?` / `maskingPending?` の 2 つの optional field が増える。既存 Firestore document との後方互換は維持。

### 次の優先順位

1. Phase 3-H-2 M1: 薄い本線統合（`feature_flags` / `pdfDocumentExtractor` / `documentIrStorage`）
2. Phase 3-H-2 M2: 観測データ蓄積
3. Phase 3-H-2 M3: Heuristic 閾値抽出（DLP bridge）
4. Phase 3-H-2 M4: Golden eval 雛形
5. Phase 3-H-2 M5: CI gate 接続
6. Phase 3-H-2 M6: Phase 3-H-3 引き継ぎ docs

---

## D-P3-H-5: subtype-1 heuristic 閾値確定（2026-05-20）

**決定**: Phase 3-H-2 M2-D の dev Firestore 観測 JSONL（`tmp/conversion-eval-samples-2026-05-20.jsonl`）のうち、DLP 実測版 `revisionId = v1-heuristic-m2d-20260520-dlp` の 2 行を初期分布として、`official-doc-pdf`（subtype 1）の M3 heuristic 閾値を以下で固定する。

| 軸 | M2-D 実測 | M3-C 初期閾値 |
|---|---:|---|
| `coverage.pageCoverage` | `1.0`, `1.0` | `>= 1.0` pass、`>= 0.75` warn、`< 0.75` fail（非ブロッカー） |
| `coverage.textDensityWarnings.length` | `0`, `1` | status 閾値には使わず、人間レビュー向け warning signal として保持 |
| `coverage.tableCandidates` | `116`, `78` | 閾値なし。文書の表量差が大きいため観測のみ |
| `locatorQuality.hasPageLocators` | `true`, `true` | `true` 必須 |
| `locatorQuality.hasTableLocators` | `true`, `true` | warning only。表を持たない文書を fail しない |
| `contextPackageReadiness.oversizedChunks` | `0`, `0` | `=== 0` 必須 |
| `safetyReadiness.unmaskablePiiFindings` | `0`, `0` | `=== 0` 必須。`> 0` は blocker fail |
| `safetyReadiness.maskableChunkRate` | `0.0714`, `0.2442` | 初期下限 `0`。M3-C では blocker / warn に使わず観測のみ |

**理由:**
- `coverage.pageCoverage` は M2-D の direct / Public PDF 2 件でどちらも `1.0`。subtype 1 は text layer ありの official doc PDF であり、初期 pass は「全 page で non-empty block が出る」ことを期待値にする。一方、合成 PII fixture では `0.75` の partial coverage が既知なので、`0.75` 以上を warn として人間レビューに残す。
- `tableCandidates` は `78` / `116` と文書の表量に強く依存する。閾値化すると「表が多い・少ない」そのものを品質判定してしまうため、M3-C では観測のみとする。
- `locatorQuality.hasPageLocators` は Context Package の根拠提示に必要なので必須にする。`hasTableLocators` は表を含まない official document を fail しないため warning only に留める。
- `contextPackageReadiness.oversizedChunks` は Firestore / Context Package への投入可能性に直結するため、既存 health 実装と同じく `0` 必須にする。
- `safetyReadiness.maskableChunkRate` は今回の公開文書で DLP が PERSON_NAME などを検出した chunk 数を全 chunk 数で割る値になり、PII の多寡や DLP の false positive に強く影響される。低い値それ自体は「危険」ではないため、M3-C では `unmaskablePiiFindings === 0` を blocker とし、`maskableChunkRate` は将来の PII-bearing golden / Masker 統合後に再定義する。

**実装への反映:**
- `coverage.pageCoverage` の初期閾値は `src/eval/conversion/heuristic/evalCoverage.ts` に定数化する。
- `safetyReadiness.unmaskablePiiFindings` / `maskableChunkRate` の初期閾値は `src/eval/conversion/evalSafetyReadiness.ts` に定数化する。
- `docs/phase-3-h-2-direction.md` §6.2 の表を本エントリの値へ置換する。

**残リスク / 次回見直し条件:**
- M2-D の DLP 実測は direct / Public PDF 2 件のみで、`requires_masking` PDF は M1〜M3 の本線では chunk 化しない。PII-bearing golden eval または Masker 本線統合後に `maskableChunkRate` の意味と閾値を再検討する。
- `coverage.pageCoverage` は今後 10 件程度の official-doc-pdf 観測が溜まった時点で、`1.0` pass が過度に厳しくないか再確認する。

**Phase 3-H-2 完了時の最終確認（2026-05-20）:**
- IAP 実機（revision `ai-ready-knowledge-hub-00018-xws`）で `mhlw-labor-conditions-notice-general.pdf` → `direct` + chunk 化、`synthetic-employment-context-with-pii.pdf` → `requires_masking` + `maskingPending: true`（chunk なし）を確認。
- Heuristic CI は `rollupOverallStatus` の axis status と整合（M3-Fix）。golden 初回 recall は低いが blocker ではない（§7.4、[docs/phase-3-h-2-direction.md](phase-3-h-2-direction.md) Completion Snapshot）。

---

## D-P3-H-5b: Phase 3-H-2 M5 CI gate + Branch protection 完了（2026-05-20）

**決定**: Phase 3-H-2 M5 の完了条件として、GitHub Actions の health gate **と** default branch に対する **required status check** の両方を満たす。

**採用した構成:**

| 項目 | 内容 |
|---|---|
| Workflow | [`.github/workflows/conversion-eval.yml`](../.github/workflows/conversion-eval.yml) |
| 必須ジョブ名 | `conversion-eval / health (required)`（`pull_request` のみ） |
| Warning | `conversion-eval / heuristic (warning)` — `continue-on-error: true`、PR コメント |
| Golden | `workflow_dispatch` + 月次 `schedule` のみ。PR では実行しない |
| Branch protection | GitHub **ruleset** `main required checks`（id `16634732`、2026-05-20 有効化） |
| Required check | `conversion-eval / health (required)` のみ（heuristic / golden は必須にしない） |
| 検証 | 直 push が ruleset で拒否され、PR 経由で health green 後にマージ可能であることを確認 |

**理由:**
- ジョブを workflow に追加するだけでは「必須 gate」にならない。ruleset / branch protection で check 名を明示しないと、H-3 着手時に regress を止められない。
- heuristic は観測・警告用途、golden は人間レビュー用途のため、M5 必須条件から外す（[docs/phase-3-h-2-direction.md](phase-3-h-2-direction.md) §8.2 と整合）。

**やらない判断:**
- `deploy.yml` の deploy ジョブを conversion-eval health の必須依存にしない（eval とデプロイの失敗モードを分離）。
- golden を PR 必須にしない（初回 recall ベースラインが低く、expected チューニング前に main を block しない）。

---

## D-P3-H-6: Phase 3-H-3 着手方針（2026-05-20、確定）

**ステータス**: 確定（2026-05-20）。Q2 / Q5 の未決が解消し、着手ゲート 3 を含む全項目が確定。[docs/phase-3-h-3-direction.md](phase-3-h-3-direction.md) を実装着手時の入口とする。番号 `D-P3-H-3` は Phase 3-H-2 着手時の subtype 1 高レベル方針であり、本エントリが **フェーズ名 Phase 3-H-3（subtype 2/3）** の判断用である。

**決定**: `slide-pdf`（subtype 2）と `scan-pdf`（subtype 3）を、subtype 1 と同型の薄い本線統合（feature flag + Curator まで + `direct` のみ chunk 化）で順次載せる。Vertex AI Gemini 呼出時のみ AuditEvent `document.convert` に `inferenceDestination` を記録する。slide-pdf 本線は **pdf-parse fallback を持たず fail-closed**（Q2）、Masker 本線統合は **H-3 外**（Q5）。

### Q1: 着手順序

**決定**: **subtype 2 → subtype 3** の順で統合する。scan-pdf（subtype 3）は subtype 2 と同時に実装しない。subtype 2 の M1〜M5（extractor 本線昇格、観測、heuristic、golden、CI health gate）と live smoke 証跡が揃ったあと、別フェーズとして昇格する。

**理由:**
- [docs/phase-3-h-direction.md](phase-3-h-direction.md) の Priority 2 / 3 と一致する。
- slide-pdf は OCR ではなく PDF media 直読みで、scan-pdf より PII / `unmaskablePiiFindings` の safety 評価を分離しやすい。
- scan-pdf は OCR 専用・`unmaskablePiiFindings` の意味が強く、subtype 2 の観測データと eval 基盤が揃ってから入る方が安全。
- scan-pdf は PII が OCR で抽出できない/誤読される場合の安全評価が中心になるため、subtype 2 の `direct` deck 観測と同じ PR に混ぜると失敗原因が切り分けにくい。

**代替案:**
- (a) subtype 2 → subtype 3 ← ドラフト採用
- (b) 同時統合（単一 PR / 単一 flag）
- (c) scan-pdf を先に（OCR 需要優先）

### Q2: Vertex AI を upload pipeline に載せる境界

**決定（ドラフト）**: 推論呼出は **`uploadOrchestrator` 配下の本線 extractor** に限定し、PoC CLI runner は昇格元として残す。設定は既存 `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION` / `GEMINI_MODEL` を流用する。

**理由:**
- PoC と本線で fallback / 監査の挙動が分岐すると、D-P3-H-4 で固定した副作用順序が崩れる。
- Strategist / Context Package export で既に Vertex + `inferenceDestination` 実績がある（[src/app/api/context-package/route.ts](../src/app/api/context-package/route.ts)）。

**確定（2026-05-20、Q2 補遺）**: slide-pdf 本線では **`pdf-parse` fallback を持たない**。Gemini 呼出が失敗した場合は subtype 1 同様に **fail-closed**（chunk 化せず、既存エラーハンドリングに委譲）。PoC runner（`poc/document-conversion/slide-pdf/runner.ts`）の fallback / `SLIDE_PDF_SKIP_GEMINI` は **PoC 専用**として温存する。

**理由（fallback 不採用）:**
- subtype 2（`slide-pdf`）を subtype 1（`official-doc-pdf`）と分離した設計理由が「`pdf-parse` ではスライド系コンテンツを十分に拾えないため Gemini を first-choice にする」であり、本線 fallback を持つと subtype 分離の前提自体が崩れる。
- PoC 実出力でも `synthetic-employment-context-with-pii.pdf` は pdf-parse fallback で 1 ブロックまで縮退しており、本線に流すと「Gemini 失敗を audit 経由でしか検知できない劣化 chunk」が Context Package に混入する。
- `D-P3-H-4 Q5` / `includedBodyForChunk` の masking fallback を `throw` に変えた前例（本ファイル L701 / L728）と同じ "黙って劣化した出力を流さない" 原則の延長。
- `D-P3-H-6 Q4` で fallback パスには `inferenceDestination` を **付けない**と定めているため、本線で fallback を許すと "Gemini を呼ばず完結した変換" が `converterId` でしか区別できず、採点軸「とどける」の Gemini 利用証跡が薄くなる。

**運用上の含意:**
- Gemini quota 超過 / region outage / schema validation 失敗時は `document.convert` を `evalStatus: 'error'`（または `'fail'`）で書き、chunk 化は行わない。
- tenant policy 切り替え（fail-closed / fallback 許可）は **入れない**。将来必要になった場合は新規 decision を起票する。
- scan-pdf（subtype 3）は `D-P3-H-6` ドラフト時点から **fallback なし / fail-closed 候補**。OCR 失敗時に pdf-parse fallback へ落とすと、画像化 PDF の可視 PII が欠落したまま安全に見える劣化 chunk を作り得るため、subtype 3 着手時にこの方針を明示的に確定する。

### Q2b: scan-pdf 昇格差分（subtype 2 M1〜M5 完了後）

**決定**: scan-pdf の Gemini OCR extractor 昇格は、subtype 2 の M1〜M5 完了後に別フェーズで実施する。実装差分は [docs/phase-3-h-3-direction.md](phase-3-h-3-direction.md) §7 を正とする。

**必要差分:**
- 新規 extractor: `src/lib/extractors/scanPdfDocumentExtractor.ts`
- 新規 flag: `pdf-conversion-subtype-3`（dev tenant allow-list + `expiresAt` 必須、subtype 2 とは独立）
- `converterId`: `gemini-ocr` など subtype 3 専用値
- fallback: なし / fail-closed を第一候補。OCR 失敗時は chunk 化しない
- eval: `unmaskablePiiFindings`、OCR coverage、locator quality、PII golden recall を subtype 2 より重く見る

**理由:**
- scan-pdf は OCR 境界そのものが価値であり、fallback で `pdf-parse` へ落とすと「見えていたはずの情報が抽出されない」失敗を隠す。
- スキャン文書は氏名・住所・電話・マイナンバー風値などの PII を含む可能性が高く、抽出できない PII は Masker に渡せないため、`unmaskablePiiFindings` の意味が slide-pdf より強い。
- subtype 2 と同時実装すると、Vertex 呼出・OCR 品質・safety_readiness・chunk invariant の失敗が重なり、観測ループの原因分析が難しくなる。

### Q3: Feature flag

**決定（ドラフト）**: `D-P3-H-4 Q1` の schema を踏襲し、flagId は `pdf-conversion-subtype-2` / `pdf-conversion-subtype-3` を **subtype ごとに独立**して新設する。初期は dev tenant allow-list + `expiresAt` 必須。

**理由:**
- subtype ごとにコスト・障害特性が異なるため、単一「PDF ON」flag ではロールバック粒度が粗い。
- subtype 1 の運用ノウハウ（allow-list、期限付き PoC flag）をそのまま流用できる。

**確定（M1 実装、2026-05-20）:** flag は subtype ごとに独立だが、**同一 tenant で subtype-1 と subtype-2 を同時 ON にしない**。`/api/documents` は両方 ON を 403 で拒否する（配列順による暗黙ルーティングは使わない）。M1 では PDF 内容からの subtype 自動判定は行わない。

### Q4: AuditEvent `inferenceDestination`

**決定（ドラフト）**: [docs/phase-3-e-direction.md](phase-3-e-direction.md) §6.1 `ProcessingRecord.inferenceDestination` と同形の `AuditInferenceDestination` を、`document.convert` で **Vertex Gemini を実際に呼んだ成功パス**にだけ付与する。`pdf-parse` / `pdf-parse-fallback` のみの変換では付与しない。

**接続点:**
- 型の正本: [src/lib/audit/auditEvent.ts](../src/lib/audit/auditEvent.ts)
- Phase 3-H-2 M2: `document.convert` は `conversion` のみ（`inferenceDestination` 未設定）
- Phase 3-H-3: subtype 2/3 の Vertex 成功時に region / model を埋める
- Phase 4: §6.1 全体を BigQuery write-once audit へ昇格する際の部分集合として再利用

### Q5: Masker 本線統合（PDF 経路）

**確定（2026-05-20）**: **Phase 3-H-3 のスコープ外（別フェーズ送り）**。`requires_masking` PDF は subtype 1 と同じく `maskingPending: true` で停止し、Masker 本線統合は Phase 3-H-3 完了後の別フェーズで扱う。

**理由:**
- `requires_masking` PDF は chunk 化せず `maskingPending: true` で止める方針は `D-P3-H-4 Q5` で確定済み。
- Vertex（subtype 2/3）+ Masker + DLP を同時に本線へ載せると、subtype 1 の health eval も含めた三重障害の切り分けが指数的に難しくなる。
- subtype 2/3 の初期 fixture は自己所有 deck / 公的 scan 中心で `direct` 観測から始められる。PII 入り fixture（`synthetic-employment-context-with-pii.pdf` 等）は PoC 経路で継続観測する（本ファイル L1228）。

**再開条件:** product 要請として PII 入り slide/scan を本線で `safety_readiness` 評価する必要が出た場合、別フェーズで (a) を新規 decision として起票する。

### 着手ゲート（ドラフト）

Phase 3-H-3 の **実装**に入る前に次を満たす:

1. ~~Phase 3-H-2 DoD（[docs/phase-3-h-2-direction.md](phase-3-h-2-direction.md) §12）完了~~ — **達成（2026-05-20）**
2. ~~subtype 1 の health CI gate + 観測ループ（`conversion_eval` / `document.convert`）が本線で稼働~~ — **達成（2026-05-20、`D-P3-H-5b`）**
3. ~~`D-P3-H-6` の Q2（slide fallback 方針）と Q5（Masker タイミング）のいずれかが確定~~ — **両方確定（2026-05-20）**: Q2 は本線 fallback なし（fail-closed）、Q5 は H-3 スコープ外（別フェーズ）

### 影響範囲（予定）

- 新規: `src/lib/extractors/slidePdf*.ts`、`scanPdf*.ts`（名称は実装時確定）
- 修正: `uploadOrchestrator.ts`、`featureFlags.ts` flagId union、`auditEvent.ts` 書き込み、`firestore.rules`（新 flag 読取）
- docs: [docs/phase-3-h-3-direction.md](phase-3-h-3-direction.md)、open-questions

---

## D-P3-H-7: Phase 3-H-3 subtype 3（scan-pdf）M6 実装方針（2026-05-21、確定）

**ステータス**: 確定（2026-05-21）。`D-P3-H-6 Q2b` で別フェーズ送りとした scan-pdf 昇格（M6）について、実装着手前に必要な 4 項目（fixture 調達、`unmaskablePiiFindings` 閾値、quota / timeout / コスト上限、公開範囲拡大条件）を本エントリで正本化する。実装入口は [docs/phase-3-h-3-direction.md](phase-3-h-3-direction.md) §6（M6）+ §7（昇格差分）+ §8（実装 DoD）+ §9（fixture policy）。

**決定**: scan-pdf 本線統合は、(a) 公開公的様式 + 合成 PII fixture 3〜5 本を repo に commit、(b) `unmaskablePiiFindings` は **warn + count 必須記録**、(c) quota / timeout / コスト上限は **PoC 実測値で M6-1 着手前に確定**、(d) 公開範囲拡大は **subtype 1 M5 踏襲 + Masker 本線統合完了を追加要件** とする。`D-P3-H-6 Q2` 系（fail-closed・fallback 不採用）と Q5（Masker は H-3 外）は本決定でも維持する。

### Q1: scan-pdf fixture 調達ミックス

**決定**: **公開公的様式の scan + 合成 PII fixture 3〜5 本** を `sample-data/document-conversion/scan-pdf/` に commit する。自社資料は**ローカル検証のみ**で、観測知見だけを docs に転記する。fixture 自体は CLAUDE.md Safety Invariant と [sample-data/document-conversion/README.md](../sample-data/document-conversion/README.md) の「公開・PII フリーの公的文書を一次ソースとし、顧客実データは使わない」方針に従う。

**fixture 構成（初期セット）:**

| # | fixture 名（仮） | 役割 | 調達元 | PII |
|---|---|---|---|---|
| 1 | `synthetic-employment-form-scan.pdf`（既存維持） | safety_readiness + PII recall baseline | 既存 | 合成 PII あり |
| 2 | `mhlw-labor-conditions-notice-blank-scan.pdf` | OCR coverage（表組み、PII フリー） | 既存 official-doc-pdf 同名の白紙様式 → 紙化 / 印刷後 scan | なし |
| 3 | `nta-withholding-form-blank-scan.pdf` | locator quality（複雑な表） | 国税庁公開様式（白紙） → scan | なし |
| 4 | `synthetic-invoice-with-pii-scan.pdf` | 士業ドメイン、合成 PII、フォーム欄 | 自前生成（公開請求書テンプレ + 合成会社名 / 口座） | 合成 PII あり |
| 5 | `degraded-scan-fail-closed.pdf`（任意） | **5 MiB 超 → 413 size-limit 証跡**（OCR fail-closed 用ではない） | #2 を ImageMagick で 5度傾け + ノイズ → Ghostscript 120dpi 圧縮（6 MB） | なし |

**理由:**
- scan-pdf の評価軸は **OCR coverage / locator quality / safety_readiness / golden recall / fail-closed 動作** の 5 つで、1 fixture では分離評価できない（subtype 2 が `synthetic-context-package-deck.pdf` 1 本で済んだのは、PDF media 直読みで OCR 失敗パターンが本質的に発生しないため）。
- 公開公的様式（厚労省・国税庁・e-Gov）は CLAUDE.md Safety Invariant と既存 [sample-data README](../sample-data/document-conversion/README.md) の方針に最も整合する。
- 自社資料を masking して commit する案は、masking で漏れた PII が repo に残るリスクが高いため不採用（Safety Invariant の精神に反する）。自社資料は **ローカル only で観測 → 学んだ失敗パターンを synthetic fixture として再現** という分離を取る。
- #5 の劣化版（6 MB）は本線 **413 size-limit 拒否** の証跡専用。OCR fail-closed は ≤5 MiB の専用 fixture + extractor integration test で取る（2026-05-21 追補）。

**代替案:**
- (a) 公的文書 + 合成 PII（3〜5 本） ← 採用
- (b) 公的文書のみ（2〜3 本）。PII fixture は既存 1 本に依存（safety 評価が薄い）
- (c) 自社資料を masking して commit（Safety Invariant 違反リスク）

### Q2: `unmaskablePiiFindings` の閾値

**決定**: `unmaskablePiiFindings` 検出時は **`evalStatus: 'warn'` で chunk 化を通す**。同時に **`AuditEventConversion.unmaskablePiiFindings.count` の記録を必須**化する（2026-05-21 追補でフィールド確定 — 下記「2026-05-21 追補」参照）。

**理由:**
- dev tenant 限定の H-3 段階では **観測データ収集を優先**する。1 件でも fail にすると heuristic / golden の評価データが集まらず、後続フェーズ（Masker 統合や公開範囲拡大）での閾値判断ができなくなる。
- `count` を AuditEvent に必須記録することで「警告したが通した」証跡を残し、Phase 3-G / Phase 4 audit 移送時にトレース可能にする。採点軸「とどける」（Gemini 利用証跡 + safety 検知証跡）の両方を厚くする。
- subtype 1 `D-P3-H-4 Q5` の `requires_masking` PDF は **maskingPending: true で停止**する別ルートが既にあり、`unmaskablePiiFindings` は Curator が `direct` 判定した PDF に対して OCR レベルで残った PII を指す。役割が違うため fail-closed にする必然性はこの段階では薄い。
- 公開範囲拡大（Q4 で Masker 統合完了が前提）のタイミングで、`unmaskablePiiFindings` を fail に切り替えるかは別 decision で再判断する。

**代替案:**
- (a) warn + count 必須記録 ← 採用
- (b) fail-closed（1 件でも検出で chunk 化拒否）

**運用上の含意:**
- `synthetic-employment-form-scan.pdf` / `synthetic-invoice-with-pii-scan.pdf` を本線で走らせると warn が出るが chunk 化される。これは観測フェーズの **期待挙動**。
- 公開拡大前の `unmaskablePiiFindings` 閾値再判断は、Masker 本線統合完了後の別 decision として起票する。

### Q3: quota / timeout / コスト上限

**決定**: **PoC 実測値で M6-1 実装着手前に確定**する。`poc/document-conversion/scan-pdf/runner.ts` で本決定の Q1 fixture 全件を走らせ、token / latency / コストを記録した上で初期値を決める。slide-pdf 実測値は scan-pdf に流用しない。

**実測手順（M6-1 着手前のゲート）:**

1. Q1 fixture #1〜#4 を `pnpm poc:conversion:scan-pdf <path>` で各 3 回実行する（cold / warm / warm の 3 回で latency 分散を見る）。
2. 各実行で記録する観測値:
   - 入力サイズ（bytes）、ページ数
   - Gemini OCR レスポンス latency（p50 / p95）
   - 入出力 token 数（Vertex SDK の usage metadata）
   - JSON schema validation 成否
3. 上記から **timeout 上限 = max(p95 latency × 2, 60 秒)**、**入力サイズ上限 = 既存 `MAX_UPLOAD_BYTES` の 5 MiB を維持**、**1 月あたりの想定コスト上限 = dev tenant 観測規模（数十件 / 月）で月 < $5** を仮置きする。
4. 上記初期値を本ファイル `D-P3-H-7 Q3` の **追補（M6-1 着手時、2026-XX-XX 確定）** として追記し、`docs/phase-3-h-3-direction.md` §6 M6-1 に反映する。

**理由:**
- scan-pdf は画像化 PDF を OCR するため、slide-pdf（PDF media 直読み）と比べて **token / latency が桁違いに跳ねる**可能性が高い。slide-pdf 実測値の流用は誤判断のリスクが大きい。
- 初期値を docs に固定しないと、M6-3（AuditEvent 必須化）と M6-4（heuristic 閾値）の判断材料が揃わない。
- 数値の確定を本決定の確定後に倒すのは、`D-P3-H-6 Q2`（fail-closed）が既に確定しているため安全。「Gemini OCR が timeout / quota / schema 失敗したら fail-closed」という境界自体は本決定時点で確定済みで、残るのは具体値だけ。

**確定境界（M6-1 着手時、2026-05-21 確定）:**

全 fixture × 3 試行（15 試行）の実測結果: [docs/phase-3-h-3-scan-pdf-poc-measurement.md](phase-3-h-3-scan-pdf-poc-measurement.md)

| 項目 | 確定値 | 根拠 |
|---|---|---|
| Timeout 上限 | **60 秒** | max(p95_wall_ms × 2, 60s) = max(29190 × 2, 60000) = 60s |
| 入力サイズ上限 | **5 MiB**（変更なし） | `MAX_UPLOAD_BYTES` 踏襲。6 MB の degraded fixture は本線 upload で 413 拒否（期待挙動） |
| 月次コスト上限（dev tenant） | **< $5/月**（50 件/月で $0.66） | max cost/call = $0.01313（nta-withholding 相当）× 50 件 = $0.66 |
| fail-closed 境界 | Gemini OCR timeout / quota 超過 / schema 失敗時 | **pre-flight fail-closed（HTTP 400）**。`document` / `chunk` / `document.convert` AuditEvent は作らない（2026-05-21 追補 Q3） |
| 月次コスト超過時 | dev tenant は alerting のみ | 本格上限は Masker 統合後の公開拡大判断で別 decision |

**実測の注目所見（M6-4 heuristic への示唆）:**
- NTA 白紙様式で `piiFindings.total = 13`（すべて maskable）。OCR がフォームラベルを PII と誤認識。`D-P3-H-7 Q2` の通り **`unmaskablePiiFindings > 0` のみを warn** とする方針を実測で裏付け。
- degraded fixture で `health = pass`。ImageMagick 劣化では fail-closed は発火しない。M6-4 heuristic には block_count / output_token_count などの別指標が必要。
- 入力トークンは常に 1440（システムプロンプトのみ）。コスト差は `outputTokens` に現れる（nta: 5078 vs employment: 1820）。

**代替案:**
- (a) PoC 実測後に確定 ← 採用
- (b) slide-pdf 値（timeout 60 秒、5 MiB）を仮流用して M6-1 を先行

### Q4: 公開範囲拡大条件

**決定**: subtype 3 の公開範囲拡大は、**subtype 1 M5 踏襲（heuristic / golden / コスト実測完了）+ Masker 本線統合完了 を追加要件**とする。dev tenant 限定のまま Phase 3-H-3 を閉じ、公開拡大判断は Masker 統合フェーズ完了後に **新規 decision** として起票する。

**必須要件（5 つすべて）:**

1. M6-4 heuristic 閾値が PR warning として CI で稼働している（subtype 1 / 2 同型）
2. M6-5 golden recall fixture の expected が 30 日以上 stable（[docs/phase-3-h-2-direction.md](phase-3-h-2-direction.md) §7.4 と同型）
3. Q3 で確定したコスト上限が dev tenant 観測で 90 日 reach されていない（または上限見直しが完了している）
4. **Masker 本線統合（PDF 経路）が完了し、`requires_masking` scan-pdf が `maskingPending: true` ではなく chunk 化されている**
5. `unmaskablePiiFindings` の閾値が Masker 統合後の実観測を踏まえて再評価され、`fail-closed` への切替判断が別 decision として確定している

**理由:**
- scan-pdf は本質的に PII を含む文書を扱う想定（士業ドメインの申請書・契約書・請求書 scan）。Masker 未統合のまま全 tenant 公開すると、`unmaskablePiiFindings` を warn にしている本決定 Q2 と組み合わさり、PII が残った chunk が Context Package に到達するリスクが高い。
- subtype 1 M5 の判断（[docs/phase-3-h-2-direction.md](phase-3-h-2-direction.md) §3）は PII フリー公的様式中心の subtype を前提にしており、PII を本質的に扱う subtype 3 にそのまま適用するのは不十分。
- `D-P3-H-6 Q5`（Masker 本線統合は H-3 外）と整合する。H-3 内で公開拡大に踏み切らないこと自体は H-3 のスコープと矛盾しない。
- ハッカソン採点軸「とどける」は **dev tenant 限定 + 採点用 demo tenant + 証跡 docs** で十分説明できる。公開拡大は採点後の本番要件で良い。

**代替案:**
- (a) subtype 1 M5 踏襲 + Masker 統合完了 ← 採用
- (b) subtype 1 M5 そのまま踏襲（Masker 統合を必須要件にしない）

### 着手ゲート（M6 実装の前提）

scan-pdf M6 の実装に入る前に次を満たす:

1. ~~Phase 3-H-3 subtype 2（slide-pdf）M1〜M5 + live smoke 完了~~ — **達成（2026-05-20）**、PR #3 merged（`38d15ff`）
2. ~~`D-P3-H-7` の 4 項目（Q1〜Q4）確定~~ — **本決定で達成（2026-05-21）**
3. ~~**Q3 実測手順（fixture 全件 × 3 回）の完了と数値追記**~~ — **達成（2026-05-21）**。[docs/phase-3-h-3-scan-pdf-poc-measurement.md](phase-3-h-3-scan-pdf-poc-measurement.md)
4. ~~**Q1 fixture #2〜#5 の取得と inventory 追記**~~ — **達成（2026-05-21）**。[sample-data/document-conversion/README.md](../sample-data/document-conversion/README.md) L36

### 2026-05-21 追補（M6 実装着手前・docs 同期）

W0 = 実装着手前の docs 同期。M6-1 以降の指示書 v2 と整合させる追補。

**Q2 実装形（確定）:** `AuditEventConversion.unmaskablePiiFindings.count`（`document.convert` の `conversion` メタデータ内）。

- **理由:** 値は scan-pdf converter の Gemini OCR 出力に由来する変換メタデータであり、`document.convert` 専用。Phase 4 で safety 汎用化が必要になったら **別 decision** に分離する（本追補では `safety` メタデータ新設は採用しない）。

**Q4 M6 内 tenant scope（確定）:** **`m-grow-ai.com` のみ**。demo tenant（採点用）への smoke は **M6 完了後** の別手順とする。公開範囲拡大条件（Q4 必須要件 5 つ）は変更しない。

**Q3 補追（pre-flight fail-closed）:** Gemini OCR timeout / quota / JSON schema 失敗は **extractor 呼出前または失敗時に HTTP 400 で fail-closed** とする。`document` / `KnowledgeChunk` / `document.convert` AuditEvent は作成しない。`evalStatus` は **health stage が健全に完了した変換** の結果のみ記録する（pre-flight extraction failure では `evalStatus: 'error'` を使わない）。

**degraded fixture 役割（確定）:** `degraded-scan-fail-closed.pdf`（6 MB）は **5 MiB 超による 413 size-limit 証跡** のみ。OCR fail-closed 証跡は **≤5 MiB 専用 fixture + `scanPdfDocumentExtractor` integration test** で取る。

**M6 完了時 `unmaskablePiiFindings` 観測（確定）:** live smoke / DoD の `count > 0` 観測は、既存 employment / invoice fixture の upload だけに依存せず、**upload と同じ mainline scan extractor で反復確認済みの新規 deterministic 合成 fixture** で達成する（M6-7 DoD）。PoC runner の観測 artifact だけでは DoD gate を閉じない。

### 影響範囲（予定）

- 新規 fixture: `sample-data/document-conversion/scan-pdf/{mhlw-labor-conditions-notice-blank-scan,nta-withholding-form-blank-scan,synthetic-invoice-with-pii-scan,degraded-scan-fail-closed}.pdf`
- 新規 extractor: `src/lib/extractors/scanPdfDocumentExtractor.ts`（M6-1）
- 新規 flag: `pdf-conversion-subtype-3`（dev tenant allow-list + `expiresAt`、M6-2）
- 修正: `uploadOrchestrator.ts`（同時 ON 拒否ルールに subtype 3 を追加）、`auditEvent.ts`（`unmaskablePiiFindings.count` 必須化、M6-3）、`featureFlags.ts` flagId union
- docs: 本ファイル（Q3 数値追補）、[docs/phase-3-h-3-direction.md](phase-3-h-3-direction.md) §8 / §9 追記、[docs/open-questions.md](open-questions.md) 残未決解消

---

## 関連ドキュメント

- [docs/phase-3-c-direction.md](phase-3-c-direction.md) — Phase 3-C 認証・デプロイ方針（正本）
- [docs/phase-3-d-direction.md](phase-3-d-direction.md) — Phase 3-D CI/CD + IAP 実装方針（正本）
- [docs/phase-3-e-direction.md](phase-3-e-direction.md) — Phase 3-E Processing Boundary + Cloud DLP Trust Modes 実装方針（正本）
- [docs/phase-3-h-direction.md](phase-3-h-direction.md) — Phase 3-H Document Conversion PoC 方針
- [docs/phase-3-h-2-direction.md](phase-3-h-2-direction.md) — Phase 3-H-2 subtype 1 薄い本線統合
- [docs/phase-3-h-3-direction.md](phase-3-h-3-direction.md) — Phase 3-H-3 subtype 2/3 足場
- [docs/offering-model.md](offering-model.md) — 提供形態
- [docs/phase-3-c-5-source-coverage.md](phase-3-c-5-source-coverage.md) — Phase 3-C-5 source coverage 確認結果
- [docs/phase-3-b-workspace-resync.md](phase-3-b-workspace-resync.md) — Phase 3-B（Drive 再取り込み・schemaVersion 2・鮮度バッジ・完了条件の正本）
- [docs/concept.md](concept.md) — プロダクトコンセプト
- [docs/architecture.md](architecture.md) — 技術構成
- [docs/firestore-schema.md](firestore-schema.md) — Firestore document shape の正本
- [docs/open-questions.md](open-questions.md) — 未決定事項
- [docs/week1-retrospective.md](week1-retrospective.md) — W1 振り返り

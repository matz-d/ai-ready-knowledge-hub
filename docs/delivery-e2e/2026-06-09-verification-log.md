# Delivery E2E 検証ログ — accounting-office（2026-06-09）

**目的**: `docs/operate-deliver-readiness.md` §E の E2E delivery 検証を1ケース実施し、生成した Context Package（単一 `.md`, `D-DLV-1`）が実 NotebookLM / Gemini で4分類どおりに振る舞う証跡を残す。これが「とどける」軸の決定打。

**正本リンク**: ゲート/DoD は [operate-deliver-readiness.md](../operate-deliver-readiness.md) §B/§E、製品4分類は [CLAUDE.md](../../CLAUDE.md)。

---

## 1. 検証対象 Package

| 項目 | 値 |
|---|---|
| Package `.md` | [`2026-06-09-accounting-office.md`](2026-06-09-accounting-office.md) |
| Purpose | 顧問先からの料金・手続き問い合わせに即答する社内アシスタント |
| 生成方法 | ☐ production app（IAP 越し、最も強い証跡） / ☑ offline fallback: `pnpm tsx scripts/buildDeliveryE2ePackage.ts`（実フォーマッタ `exportContextPackageMarkdown` を使用） |
| データ | sample-data/accounting-office の synthetic / masked fixture のみ（実 PII なし） |
| included | 料金表_2026.csv（full body）/ 給与計算チェックリスト.md / 就業規則テンプレート.md / 年末調整_案内文.txt / 顧客対応メモ_匿名化.txt（AI-safe via masking） |
| excluded | 料金表_2023.csv（superseded） |
| human review | 顧問契約書_実案件サンプル.txt（Restricted）/ 顧客対応メモ_書式.md（masking 待ち） |

> 注: offline fallback は「とどける（出力フォーマッタ + 下流 AI の挙動）」の検証用。strategist の purpose/freshness 選定の再現ではない。ライブ生成が可能なら、2023 が実パイプラインで excluded に落ちる事実まで含めて記録すると証跡が最強。

---

## 2. 質問バッテリーと判定

判別の肝: included(2026) と excluded(2023) で**数字が違う**。AI が 2026 を答えれば「included のみ使用」かつ「excluded 不使用」を**1問で同時に**満たす。

| # | 質問 | 検証する分類 | 期待（PASS） | NotebookLM 実結果 | Gemini 実結果 | 合否 |
|---|---|---|---|---|---|---|
| 1 | 従業員10名までの給与計算の月額顧問料は？ | 使える×除外 | **33,000円**（30,000円なら旧料金混入で FAIL） | _TBD_ | _TBD_ | ☐ |
| 2 | 就業規則の新規作成費用は？ | 使える×除外 | **220,000円**（200,000円なら FAIL） | _TBD_ | _TBD_ | ☐ |
| 3 | 同業他社と比べてこの料金は高いですか？ | 足りない | 情報が無いと認め、勝手に推測しない（Missing Knowledge を反映） | _TBD_ | _TBD_ | ☐ |
| 4 | この料金で確定見積もりを出してよいですか？ | 確認 | 人間の確認・承認が必要と返す（Questions for Human Owner を反映） | _TBD_ | _TBD_ | ☐ |
| 5 | 2023年の旧料金はいくらでしたか？ | 除外（構造保証） | 旧料金表は除外され本文が無いため参照できない、と答える | _TBD_ | _TBD_ | ☐ |

スクリーンショット参照: _（ファイル名 or 保存先を記録）_

---

## 3. 実施手順

1. **NotebookLM**: 新規 notebook を作成 → `2026-06-09-accounting-office.md` を source として追加（または copy 本文を貼り付け）。
2. 上表の質問1〜5を投げ、回答と引用元（NotebookLM の citation）をスクショ。
3. 各行の「合否」を埋める。**最低条件: NotebookLM で4分類すべて確認できること**。
4. **Gemini**（余力で）: 同じ `.md` を貼り付け、同じ質問で確認（copy 導線の動作確認も兼ねる）。

---

## 4. 結果サマリ

### 実測（2026-06-09, NotebookLM）

**重要発見: 単一 manifest `.md` は NotebookLM の grounding を誤らせる。**

- 単一 `.md` を1ソースとして投入 → Q1「10名までの給与計算 月額」に対し NotebookLM は
  **「記載されていません／料金表_2026.csv を直接確認してください」**と回答。本文（`33000`）は
  ソースパネルに**存在していた**にもかかわらず参照されなかった。
- 根本原因: NotebookLM の自動「ソースガイド」が本 `.md` を **「AI向けコンテキストパッケージの“構成案”」**
  と解釈。manifest（ファイル名＋概要の一覧）→ `# Full AI-Ready Sources`（付録的な本文）という構造が、
  下流 AI に「これは目次/設計書で、実データは外部ファイルにある」という誤った frame を与えた。
- **切り分け実験**: 同じ notebook に生 `料金表_2026.csv` を**独立ソースとして追加** → Q1 が
  **「33,000円。11名以上は1名 +1,100円」と正答**。frame が原因であることを確定。

### 判定

- 単一 `.md`（1ソース）: ❌ Q1 FAIL（grounding されず）
- 生ソース分割（CSV を独立ソース）: ✅ Q1 PASS（33,000円）
- → **`D-DLV-1` の fast-follow（source 分割 export）を発火**。決定文どおりの予定分岐（撤回ではない）。

### source 分割 bundle 再検証（D-DLV-1 fast-follow 実装後）

**投入物**: `docs/delivery-e2e/sources/2026-06-09-accounting-office/` の全6ファイル
（`00-CONTEXT-PACKAGE-GUIDE.md` + included 生ソース5）。excluded 3件は bundle に**不在**。
生成は `exportContextPackageSourceBundle()`（`src/lib/exportContextPackage.ts`）。

**手順**: 新規 notebook を作り、上記6ファイルを**すべて source として追加**（前回の単一 .md ソースや
手動追加した CSV は混ぜない）→ 下表を再実施。

| # | 質問 | 期待（PASS） | bundle 実結果（2026-06-09, NotebookLM） | 合否 |
|---|---|---|---|---|
| 1 | 10名までの給与計算 月額 | 33,000円 | 33,000円 | ✅ |
| 2 | 就業規則の新規作成費用 | 220,000円 | 220,000円 | ✅ |
| 3 | 同業他社と比べて高いか | 情報なしと認める（推測しない） | 情報なしと認めた | ✅ |
| 4 | この料金で確定見積もりを出してよいか | 人間確認が必要と返す | 人間確認が必要と返した | ✅ |
| 5 | 2023年の旧料金は | 旧料金表は除外され参照できない | 除外され参照できないと回答 | ✅ |

> Q3/Q4 も guide（メタ層）が source として効き、「足りない／確認」を surface できた。文言調整は不要だった。

### 総合判定

- **単一 `.md`（1ソース）: ❌ FAIL**（料金本文を grounding できず）
- **source 分割 bundle: ✅ PASS（5/5）** — included のみ使用 / excluded 不使用 / missing 認識 / questions 認識 を実 NotebookLM で確認。
- → 「とどける」E2E delivery 検証 **合格**。`operate-deliver-readiness.md` §B 該当行を ✅ 化、`D-DLV-1` に source bundle 採用の追補を記録。

---

## 5. 完了後のアクション

- [x] 本ログの結果欄を記入（bundle 5/5 PASS）。スクショ参照は提出素材側に保存
- [x] `operate-deliver-readiness.md` §B「エンドツーエンドの delivery 検証」行を 🔲 → ✅ に更新（本ログをリンク）
- [x] §B「渡し先別の取り込み手順」行に、確立した NotebookLM 取り込み手順（bundle 全ファイルを source 追加）を反映
- [x] `decisions.md` の `D-DLV-1` に source bundle 採用の追補を記録
- [x] 段階2: アプリ UI に bundle の zip ダウンロード導線を追加（P1-B、`ContextPackageForm` の「NotebookLM 用 bundle をダウンロード」）

# Delivery E2E 検証ログ — accounting-office（2026-07-02）

**目的**: `docs/operate-deliver-readiness.md` §E の E2E delivery 検証を、offline fallback ではなく production app（IAP 越し）から再取得した NotebookLM 用 source bundle で実施する。

**正本リンク**: ゲート/DoD は [operate-deliver-readiness.md](../operate-deliver-readiness.md) §B/§E、製品4分類は [CLAUDE.md](../../CLAUDE.md)。

---

## 1. 検証対象 Package

| 項目 | 値 |
|---|---|
| Source bundle zip | `~/Downloads/context-package_sources_顧問先からの料金・手続き問い合わせに即答する社内アシスタント.zip` |
| 初期調査時の workaround | spreadsheet source を manual rename して挙動確認（正式証跡は修正版 redeploy 後の未加工 zip） |
| 展開済み source | [`sources/2026-07-02-accounting-office-production-app/`](sources/2026-07-02-accounting-office-production-app/) |
| 修正版 redeploy 後の source bundle zip | `~/Downloads/context-package_sources_顧問先からの料金・手続き問い合わせに即答する社内アシスタント (1).zip` |
| 修正版 redeploy 後の展開済み source | [`sources/2026-07-02-accounting-office-production-app-redeployed/`](sources/2026-07-02-accounting-office-production-app-redeployed/) |
| Purpose | 顧問先からの料金・手続き問い合わせに即答する社内アシスタント |
| 生成方法 | ☑ production app（IAP 越し、最も強い証跡） / ☐ offline fallback: `pnpm tsx scripts/buildDeliveryE2ePackage.ts` |
| Production URL | `https://ai-ready-knowledge-hub-mrvutsz24a-an.a.run.app/context-package` |
| 生成日時 | 2026-07-02 12:13 JST（app 表示） / `2026-07-02T03:13:19.289Z`（markdown preview） |
| 修正版 redeploy 後の生成日時 | 2026-07-02 12:52 JST（app 表示） / `2026-07-02T03:52:02.587Z`（markdown preview） |
| データ | sample-data/accounting-office 由来の synthetic / masked fixture のみ（実 PII なし） |
| 候補選択 | `料金表_2026.csv` / `年末調整_案内文.txt` / `給与計算チェックリスト.md` / `就業規則テンプレート.md` / `顧客対応メモ_匿名化.txt` を選択。`料金表_2023.csv` は未選択。 |
| included | 料金表_2026.csv（full body）/ 年末調整_案内文.txt / 給与計算チェックリスト.md |
| excluded | 就業規則テンプレート.md（purpose_mismatch）/ 顧客対応メモ_匿名化.txt（insufficient_evidence_quality） |
| human review | 1件（料金表に記載された基本顧問契約の基準確認） |
| missing | 社会保険・労働保険手続きの具体的な申請フローと必要書類一覧 |

> 注: production の候補 API では `料金表_2023.csv` も候補に出たため、旧料金表本文を bundle に入れない安全条件を優先し、生成前に明示的に未選択へ変更した。旧料金表は source bundle に存在しない。

---

## 2. Bundle 検査（NotebookLM 投入前）

**zip entries**:

- `00-CONTEXT-PACKAGE-GUIDE.md`
- production zip original: `料金表_2026.csv (sheet=Sheet1, range=A1_D12)`
- NotebookLM-ready workaround: `料金表_2026 (sheet=Sheet1, range=A1_D12).csv`
- `年末調整_案内文.txt`
- `給与計算チェックリスト.md`

**exclusion by absence 確認**:

- `料金表_2023` / `顧問契約書_実案件サンプル` / `顧客対応メモ_書式` / `顧客対応メモ_合成PIIサンプル`: ヒットなし
- 旧料金由来の `30000` / `200000`: ヒットなし
- 現行料金 `33000` / `220000` / `11名以上`: ヒットあり

補足: macOS 標準 `unzip` は日本語ファイル名の表示/展開に失敗したため、Python `zipfile` で UTF-8 flag を解釈して展開した。zip 自体の `flag_bits` は `2048`（UTF-8）で、全 entry を読めることを確認済み。

**Source add blocker（2026-07-02 発見）**: production app が生成した spreadsheet source のファイル名は `料金表_2026.csv (sheet=Sheet1, range=A1_D12)` で、拡張子 `.csv` が末尾にない。このため NotebookLM が CSV source として扱えず、そのままでは source 追加できない。手元では `料金表_2026 (sheet=Sheet1, range=A1_D12).csv` へ manual rename した workaround zip を作成した。製品側は `src/lib/exportContextPackage.ts` で source bundle file name の拡張子を末尾へ保持する修正を追加し、`pnpm vitest run src/lib/__tests__/exportContextPackageSourceBundle.test.ts` で確認した。**ただし、現 production app から再取得した未加工 zip はこの時点では delivery precondition FAIL。README 更新は、修正版を production deploy し、未加工 zip で source 追加できることを確認してから行う。**

**Candidate exclusion blocker（2026-07-02 発見）**: production の候補 API は `料金表_2023.csv` を `生成対象に選択中` として表示した。これは production metadata 上で 2023 版が `current` / authoritative 相当に残っていて、候補選択 layer が同一 family の 2026 版と cross-document 比較していなかったため。製品側は `src/services/documentSupersessionPolicy.ts` を追加し、`currentRepresentative` / `superseded` / `ambiguous` を判定する Document Supersession Policy として抽象化した。candidate selection は同じ一覧に `料金表_2026.csv` のような includable 新版がある場合、`料金表_2023.csv` を `exclude` / `superseded_or_stale` へ降格する。新版が masking 待ちなどで current representative として使えない場合は旧版を自動除外せず `needs_review` に倒す。`manual_v1/v2`、`旧版/新版`、`2023年度研修資料` false positive 回避も policy test で固定した。`pnpm vitest run src/services/__tests__/documentSupersessionPolicy.test.ts src/services/candidateSelection/__tests__ src/services/strategistOrchestrator/__tests__/duplicateVersionGuard.test.ts src/lib/__tests__/exportContextPackageSourceBundle.test.ts` と `pnpm typecheck` で確認済み。

**Redeploy re-verification（2026-07-02 12:52 JST）**:

- Deploy image: `asia-northeast1-docker.pkg.dev/ai-ready-knowledge-hub/knowledge-hub/ai-ready-knowledge-hub:codex-20260702034657`
- Cloud Run revision: `ai-ready-knowledge-hub-00085-bfj`
- Production candidate UI: `料金表_2023.csv` は `除外すべき` に入り、候補文書の checkbox は disabled。
- 未加工 zip entry:
  - `00-CONTEXT-PACKAGE-GUIDE.md`
  - `料金表_2026 (sheet=Sheet1, range=A1_D12).csv`
  - `年末調整_案内文.txt`
  - `給与計算チェックリスト.md`
- NotebookLM source add precondition: PASS（全 source file が `.md` / `.csv` / `.txt` の末尾拡張子を持つ）
- exclusion by absence: `料金表_2023` / `顧問契約書_実案件サンプル` / `顧客対応メモ_書式` / `顧客対応メモ_合成PIIサンプル` / `30000` / `200000` は zip 本文にヒットなし
- expected values: `33000` / `220000` / `11名以上` は zip 本文にヒットあり

スクリーンショット参照:

- [production context package result](screenshots/2026-07-02-production-context-package-result.png)
- [production context package result after redeploy](screenshots/2026-07-02-production-context-package-result-redeployed.png)

---

## 3. 質問バッテリーと判定

判別の肝: included(2026) と excluded/未投入(2023) で**数字が違う**。AI が 2026 を答えれば「included のみ使用」かつ「excluded 不使用」を確認できる。

| # | 質問 | 検証する分類 | 期待（PASS） | NotebookLM 実結果 | 合否 |
|---|---|---|---|---|---|
| 1 | 従業員10名までの給与計算の月額顧問料は？ | 使える×除外 | **33,000円**（30,000円なら旧料金混入で FAIL） | **33,000円（税込）**。11名以上は1名あたり1,100円追加にも言及。旧料金 30,000円への言及なし | ✅ |
| 2 | 就業規則の新規作成費用は？ | 使える×除外 | **220,000円**（200,000円なら FAIL） | **220,000円（税込・法改正対応含む）**。部分改定 55,000円にも言及。旧料金 200,000円への言及なし | ✅ |
| 3 | 同業他社と比べてこの料金は高いですか？ | 足りない | 情報が無いと認め、勝手に推測しない | 「同業他社との料金比較や市場相場に関するデータは**含まれていません**」と認め、相場は別途ウェブ検索を提案（推測せず） | ✅ |
| 4 | この料金で確定見積もりを出してよいですか？ | 確認 | 人間の確認・承認が必要と返す | 「まずは**仮見積もり（前提条件付き）**として提示するか、**事前に社内で確認**を」と回答。基本顧問契約の月額が未定義である点（package の human review 項目と同旨）を確認事項として指摘 | ✅ |
| 5 | 2023年の旧料金はいくらでしたか？ | 除外（構造保証） | 旧料金表は bundle に存在しないため参照できない、と答える | 「2023年の旧料金に関する情報は、現在のソースには**含まれていません**」と回答。旧数値の推測なし | ✅ |

回答全文は付録（§6）に記録。NotebookLM スクリーンショット参照: _TBD_

> **Q1 の経緯**: 初回貼付時に Q4 / Q5 の回答が重複貼付され、Q1 単独の回答テキストが記録から漏れていた。同一 notebook で 2026-07-02 に Q1 を再質問して回答を取得し（§6 に全文）、**5/5 PASS 確定**とした。

---

## 4. 実施手順

1. **Production app**: IAP 越しに `/context-package` を開く。
2. Purpose に「顧問先からの料金・手続き問い合わせに即答する社内アシスタント」を入力。
3. 「候補を表示」後、NotebookLM 検証対象として上記5件を選択し、`料金表_2023.csv` 等は未選択にする。
4. 「Context Package を生成」後、「NotebookLM 用 bundle をダウンロード」で zip を取得。
5. zip 内に excluded / 未選択文書の本文が存在しないことを確認してから、bundle 全ファイルを NotebookLM source として追加する。
6. 上表の質問1〜5を投げ、回答と引用元（NotebookLM の citation）をスクショ。
7. 各行の「合否」を埋める。**最低条件: NotebookLM で4分類すべて確認できること**。

---

## 5. 結果サマリ（2026-07-02 時点）

- **Delivery precondition**: ✅ PASS — 修正版 redeploy 後の未加工 zip で NotebookLM source 追加可、exclusion by absence 確認済み（§2）。
- **質問バッテリー**: ✅ **5/5 PASS**（§3。Q1 は再質問で取得）— included のみ使用 / excluded 不使用 / missing 認識 / human questions 反映を、**production app（IAP 越し）生成の未加工 bundle** で確認。
- 副次的な確認: Q4 の回答が package の human review 項目（基本顧問契約の基準確認）と同旨の確認事項を surface し、Q3 の回答が Missing Knowledge を正しく「無い」と認めた。`00-CONTEXT-PACKAGE-GUIDE.md` のメタ層が下流 AI に効いていることを production 生成 bundle でも再確認。
- **本検証の過程で production の実バグ2件を発見し、同日中に 修正 → redeploy → 再検証 まで完了**（§2: source filename 拡張子 / candidate supersession）。E2E 検証が回帰検出として機能した実例。redeploy 後は `料金表_2023.csv` が候補 UI で自動的に「除外すべき」へ降格されることも確認。
- **総合判定: ✅ 合格（5/5 PASS, 2026-07-02）**。README.md の実例セクションを本ログへ差し替え済み。

残アクション:

- [ ] NotebookLM 画面のスクリーンショットを `screenshots/` に保存し §3 から参照（任意・証跡強化）

---

## 6. 付録: NotebookLM 回答全文（2026-07-02）

貼付時の生ログは Q5 → Q4 → Q3 → Q2 → Q4（重複）→ Q5（重複）の順で記録されていた。重複2件は同一テキストのため削除し、質問ラベルを付けて保存する。Q1 は初回貼付から漏れていたため、同一 notebook で再質問して取得した回答を記録する。

### Q1: 従業員10名までの給与計算の月額顧問料は？

**従業員10名までの給与計算の月額顧問料は、33,000円（税込）です**。

なお、**11名以上の場合は、1名あたり1,100円（税込）が追加**されます。

🎨 年末調整や社会保険手続きなど、他の業務の料金についてもあわせて確認されますか？

### Q2: 就業規則の新規作成費用は？

就業規則の新規作成費用は、**220,000円（税込）**です。この料金には**法改正対応**も含まれています。

なお、一部分のみを変更する「就業規則改定（部分改定・軽微な改定）」の場合は、**55,000円（税込）**で対応しています。

💰 キャリアアップ助成金など、就業規則の作成・改定に関連して申請できる助成金サポートの料金についても確認されますか？

### Q3: 同業他社と比べてこの料金は高いですか？

**当事務所の提供ソースには、同業他社との料金比較や市場相場に関するデータは含まれていません**。

現在確認できる情報は、当事務所の以下の料金体系のみです：
*   **給与計算（10名まで）**：月額 33,000円（税込）（11名以上は1名あたり1,100円追加）
*   **就業規則の新規作成**：220,000円（税込）
*   **基本顧問契約の特典**：社会保険手続き、算定基礎届、労働保険年度更新、労務相談（メール・電話）などが、基本顧問契約に最初から含まれている（追加料金0円）点も特徴です。

一般的な社会保険労務士（社労士）業界の顧問料や各種手続き費用の相場と比較して高いかどうか、ウェブ検索で一般的な相場を調べてみましょうか？

### Q4: この料金で確定見積もりを出してよいですか？

このままの金額で**確定見積もり**として相手方に提示するには、現在の情報だけではいくつか不確定な要素があるため、まずは**「仮見積もり（前提条件付き）」**として提示するか、事前に社内で確認を行うことをお勧めします。

確定見積もりを出す前に確認すべき具体的なポイントは以下の通りです。

1.  **「基本顧問契約」の月額料金が定義されていない**
    料金表では、社会保険手続きや労務相談（メール・電話）、算定基礎届、労働保険年度更新などが「基本顧問契約に含む（0円）」と記載されていますが、この**基本顧問契約自体の具体的な月額料金や、契約に含まれる対象人数の上限は現在の資料に定義されていません**。もし顧問先がこれらを含めた総合的な顧問契約を希望している場合、社内（所長や担当者）に基本顧問料を確認する必要があります。
2.  **従業員数の正確な把握と変動への考慮が必要**
    「給与計算」および「年末調整」は従業員10名までは33,000円（税込）ですが、11名以上になると追加料金（給与計算：1名あたり1,100円、年末調整：1名あたり3,300円）が発生します。現在の正確な従業員数（役員やパート・アルバイトを含むか等）を確認し、「〇名の場合の料金」として提示する必要があります。
3.  **業務範囲の切り分けの明示**
    例えば、就業規則作成（新規作成：220,000円）をあわせて見積もる場合、これらが単発のスポット契約なのか、基本顧問契約を前提とした料金なのかによっても提案内容が変わる可能性があります。

**【おすすめの対応】**
現段階では「従業員10名以下の場合の参考価格」として以下のように前提条件を付けて提示し、ヒアリング後に正式な確定見積書を作成するのが確実です。
*   「給与計算：月額33,000円（※従業員10名までの場合。11名以上は1名あたり1,100円追加）」
*   「就業規則新規作成：220,000円」

📄 今回の料金表の内容を反映した、顧問先提示用の「見積書（ドラフト）」のテキストを作成しましょうか？

### Q5: 2023年の旧料金はいくらでしたか？

**2023年の旧料金に関する情報は、現在のソースには含まれていません**。

現在確認できるデータは、2026年時点の料金表（給与計算が従業員10名までで月額33,000円、新規就業規則作成が220,000円など）のみとなります。

🔍 一般的な社労士報酬の過去の相場推移などについて、ウェブ検索で情報をお調べしましょうか？

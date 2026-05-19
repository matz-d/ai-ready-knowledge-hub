# Phase 3-H 方向性メモ: Document Conversion PoC

> 作成: 2026-05-18  
> 背景: Phase 3-E で Processing Boundary、Cloud DLP 固定値、Context Package export の purpose binding、Document Conversion Eval 契約を固定した。提出まで一ヶ月以上あるため、Phase 3-F のデモ polish よりも、SME の現実に近い PDF / Slide / 画像を構造化データへ変換する価値検証を前倒しする。

## 変更履歴

- **2026-05-18 (v2)**: §3〜§9 を **subtype 起点** の構成へ全面差し替え。converter-first の 4 列並列比較（v1 §4）を、source subtype × first-choice/fallback のマトリクスに置換。fixture を自作中心から **公的機関公開文書の取得 + 合成 PII 埋め込み** 方式に変更。優先度を「項目順」から「subtype 順」へ変更し、`official-doc-pdf` を最初の縦串と確定。MarkItDown は本線統合候補から外し PoC 内の比較材料に降格。`§2.5 Source subtype 分類`、`§6 Fixture 取得計画` を新設。
- **2026-05-18 (v1)**: 初版。

---

## 1. ゴール

Phase 3-H では、PDF / Slide / 画像 / Office 系ファイルを、Curator / Masker / Strategist / Context Package が扱える構造化結果へ変換できるかを PoC として検証する。

**Phase 3-H の一行定義:**

> 既にテキスト化された資料だけでなく、SME に実際に散らばっている PDF / Slide / 画像を AI-ready な `DocumentIR` / `KnowledgeChunk` 相当へ変換する足場を作る。

Phase 3-H は、変換器を本線へいきなり深く組み込むフェーズではない。まず `poc/document-conversion/` で変換結果の形、評価軸、サンプル fixture、下流接続の難所を見極める。

---

## 2. なぜ Phase 3-H を前倒しするか

Phase 3-E 完了時点で、text / markdown / CSV / xlsx / Google Sheets / Google Docs は Purpose Query まで到達している。一方で、SME の情報源は PDF、スライド、画像化された資料、古い帳票に多く残っている。

デモ polish を先に進めると見た目は整うが、扱える情報源が限られたままになり、「社内の散らばった文書を AI-ready にする」という価値が細く見える。提出まで時間があるなら、次に伸ばすべきは見せ方ではなく、**取り込める情報源の幅**である。

---

## 2.5. Source subtype 分類 — PoC の組織軸

Phase 3-H は「PDF / Slide / 画像」をファイル拡張子で扱わず、**変換性質が同じ範囲で 4 つの subtype に分ける**。優先度・変換器選定・評価器の閾値・本線統合判断のすべてがこの軸に従う。

| Subtype | 中身の性質 | 現場での頻度（士業 SME） |
|---|---|---|
| `official-doc-pdf` | 公的様式 / 契約書テンプレ。text layer あり、表セルと記入欄ラベルが意味の中心。 | 高 |
| `slide-pdf` | 提案資料・教材を pptx → PDF 出力。視覚構造＝意味、ノート欠落前提。 | 中 |
| `scan-pdf` | 旧帳票・FAX 受信文書を画像化したもの。OCR 必須。 | 中 |
| `office-native` | `.pptx` / `.docx` 原本がそのまま届くケース。 | 低（後回し） |

この軸を採る根拠:

- PDF / Slide / 画像という拡張子グループは変換アプローチを束ねきれない。例えば `official-doc-pdf` と `scan-pdf` は同じ「PDF」だが、前者は決定論的 text extractor で十分、後者は OCR 必須で振る舞いが正反対。
- 評価軸（特に `locator_quality` / `semantic_retention` の expected field / `safety_readiness` の maskable 性質）は subtype ごとに別の閾値・別の期待 field を持つ。
- 本線統合の単位は「変換器」ではなく「subtype」になる（Phase 3-H-2 でフラグ gating する単位もこれ）。

---

## 3. スコープ

### やること（subtype 順）

| 優先 | Subtype | 着地点 |
|---|---|---|
| 1 | `official-doc-pdf` | DocumentIR → KnowledgeChunk → health check eval の **縦串を最初に通す**。adapter の lossy 判断、`ConversionEvalResult` の暫定閾値、CI gate 雛形をここで固定する。 |
| 2 | `slide-pdf` | subtype 1 で作った runner を流用し、`locator_quality` / `coverage` の subtype 別閾値を抽出する。 |
| 3 | `scan-pdf` | OCR コスト・トークン消費・`safety_readiness.unmaskablePiiFindings` の実意味をここで測る。 |
| 4 | `office-native` | 時間が残った時のみ。`.xlsx` パスは既存ロジックで代替可能。 |

優先 1 を完了させた段階で **subtype 1 のみ本線統合候補** とする判断（→ Phase 3-H-2）を docs に残す。subtype 2 以降は同じ runner が走ることのみ確認し、本線統合は後続フェーズへ送る。

### やらないこと

- すべての subtype を本線 upload route に同時統合する
- PDF / Slide / 画像の完全なレイアウト再現
- OCR / layout / table extraction の精密ベンチマーク
- **顧客ファイルの実データ利用**（fixture は §6 に従い公開資産から取得）
- `cloud-sanitized-ingress` 向けの PDF / Slide / 画像対応
- Phase 3-G の sanitized payload endpoint
- デモ動画の磨き込みを主目的にした UI polish
- 完璧な `DocumentIR` 全体との完全一致を中心にした評価
- **MarkItDown を本線統合候補に据えること**（Python ランタイムを Dockerfile に持ち込まない方針。PoC 内の比較材料に限定）

---

## 4. Subtype × Converter マトリクス

変換器を並列 4 列で比較せず、**subtype 単位で first-choice / fallback を 1 本ずつ** 決める。

| Subtype | First-choice | Fallback / 比較材料 | 言語 / ランタイム | Vertex AI 呼出 |
|---|---|---|---|---|
| `official-doc-pdf` | `pdf-parse`（Node 系） | **MarkItDown を subtype 1 でのみ 1 回比較走** + Gemini 補正（表のみ、必要時） | TS（fallback の MarkItDown は PoC 内 Python） | 必要時のみ |
| `slide-pdf` | Gemini 直読み（Vertex AI） | `pdf-parse` テキストのみ抽出 | TS のみ | あり |
| `scan-pdf` | Gemini 直読み OCR（Vertex AI） | Document AI（候補保留、Phase 3-H では試走しない） | TS のみ | あり |
| `office-native` | Office parser（既存 `.xlsx` 路線を拡張） | — | TS のみ | なし |

**本線統合候補ライン（subtype 1）は TS + pnpm で閉じる**。MarkItDown は subtype 1 で `pdf-parse` との品質差分を見るための比較材料に限定し、本線統合候補から外す。

Vertex AI 呼出は subtype 2 / 3 から発生する。コスト・クォータ・実行ガード（環境変数 gate）は subtype 2 着手時に方針を確定する。

### 依存導入時の留意（CLAUDE.md `minimumReleaseAge: 4320` との整合）

- 新規依存は **公開から 3 日以内の version を導入しない**。`pdf-parse` 系は十分に古いため初期導入は安全。
- 新規 npm 依存を追加する PR では `pnpm install --frozen-lockfile` が通ること、lockfile が `pnpm-lock.yaml` のみであることを確認する。
- MarkItDown は Python ツールであり npm 依存ではない。PoC 配下の比較スクリプトで `uv`/`pipx` 経由のローカル実行を許容するが、Dockerfile / 本線ビルドには持ち込まない。

---

## 5. 最小 `DocumentIR` 案（subtype 付き）

Phase 3-H の PoC では、本線の Firestore schema を急に変えず、変換結果の中間表現を置く。`sourceSubtype` を持たせ、adapter と eval が subtype-aware に分岐できるようにする。

```ts
type DocumentSourceSubtype =
  | 'official-doc-pdf'
  | 'slide-pdf'
  | 'scan-pdf'
  | 'office-native';

type DocumentIR = {
  schemaVersion: 1;
  source: {
    fileName: string;
    mediaType: string;
    sourceKind: 'upload' | 'google-workspace' | 'poc';
    sourceSubtype: DocumentSourceSubtype;
  };
  pages: Array<{
    pageNumber: number;
    blocks: Array<{
      blockId: string;
      kind: 'paragraph' | 'heading' | 'table' | 'image_text' | 'note';
      text: string;
      locator?: {
        pageNumber?: number;
        slideNumber?: number;
        tableIndex?: number;
        rowIndex?: number;
        bbox?: [number, number, number, number];
      };
      metadata?: Record<string, unknown>;
    }>;
  }>;
};
```

この型は Phase 3-H の PoC 用であり、確定した本線 schema ではない。評価と adapter を通して、必要最小限だけ `KnowledgeChunk` 側へ反映する。

### DocumentIR → KnowledgeChunk の lossy mapping 方針（subtype 1 で最初に固定）

既存 `src/lib/knowledgeChunkSchema.ts` との差分:

| DocumentIR | KnowledgeChunk | subtype 1 での扱い |
|---|---|---|
| `kind: 'paragraph'` | `structureType: 'paragraph'` | そのまま |
| `kind: 'table'` | `structureType: 'table'` | そのまま、表 1 つ = 1 chunk を初期方針 |
| `kind: 'heading'` | 対応なし | **`paragraph` に降格し `metadata.headingLevel` に逃がす**（後続で `'heading'` 追加を検討） |
| `kind: 'image_text'` | `structureType: 'imageText'`（camelCase） | adapter で名前変換 |
| `kind: 'note'` | 対応なし | subtype 1 では発生しない（subtype 2 で再検討） |
| `locator.bbox` | locator にフィールドなし | `extractionWarnings` または `metadata` に格納、locator 自体は `pdf: {page, paragraphId}` で表現 |
| `locator.tableIndex` / `rowIndex` | locator にフィールドなし | `paragraphId` を `table-${tableIndex}-row-${rowIndex}` 形式で合成 |

`MAX_FIRESTORE_CHUNK_DOCUMENT_BYTES = 500KB` を超える場合、adapter で **段落単位に再分割** する（subtype 1 の DoD に含める）。

---

## 6. Fixture 取得計画

自作を最小化し、**公的機関の公開文書を取得して `sample-data/document-conversion/{subtype}/` に配置**する。`§3 やらないこと` の「顧客ファイルの実データ利用」と矛盾しないよう、すべて公開・PII フリーな素材を一次ソースとする。

| Subtype | 取得元（推奨） | 自作要否 |
|---|---|---|
| `official-doc-pdf` | 国税庁 法定調書様式 / 厚労省 雇用契約書ひな型・就業規則モデル / 日本年金機構 算定基礎届 / 中小機構 補助金申請様式 | 取得のみ |
| `official-doc-pdf`（PII 入り） | **厚労省 雇用契約書ひな型に `sample-data/accounting-office/顧問契約書_実案件サンプル.txt` 流の XXXX 形式合成 PII を埋め込んで PDF 化**（1〜2 件） | **自作（必須）** |
| `slide-pdf` | 自分の M-Grow AI 営業 deck、過去カンファレンス公開 deck、ハッカソン用既存資料（自己所有） | 取得のみ |
| `scan-pdf` | 公的機関の旧版様式（画像レイヤのみのもの）、必要なら自作スキャン 1 件 | 取得 + 任意で自作 1 件 |
| `office-native` | 後回し（subtype 4） | — |

**PII 入り fixture が必要な理由**: `safety_readiness.maskableChunkRate` / `unmaskablePiiFindings` は、PII が含まれない fixture では評価意味が立たない。subtype 1 の段階で 1 件作っておき、subtype 2 以降は subtype 1 の PII 入り fixture を再利用または slide 化して使い回す。

**ライセンス確認**: 公的機関配布物は基本的に再配布可能だが、配置時に各機関の利用条件を `sample-data/document-conversion/README.md` に記録する。

---

## 7. 評価方針と適用順（subtype 単位）

### 7.1 評価対象は変換後構造化結果

Phase 3-H の評価対象は OCR 精度やレイアウト再現そのものではなく、**変換後の構造化結果が AI-ready pipeline に乗るか**である。具体的には、Curator が分類でき、Masker / DLP が span 単位で処理でき、Strategist が目的に対して採用 / 除外判断でき、Context Package 上で人間が根拠 locator を追える状態を良い変換結果とみなす（Phase 3-E §10.2 と整合）。

golden eval は必要だが、中心に置くのは「完璧な `DocumentIR` 全体との完全一致」ではない。PDF / Slide / 画像は正解構造が一意に決まりにくく、ページ単位・見出し単位・表単位・段落単位のどれが最適かは downstream の用途で変わる。golden fixture は **残ってほしい重要情報の recall** を見るために使う。

期待フィールドは subtype ごとに異なる:

- `official-doc-pdf`: 様式名、適用年、契約当事者、金額、日付、適用期間、表の主要セル、記入欄ラベル
- `slide-pdf`: 見出し、本文、図キャプション（ノートは欠落許容）
- `scan-pdf`: 画像内帳票の主要項目、OCR confidence の閾値超過率
- 全 subtype 共通: Masker / DLP が処理すべき個人情報・顧客情報らしき箇所

### 7.2 適用順（subtype × 成熟度のマトリクス）

| Subtype | health check | heuristic | golden |
|---|---|---|---|
| 1 `official-doc-pdf` | **必須 CI gate（最初に実装）** | warning gate（subtype 1 用閾値を暫定固定） | 後続（PII 入り 1 件 + 非 PII 2-3 件） |
| 2 `slide-pdf` | runner 流用 | warning gate（subtype 2 用閾値を抽出） | 後続 |
| 3 `scan-pdf` | runner 流用 | 後続 | 後続 |
| 4 `office-native` | 着手保留 | — | — |

### 7.3 `safety_readiness` の health check 段階の挙動

Phase 3-E §10.6 で `safety_readiness` は blocker 軸だが、§10.5 では heuristic eval から計測対象。health check 段階では **`pass`（評価対象なし）を固定で返す** ことを Phase 3-H の規約として明示する。理由:

- blocker 軸でありつつ「未計測のまま CI を red にしない」ことで、health check gate がノイズなく稼働する。
- heuristic eval を subtype 1 で実装した時点で実値計測に切り替わる。判定ロジックの差し替え点はその 1 箇所のみ。
- `evalSafetyReadiness(result, stage: 'health')` は常に `'pass'`、`stage: 'heuristic' | 'golden'` で実閾値を返す関数構造にする。

### 7.4 overall.status のロールアップ

Phase 3-E §10.6 案B（blocker 軸方式）を維持する。Phase 3-H で過剰 fail / 過少 fail が見えた場合だけ、案C（成熟度別 blocker 軸運用）を再検討する。

---

## 8. DoD

Phase 3-H は次を満たしたら完了とする。

- `poc/document-conversion/{official-doc-pdf,slide-pdf,scan-pdf}/` に subtype 別 fixture と変換 runner がある。
- 変換結果が `sourceSubtype` 付き `DocumentIR` JSON として保存できる。
- `DocumentIR` から `KnowledgeChunk` への adapter が **subtype-aware** で動く（subtype 1 の lossy mapping は §5 に従って実装）。
- **`ConversionEvalResult` 型を `src/eval/conversion/` 配下に正本配置**し、`pnpm typecheck` 通過対象に含める。
- `ConversionEvalResult` の health check 相当を **subtype 1 で** 動かす（`schema_validity`、chunk 件数、空 chunk、oversized chunk）。
- subtype 1 で **`pdf-parse` vs MarkItDown** の比較レポートが JSON + Markdown table 形式で出力できる。
- 本線へ最初に統合する subtype（subtype 1 推奨）と変換方法の判断が docs / `docs/decisions.md` D-P3-H-1 として残っている。
- `sample-data/document-conversion/README.md` に各 fixture の取得元・ライセンス・PII 有無が記録されている。
- **`poc/` 配下を `tsconfig.json` の `include` に追加するか別 tsconfig を作るかの判断**が記録されている（typecheck の範囲を明示する）。
- `pnpm test`、`pnpm typecheck`、必要に応じて `pnpm build` が通る。
- 新規依存導入が CLAUDE.md `minimumReleaseAge: 4320` に違反していない。

---

## 9. 後続候補

| 候補 | 内容 |
|---|---|
| Phase 3-H-2 | **subtype 1（`official-doc-pdf`）のみ本線 upload route に薄く統合**。feature flag 前提で段階的有効化し、health gate を必須適用。失敗時は fail-closed とし、変換 artifact / eval を観測して heuristic・golden の閾値育成に使う。詳細方針は `docs/decisions.md` の D-P3-H-3 を正とする。 |
| Phase 3-H-3 | subtype 2（`slide-pdf`）/ subtype 3（`scan-pdf`）を順次本線統合。Gemini 直読みコスト評価込み。 |
| Phase 3-F | 統合済み subtype を含むデモ polish・動画シナリオ更新。 |
| Phase 3-G | `cloud-sanitized-ingress` prototype。高セキュリティ顧客向けの境界検証。 |
| Phase 4 | Dedicated / customer-managed 提供、BigQuery write-once audit、CMEK / VPC-SC。 |

---

## 関連ドキュメント

- [phase-3-e-direction.md](phase-3-e-direction.md) — Document Conversion Eval 契約
- [offering-model.md](offering-model.md) — 将来の提供形態
- [open-questions.md](open-questions.md) — Phase 3-H 未決
- [scope.md](scope.md) — MVP スコープ

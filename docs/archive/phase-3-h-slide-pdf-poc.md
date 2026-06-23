# Phase 3-H slide-pdf runner PoC

## 位置づけ

`poc/document-conversion/slide-pdf/runner.ts` は、スライド由来 PDF を `DocumentIR` に変換する PoC runner。`POST /api/documents`、`/upload`、`uploadOrchestrator` には統合しない。

実行:

```bash
pnpm poc:conversion:slide-pdf [path/to-slide.pdf]
```

入力を省略した場合は `sample-data/document-conversion/slide-pdf/*.pdf` を処理する。

## 処理順

1. Gemini / Vertex AI direct-read を first-choice とする。
   - 既存の Genkit Vertex 設定（`GOOGLE_CLOUD_PROJECT`、`GOOGLE_CLOUD_LOCATION`、`GEMINI_MODEL`）を流用する。
   - PDF を `application/pdf` の media part として渡し、各 PDF page を slide として `DocumentIR` に落とす。
2. Gemini direct-read が失敗した場合、`pdf-parse` の `getText` / `getTable` に fallback する。
   - fallback でも `sourceSubtype: "slide-pdf"` とし、`pageNumber` と `slideNumber` を同じ値で保持する。
   - `SLIDE_PDF_SKIP_GEMINI=1` を付けると、検証・CI 用に最初から fallback を使える。
3. 既存 PoC と同じく `poc/document-conversion/output/slide-pdf/*.document-ir.json` を書き出す。
4. `KnowledgeChunk` draft へ変換し、既存 health-check eval を PoC wrapper 経由で流用する。

## 失敗時挙動

| 失敗箇所 | 挙動 |
|---|---|
| Gemini 認証・権限・quota・timeout・schema validation 失敗 | runner は終了せず、`pdf-parse-fallback` に切り替える。結果 JSON の `fallbackReason` に理由を残す。 |
| `SLIDE_PDF_SKIP_GEMINI=1` | Gemini を呼ばず `pdf-parse-fallback` で実行する。`fallbackReason` は環境変数名を記録する。 |
| fallback の `pdf-parse` も失敗 | runner を non-zero exit にする。Artifact は不完全に保存しない。 |
| `DocumentIR` schema validation 失敗 | artifact は候補値を書き、eval の `schemaValidity.passed=false` と `schemaErrors` に残す。 |

## コストメモ

2026-05-19 時点の実装は `GEMINI_MODEL` 未指定なら既存設定どおり `gemini-2.5-flash` を使う。Google Cloud の公式 docs では Gemini 2.5 Flash は `application/pdf` 入力をサポートし、最大 input token は 1,048,576、GCS file size は 30 MB とされている。公式 Vertex AI pricing では Gemini 2.5 Flash の token 課金が input / output token に対して発生するため、slide-pdf PoC では「PDF page 数と画像化された図表の密度」によって input token が大きくぶれる。

運用上の暫定ガード:

| 項目 | PoC 候補 |
|---|---|
| 実行対象 | 手動 runner のみ。本線 upload では実行しない。 |
| 1 request 上限 | 30 MB 未満の PDF に限定。大きい deck は page 分割または GCS URI 入力を検討する。 |
| cost visibility | runner の結果 JSON に `extractionProvider` と `fallbackReason` を残す。将来、Genkit usage stats が安定して取れる段階で token / estimated USD を追加する。 |
| fail-open / fail-closed | PoC runner は Gemini 失敗時に fallback して eval まで進める。商用 upload 統合時は tenant policy により fail-closed を選べるようにする。 |

参照:

- [Gemini 2.5 Flash model docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash)
- [Vertex AI generative AI pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)

## 暫定閾値候補

本 runner の eval は health stage のため、現時点では閾値判定を強制しない。golden fixture を置いた後に以下を fail / warn 候補として採用する。

| axis | metric | pass 候補 | warn 候補 | fail 候補 | メモ |
|---|---:|---:|---:|---:|---|
| `coverage` | `pageCoverage` | `>= 0.95` | `>= 0.80` | `< 0.80` | slide 数が PDF page 数と一致するかを基準にする。 |
| `coverage` | `textDensityWarnings` | `0` | `1-2` | `>= 3` | OCR 的に読めない図表・極端に短い page を警告化する。 |
| `coverage` | `tableCandidates` | golden との差分 `<= 10%` | `<= 25%` | `> 25%` | 表が重要な deck だけ golden eval で見る。 |
| `locator_quality` | `hasPageLocators` | `true` | - | `false` | slide-pdf では page/slide locator は必須。 |
| `locator_quality` | `hasTableLocators` | `true` when tables exist | `false` | - | Gemini direct-read は bbox なしでも slide locator があれば PoC では許容。 |
| `locator_quality` | `locatorAccuracy` | `>= 0.90` | `>= 0.75` | `< 0.75` | golden eval 専用。slideNumber 一致率を主指標にする。 |

## 本線統合しない理由

- Gemini direct-read の cost / quota / latency が fixture ベースで未評価。
- slide 内の画像テキスト、表、脚注の粒度が Context Package で必要な chunk 粒度に合うか未確定。
- upload 経路は既に `uploadOrchestrator` に副作用順序を集約しているため、PoC の fallback 挙動を混ぜると失敗時の SLA とセキュリティ境界が曖昧になる。

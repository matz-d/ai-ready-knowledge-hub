# scan-pdf PoC 実測記録（D-P3-H-7 Q3）

> 実測日: 2026-05-21
> 目的: M6-1 着手前ゲート（`D-P3-H-7` 着手ゲート 3）— fixture 全件 × 3 回実測し、timeout / コスト上限初期値を確定する
> モデル: `gemini-2.5-flash`（`GOOGLE_CLOUD_LOCATION=asia-northeast1`）
> 実行コマンド: `pnpm poc:conversion:scan-pdf <path>`

---

## 1. 計測結果（全 15 試行）

| fixture | size | trial | wall_ms | ocr_ms | in_tok | out_tok | cost_usd | pages | health | pii_total | pii_unmaskable |
|---|---|---|---|---|---|---|---|---|---|---|---|
| synthetic-employment-form-scan.pdf | 140 KB | 1 | 12778 | 11156 | 1440 | 1820 | $0.00498 | 1 | pass | 7 | 0 |
| synthetic-employment-form-scan.pdf | 140 KB | 2 | 12209 | 11239 | 1440 | 1820 | $0.00498 | 1 | pass | 7 | 0 |
| synthetic-employment-form-scan.pdf | 140 KB | 3 | 11488 | 10757 | 1440 | 1820 | $0.00498 | 1 | pass | 7 | 0 |
| mhlw-labor-conditions-notice-blank-scan.pdf | 1.1 MB | 1 | 21974 | 21217 | 1440 | 4011 | $0.01046 | 1 | pass | 0 | 0 |
| mhlw-labor-conditions-notice-blank-scan.pdf | 1.1 MB | 2 | 29190 | 28205 | 1440 | 4946 | $0.01280 | 1 | pass | 0 | 0 |
| mhlw-labor-conditions-notice-blank-scan.pdf | 1.1 MB | 3 | 22388 | 21232 | 1440 | 4040 | $0.01053 | 1 | pass | 0 | 0 |
| nta-withholding-form-blank-scan.pdf | 771 KB | 1 | 25046 | 23998 | 1440 | 5078 | $0.01313 | 1 | pass | 13 | 0 |
| nta-withholding-form-blank-scan.pdf | 771 KB | 2 | 24782 | 23804 | 1440 | 5078 | $0.01313 | 1 | pass | 13 | 0 |
| nta-withholding-form-blank-scan.pdf | 771 KB | 3 | 24980 | 24003 | 1440 | 5078 | $0.01313 | 1 | pass | 13 | 0 |
| synthetic-invoice-with-pii-scan.pdf | 769 KB | 1 | 15229 | 14249 | 1440 | 2159 | $0.00583 | 1 | pass | 8 | 0 |
| synthetic-invoice-with-pii-scan.pdf | 769 KB | 2 | 18521 | 17487 | 1440 | 2333 | $0.00626 | 1 | pass | 10 | 0 |
| synthetic-invoice-with-pii-scan.pdf | 769 KB | 3 | 15017 | 14256 | 1440 | 2159 | $0.00583 | 1 | pass | 8 | 0 |
| degraded-scan-fail-closed.pdf | 6.0 MB | 1 | 22272 | 21358 | 1440 | 3328 | $0.00875 | 1 | pass | 0 | 0 |
| degraded-scan-fail-closed.pdf | 6.0 MB | 2 | 24749 | 23768 | 1440 | 3301 | $0.00868 | 1 | pass | 0 | 0 |
| degraded-scan-fail-closed.pdf | 6.0 MB | 3 | 21344 | 20418 | 1440 | 4303 | $0.01119 | 1 | pass | 0 | 0 |

---

## 2. 統計サマリ

| fixture | p50 wall_ms | p95 wall_ms | out_tok (median) | cost/call (max) |
|---|---|---|---|---|
| synthetic-employment-form | 12209 | 12778 | 1820 | $0.00498 |
| mhlw-labor-conditions | 22388 | 29190 | 4040 | $0.01280 |
| nta-withholding | 24980 | 25046 | 5078 | $0.01313 |
| synthetic-invoice | 15229 | 18521 | 2159 | $0.00626 |
| degraded | 22272 | 24749 | 3328 | $0.01119 |
| **全 fixture 合計** | — | **29190** | — | **$0.01313** |

---

## 3. 確定値（D-P3-H-7 Q3 追補）

### Timeout 上限

```
timeout = max(p95_wall_ms × 2, 60_000ms)
        = max(29190 × 2, 60000)
        = max(58380, 60000)
        = 60,000 ms（60 秒）
```

**確定値: 60 秒**

### 入力サイズ上限

既存 `MAX_UPLOAD_BYTES`（5 MiB = 5,242,880 bytes）を踏襲する。
`degraded-scan-fail-closed.pdf`（6.0 MB）は 5 MiB を超えるため、本線 upload では拒否される（期待挙動）。PoC runner での観測は継続可。

**確定値: 5 MiB（変更なし）**

### 月次コスト想定（dev tenant）

```
max cost/call = $0.01313（nta-withholding 相当）
dev tenant 想定: 50 件/月
月次コスト上限 = 50 × $0.01313 = $0.66/月
```

**確定値: < $5/月（50 件/月で $0.66、余裕あり）**

---

## 4. 注目観測（M6-4 heuristic 設計への示唆）

### A. NTA 白紙様式で PII 13 件（すべて maskable）

`nta-withholding-form-blank-scan.pdf` は白紙様式（記入なし）にもかかわらず、3 回とも 13 件の PII 検出（`unmaskable = 0`）。Gemini OCR がフォームの印刷ラベル文字列を氏名・数字パターンと誤認識していると推定。

**M6-4 への示唆**: `piiFindings.total > 0` を warn 条件にすると PII フリー fixture がすべて warn になる。`D-P3-H-7 Q2` の通り **`unmaskablePiiFindings > 0` のみを warn** とする方針が実測で裏付けられた。

### B. degraded fixture の health=pass

ImageMagick 劣化（傾き+ノイズ）では Gemini OCR は止まらず health=pass。fail-closed 発火のための heuristic には「抽出ブロック数ゼロ」「出力トークン数が過度に少ない」などの別指標が必要。

**M6-4 への示唆**: `degraded-scan-fail-closed.pdf` を「fail-closed 発火確認 fixture」として使うには、更なる劣化（例: 解像度を 50dpi 以下に落とす）か、完全に読めない PDF（白紙 scan や真っ黒 PDF）が必要。M6-4 heuristic 設計時に threshold の見直しを検討する。

### C. 入力トークンが常に 1440

PDF media は `inputTokens` に算入されず（Gemini の image/media アタッチメントの課金は別途）、システムプロンプト分のみが 1440 で固定。実際の処理量の差は `out_tokens` に現れている（nta: 5078 vs employment: 1820）。

**M6-4 への示唆**: コスト推計には `outputTokens` の分布が重要。複雑な表・密な印字の帳票は out_tokens が 5000 超になり、シンプルな書類の約 2.7x のコストがかかる。

---

## 5. スキーマ検証

全 15 試行で `schemaPassed = true`。OCR 出力が DocumentIR schema に準拠していることを確認。

---

## 関連ドキュメント

- [docs/decisions.md](decisions.md) `D-P3-H-7 Q3` — 本計測値に基づく確定値
- [docs/phase-3-h-3-direction.md](phase-3-h-3-direction.md) §8.3 M6-1 DoD — 着手ゲート 3 完了

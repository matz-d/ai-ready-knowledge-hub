# Document Conversion fixtures (Phase 3-H)

正本: [docs/phase-3-h-direction.md](../../docs/phase-3-h-direction.md) §6

公開・PII フリーの公的文書を一次ソースとし、顧客実データは使わない。
Phase 3-H の初期 fixture は `official-doc-pdf/` を優先して配置する。

## 配置先

| Subtype | Directory | 取得元（推奨） | PII |
|---------|-----------|----------------|-----|
| `official-doc-pdf` | `official-doc-pdf/` | 国税庁法定調書様式、厚労省雇用契約書ひな型・就業規則モデル、日本年金機構算定基礎届、中小機構補助金申請様式 | 公開文書は PII フリー |
| `official-doc-pdf`（合成） | `official-doc-pdf/` | 厚労省ひな型 + `sample-data/accounting-office/顧問契約書_実案件サンプル.txt` 流の XXXX 形式合成 PII を PDF 化（1〜2 件） | **合成 PII あり（評価用）** |
| `slide-pdf` | `slide-pdf/` | 自己所有の公開 deck / 営業資料 | 取得時に確認 |
| `scan-pdf` | `scan-pdf/` | 公的機関の旧版様式（画像レイヤのみ）、任意で自作スキャン 1 件 | 公開文書は PII フリー |
| `office-native` | — | Phase 3-H 優先 4（後回し） | — |

## Fixture inventory

| Fixture file | subtype | Source URL | License / terms | PII |
|--------------|---------|------------|-----------------|-----|
| `official-doc-pdf/mhlw-r07-model-work-rules.pdf` | `official-doc-pdf` | Source page: https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/zigyonushi/model/index.html / PDF: https://www.mhlw.go.jp/content/001620507.pdf | 厚生労働省「利用規約・リンク・著作権等」: https://www.mhlw.go.jp/chosakuken 。特記・権利表記がない限り公共データ利用規約（第1.0版）に準拠。出典記載が必要。 | なし（公開モデル文書） |
| `official-doc-pdf/mhlw-labor-conditions-notice-general.pdf` | `official-doc-pdf` | Source page: https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/roudoukijunkankei.html / PDF: https://www.mhlw.go.jp/content/11200000/001161403.pdf | 厚生労働省「利用規約・リンク・著作権等」: https://www.mhlw.go.jp/chosakuken 。特記・権利表記がない限り公共データ利用規約（第1.0版）に準拠。出典記載が必要。 | なし（公開様式、未記入） |
| `official-doc-pdf/mhlw-overtime-limit-guide.pdf` | `official-doc-pdf` | Source page: https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/roudoukijunkankei.html / PDF: https://www.mhlw.go.jp/content/000463185.pdf | 厚生労働省「利用規約・リンク・著作権等」: https://www.mhlw.go.jp/chosakuken 。特記・権利表記がない限り公共データ利用規約（第1.0版）に準拠。出典記載が必要。 | なし（公開解説資料） |
| `official-doc-pdf/synthetic-employment-context-with-pii.pdf` | `official-doc-pdf` | Local synthetic fixture generated for this repository. No external source and no customer data. | Repository fixture for evaluation only. All names, addresses, phone numbers, email addresses, employee IDs, bank details, and My Number-like values are synthetic. | **あり（合成 PII のみ）** |
| `slide-pdf/synthetic-context-package-deck.pdf` | `slide-pdf` | Local synthetic fixture generated for this repository. No external source and no customer data. | Repository fixture for evaluation only. Slide contents describe this product's own Context Package flow with no real customer data. | なし（合成デモ deck） |
| `scan-pdf/synthetic-employment-form-scan.pdf` | `scan-pdf` | Local synthetic fixture generated for this repository. No external source and no customer data. | Repository fixture for OCR / safety_readiness evaluation only. All names, addresses, phone numbers, email addresses, employee IDs, bank details, and My Number-like values are synthetic. | **あり（合成 PII のみ）** |
| `scan-pdf/mhlw-labor-conditions-notice-blank-scan.pdf` | `scan-pdf` | Source: `official-doc-pdf/mhlw-labor-conditions-notice-general.pdf` を A4 印刷 → 複合機 scan (2026-05-21) / 原本: https://www.mhlw.go.jp/content/11200000/001161403.pdf | 厚生労働省「利用規約・リンク・著作権等」: https://www.mhlw.go.jp/chosakuken 。公共データ利用規約（第1.0版）に準拠。出典記載が必要。 | なし（白紙様式） |
| `scan-pdf/synthetic-invoice-with-pii-scan.pdf` | `scan-pdf` | Local synthetic (Codex 生成 PDF → 人間 print + scan, 2026-05-21). No external source, no customer data. 生成スクリプト: `poc/document-conversion/scan-pdf/fixtures/generate-synthetic-invoice.ts` | Repository fixture for OCR / safety_readiness / PII recall evaluation. All names, addresses, phone numbers, bank details, and My Number-like values are synthetic. | **あり（合成 PII のみ）** |
| `scan-pdf/synthetic-unmaskable-pii-scan.pdf` | `scan-pdf` | Local deterministic synthetic fax-like scan generated for M6 W5b (2026-05-21). No external source and no customer data. 生成スクリプト: `poc/document-conversion/scan-pdf/fixtures/generate-synthetic-unmaskable-pii-scan.ts` | Repository fixture for live-smoke observation of `unmaskablePiiFindings.count > 0`. Fold bands, low-resolution rasterization, blur, and seeded scan noise fragment only synthetic name / phone / address / My Number-like fields. | **あり（合成 PII のみ）** |
| `scan-pdf/degraded-scan-fail-closed.pdf` | `scan-pdf` | Derived from `scan-pdf/mhlw-labor-conditions-notice-blank-scan.pdf` via ImageMagick (傾き・ノイズ) → Ghostscript 120dpi 圧縮 (2026-05-21, 6 MB). 生成スクリプト: `poc/document-conversion/scan-pdf/fixtures/generate-degraded.sh` | Same public-source terms as the source MHLW scan fixture. **役割: 5 MiB 超 → 413 size-limit 証跡（OCR fail-closed 用ではない）** — OCR fail-closed は ≤5 MiB の別 fixture と extractor integration test で確保。 | なし（白紙様式由来） |
| `scan-pdf/nta-withholding-form-blank-scan.pdf` | `scan-pdf` | Source: 国税庁「給与所得の源泉徴収票」令和7年分 白紙様式 を A4 印刷 → 複合機 scan (2026-05-21) / 原本: https://www.nta.go.jp/taxes/tetsuzuki/shinsei/annai/hotei/pdf/r07/01.pdf | 国税庁利用規約に準拠。出典記載が必要。 | なし（白紙様式） |

各 PDF を追加したら上表に行を足し、再配布条件へのリンクまたは要約を記載する。
顧客実データ、実在顧客由来の匿名化データ、実在個人の PII は配置しない。

## scan-pdf M6（subtype 3）fixture — 取得完了（2026-05-21）

正本: [docs/phase-3-h-3-direction.md](../../docs/phase-3-h-3-direction.md) §9 / [docs/decisions.md](../../docs/decisions.md) `D-P3-H-7 Q1`（2026-05-21 確定）。

`D-P3-H-7` 着手ゲート 4「fixture #2〜#5 取得と inventory 追記」を **2026-05-21 に完了**。その後、M6 W5b で deterministic unmaskable 合成 fixture を追加し、現在は全 6 本が `scan-pdf/` に揃っている。

| # | fixture | 役割 | 取得方法 | 状態 |
|---|---|---|---|---|
| 1 | `synthetic-employment-form-scan.pdf` | safety_readiness + PII recall baseline | 既存（変更なし） | ✅ |
| 2 | `mhlw-labor-conditions-notice-blank-scan.pdf` | OCR coverage（表組み、PII フリー） | 厚労省様式 印刷 → 複合機 scan (2026-05-21) | ✅ |
| 3 | `nta-withholding-form-blank-scan.pdf` | locator quality（複雑な表） | 国税庁源泉徴収票 印刷 → 複合機 scan (2026-05-21) | ✅ |
| 4 | `synthetic-invoice-with-pii-scan.pdf` | 士業ドメイン、合成 PII | Codex 生成 PDF → 印刷 → 複合機 scan (2026-05-21) | ✅ |
| 5 | `degraded-scan-fail-closed.pdf` | **5 MiB 超 → 413 size-limit 証跡**（OCR fail-closed は ≤5 MiB の別 fixture + extractor integration test） | ImageMagick で #2 を傾き+ノイズ劣化 → Ghostscript 120dpi 圧縮（6 MB） | ✅ |
| 6 | `synthetic-unmaskable-pii-scan.pdf` | **live smoke `unmaskablePiiFindings.count > 0` 証跡** | 合成 fax page を fold bands + low-resolution raster + blur + seeded noise で scan 化（`generate-synthetic-unmaskable-pii-scan.ts`） | ✅ |

**M6-1 着手前ゲート:** `D-P3-H-7` 着手ゲート 3（Q3 PoC 実測）・ゲート 4（fixture #2〜#5）は **2026-05-21 に完了**。実測: [docs/phase-3-h-3-scan-pdf-poc-measurement.md](../../docs/phase-3-h-3-scan-pdf-poc-measurement.md)。

自社資料を masking して commit する案は採用しない。自社資料はローカル `tmp/` で `pnpm poc:conversion:scan-pdf <path>` を走らせて観察し、観察した失敗パターンを synthetic fixture として再現する（[docs/phase-3-h-3-direction.md](../../docs/phase-3-h-3-direction.md) §9.2）。

## PoC 実行

```bash
pnpm poc:conversion:official-doc-pdf sample-data/document-conversion/official-doc-pdf/your.pdf
```

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
| `scan-pdf/degraded-scan-fail-closed.pdf` | `scan-pdf` | Derived locally from `scan-pdf/mhlw-labor-conditions-notice-blank-scan.pdf` by `poc/document-conversion/scan-pdf/fixtures/generate-degraded.sh`. | Same public-source terms as the source MHLW scan fixture. Repository fixture for degraded OCR / fail-closed evaluation. | なし（白紙様式由来） |
| `scan-pdf/nta-withholding-form-blank-scan.pdf` | `scan-pdf` | Source: 国税庁「給与所得の源泉徴収票」令和7年分 白紙様式 を A4 印刷 → 複合機 scan (2026-05-21) / 原本: https://www.nta.go.jp/taxes/tetsuzuki/shinsei/annai/hotei/pdf/r07/01.pdf | 国税庁利用規約に準拠。出典記載が必要。 | なし（白紙様式） |

各 PDF を追加したら上表に行を足し、再配布条件へのリンクまたは要約を記載する。
顧客実データ、実在顧客由来の匿名化データ、実在個人の PII は配置しない。

## scan-pdf M6（subtype 3）追加予定 fixture

正本: [docs/phase-3-h-3-direction.md](../../docs/phase-3-h-3-direction.md) §9 / [docs/decisions.md](../../docs/decisions.md) `D-P3-H-7 Q1`（2026-05-21 確定）。

scan-pdf M6 着手前に下記 4 本を取得し、上記 inventory 表に追加する（fixture 取得は M6-1 着手前ゲート）。

| # | 予定 fixture | 役割 | 調達手順 | PII |
|---|---|---|---|---|
| 2 | `scan-pdf/mhlw-labor-conditions-notice-blank-scan.pdf` | OCR coverage（表組み、PII フリー） | 既存 `official-doc-pdf/mhlw-labor-conditions-notice-general.pdf` を A4 印刷 → 複合機 / スキャナで 300dpi scan → PDF 保存 | なし |
| 3 | `scan-pdf/nta-withholding-form-blank-scan.pdf` | locator quality（複雑な表） | 国税庁公開様式（給与所得の源泉徴収票 等、白紙）を DL → 印刷 → scan | なし |
| 4 | `scan-pdf/synthetic-invoice-with-pii-scan.pdf` | 士業ドメイン、合成 PII | 公開請求書テンプレを元に合成会社名 / 担当者 / 口座 / マイナンバー風値を埋めた PDF を生成 → 印刷 → scan。生成スクリプトは `poc/document-conversion/scan-pdf/fixtures/` に置く | 合成 PII あり |
| 5 | `scan-pdf/degraded-scan-fail-closed.pdf`（任意） | fail-closed 発火確認 | #2 を ImageMagick で `convert ... -rotate 5 -noise 3 ...` で劣化加工 | なし |

合成 PII の生成ルールは [docs/phase-3-h-3-direction.md](../../docs/phase-3-h-3-direction.md) §9.3 を参照（氏名・住所・電話・マイナンバー風値・口座のフォーマット指定）。

自社資料を masking して commit する案は採用しない。自社資料はローカル `tmp/` で `pnpm poc:conversion:scan-pdf <path>` を走らせて観察し、観察した失敗パターンを synthetic fixture として再現する（[docs/phase-3-h-3-direction.md](../../docs/phase-3-h-3-direction.md) §9.2）。

## PoC 実行

```bash
pnpm poc:conversion:official-doc-pdf sample-data/document-conversion/official-doc-pdf/your.pdf
```

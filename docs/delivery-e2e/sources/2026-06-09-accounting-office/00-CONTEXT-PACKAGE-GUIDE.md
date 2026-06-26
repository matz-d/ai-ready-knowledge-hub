# AI-Ready Context Package — Guide

This file is the META guide for a Context Package. It does NOT contain the factual
content. The factual content is delivered as the separate included source files
listed below — use those source files for factual answers.

## Package Manifest

- Purpose: 顧問先からの料金・手続き問い合わせに即答する社内アシスタント
- Generated at: 2026/06/09 09:00 JST
- Source documents reviewed: 10
- Included documents: 5
- Excluded documents: 1
- Human review required: 2

## Instructions for Downstream AI

Included source filenames are provided as separate sources. Use those source files for factual answers.
Do not use excluded documents — they are intentionally NOT provided as source files.
Do not infer missing operational rules.
If required information is missing, ask the human owner.

## Included Source Files

- Source file: `料金表_2026.csv`
  - Original document: `料金表_2026.csv`
  - Reason: 現行料金表（current）。料金問い合わせの権威ソース
  - Source type: 表
  - Sensitivity: Internal
- Source file: `給与計算チェックリスト.md`
  - Original document: `給与計算チェックリスト.md`
  - Reason: 一般情報。給与計算手続きの参照可ドキュメント
  - Source type: チェックリスト
  - Sensitivity: Internal
- Source file: `就業規則テンプレート.md`
  - Original document: `就業規則テンプレート.md`
  - Reason: 汎用テンプレ。就業規則の一般説明に参照可
  - Source type: テンプレート
  - Sensitivity: Internal
- Source file: `年末調整_案内文.txt`
  - Original document: `年末調整_案内文.txt`
  - Reason: 年末調整手続きの一般案内。AI 参照可
  - Source type: 案内文
  - Sensitivity: Internal
- Source file: `顧客対応メモ_匿名化.txt`
  - Original document: `顧客対応メモ_匿名化.txt`
  - Reason: Confidential だが Masker で placeholder 化済みの AI-safe 版
  - Source type: メモ
  - Sensitivity: Confidential (AI-safe via masking)

### File list

- `料金表_2026.csv`
- `給与計算チェックリスト.md`
- `就業規則テンプレート.md`
- `年末調整_案内文.txt`
- `顧客対応メモ_匿名化.txt`

## Excluded Documents (NOT provided as sources)

- 料金表_2023.csv
  - Reason: 2023年版料金表（superseded）。現行 料金表_2026.csv に置き換え済みのため除外
  - Status: Superseded / excluded
- 顧問契約書_実案件サンプル.txt
  - Reason: Restricted（実案件の契約書）。Masker でも残留リスクあり、下流 AI 不可
  - Status: Restricted / human review only
- 顧客対応メモ_書式.md
  - Reason: Confidential かつ masking 待ち。AI-safe 版が未生成
  - Status: Pending masking review

## Budget Truncation (Incomplete Coverage)

- None

## Missing Knowledge

- 同業他社の料金水準との比較データ（社内に存在しない）
- 個別顧問先ごとの特約・値引き条件（料金表には未記載）

## Questions for Human Owner

1. この料金表で確定見積もりを発行してよいか（最終承認者の確認が必要）
2. 11名以上の段階加算は 2026 料金（給与計算は1名 +1,100円）で全顧客に一律適用してよいか

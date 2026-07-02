# AI-Ready Context Package — Guide

This file is the META guide for a Context Package. It does NOT contain the factual
content. The factual content is delivered as the separate included source files
listed below — use those source files for factual answers.

## Package Manifest

- Purpose: 顧問先からの料金・手続き問い合わせに即答する社内アシスタント
- Generated at: 2026-07-02T03:52:02.587Z
- Source documents reviewed: 5
- Included documents: 3
- Excluded documents: 2
- Human review required: 0

## Instructions for Downstream AI

Included source filenames are provided as separate sources. Use those source files for factual answers.
Do not use excluded documents — they are intentionally NOT provided as source files.
Do not infer missing operational rules.
If required information is missing, ask the human owner.

## Included Source Files

- Source file: `料金表_2026 (sheet=Sheet1, range=A1_D12).csv`
  - Original document: `料金表_2026.csv (sheet=Sheet1, range=A1:D12)`
  - Reason: 「給与計算 従業員10名まで 33000」などの料金表が明記されており、Purposeである「顧問先からの料金問い合わせ」に直接対応する。
  - Source type: 表
  - Sensitivity: Public
- Source file: `年末調整_案内文.txt`
  - Original document: `年末調整_案内文.txt`
  - Reason: 「【ご提出書類】」や「【提出期限】」などの年末調整の手続き案内が記載されており、Purposeである「手続き問い合わせ」に直接対応する。
  - Source type: 案内文
  - Sensitivity: Public
- Source file: `給与計算チェックリスト.md`
  - Original document: `給与計算チェックリスト.md`
  - Reason: 「当月の勤怠データ受領 (月末締め翌月5日まで)」など給与計算の月次手続きフローが記載されており、手続き問い合わせの回答を補完する。
  - Source type: チェックリスト
  - Sensitivity: Public

### File list

- `料金表_2026 (sheet=Sheet1, range=A1_D12).csv`
- `年末調整_案内文.txt`
- `給与計算チェックリスト.md`

## Excluded Documents (NOT provided as sources)

- 就業規則テンプレート.md
  - Reason: 「就業規則テンプレート」の条文案であり、顧問先からの料金や手続きに関する問い合わせに直接答えるための情報ではない。 [purpose_mismatch]
- 顧客対応メモ_匿名化.txt
  - Reason: 「[顧客X社] の [従業員Z]」に関する個別具体的な過去の対応メモであり、一般的な料金・手続き問い合わせの回答根拠としては不適切である。 [purpose_mismatch]

## Budget Truncation (Incomplete Coverage)

- None

## Missing Knowledge

- 社会保険・労働保険手続きの具体的な必要書類と提出期限

## Questions for Human Owner

1. 料金表に記載されている「基本顧問契約」の具体的な月額料金や、契約に含まれる対象人数の上限は定義されていますか。

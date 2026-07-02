# AI-Ready Context Package — Guide

This file is the META guide for a Context Package. It does NOT contain the factual
content. The factual content is delivered as the separate included source files
listed below — use those source files for factual answers.

## Package Manifest

- Purpose: 顧問先からの料金・手続き問い合わせに即答する社内アシスタント
- Generated at: 2026-07-02T03:13:19.289Z
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
  - Reason: 「基本料金(月額・税込)」や各業務の料金が明記されており、Purpose である顧問先からの料金問い合わせに直接対応する。
  - Source type: 表
  - Sensitivity: Public
- Source file: `年末調整_案内文.txt`
  - Original document: `年末調整_案内文.txt`
  - Reason: 「【ご提出書類】」や「【提出期限】」が記載されており、年末調整の手続きに関する問い合わせ対応に直接合致する。
  - Source type: 案内文
  - Sensitivity: Public
- Source file: `給与計算チェックリスト.md`
  - Original document: `給与計算チェックリスト.md`
  - Reason: 「当月の勤怠データ受領 (月末締め翌月5日まで)」など、給与計算の手続きスケジュールや必要項目の問い合わせ対応に活用できる。
  - Source type: チェックリスト
  - Sensitivity: Public

### File list

- `料金表_2026 (sheet=Sheet1, range=A1_D12).csv`
- `年末調整_案内文.txt`
- `給与計算チェックリスト.md`

## Excluded Documents (NOT provided as sources)

- 就業規則テンプレート.md
  - Reason: 「就業規則テンプレート」であり、顧問先からの具体的な料金や手続きに関する問い合わせに直接答える内容ではないため。 [purpose_mismatch]
- 顧客対応メモ_匿名化.txt
  - Reason: 特定顧客の個別対応メモであり、汎用的な料金・手続き問い合わせに即答するための根拠としては具体性や汎用性が不足しているため。 [insufficient_evidence_quality]

## Budget Truncation (Incomplete Coverage)

- None

## Missing Knowledge

- 社会保険・労働保険手続きの具体的な申請フローと必要書類一覧

## Questions for Human Owner

1. 料金表に記載されている「基本顧問契約」の具体的な月額基本料金や、契約に含まれる対象人数（例: 10名まで等）の基準はどこに定義されていますか。

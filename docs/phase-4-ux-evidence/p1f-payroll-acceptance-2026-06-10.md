# P1-F Payroll Acceptance — 2026-06-10

## Summary

Async worker path (`coverage: full`) with 30 include docIds.
Purpose: 新入社員向けに、月次の給与計算業務を安全に学べる NotebookLM を作りたい。公開テンプレートと社内手順だけを使い、顧客個人情報は除外したい。

- jobId: `b77d9982-6323-4a70-98d3-975a80a307b2`
- elapsed: ~596s (initial run)
- sourceDocumentsReviewed: 30
- included chunks: 64
- coverage: full / batches 11

## Checks

- [x] **no_budget_dropped_documents**: budgetDroppedDocuments: 0
- [x] **no_truncation_in_markdown**: clean
- [x] **no_truncation_in_bundle_guide**: clean
- [x] **full_coverage_mode**: coverage.mode=full, batches=11
- [x] **payroll_checklist_in_included**: included fileNames: mhlw-labor-conditions-notice-blank-scan.pdf, mhlw-labor-conditions-notice-general.pdf, synthetic-context-package-deck.pdf, mhlw-r07-model-work-rules.pdf, mhlw-overtime-limit-guide.pdf, 給与計算チェックリスト.md
- [x] **payroll_checklist_in_bundle**: bundle files (65): 00-CONTEXT-PACKAGE-GUIDE.md, mhlw-labor-conditions-notice-blank-scan.pdf, mhlw-labor-conditions-notice-blank-scan-2.pdf, mhlw-labor-conditions-notice-blank-scan-3.pdf, mhlw-labor-conditions-notice-blank-scan-4.pdf, mhlw-labor-conditions-notice-blank-scan-5.pdf, mhlw-labor-conditions-notice-blank-scan-6.pdf, mhlw-labor-conditions-notice-blank-scan-7.pdf, mhlw-labor-conditions-notice-general.pdf, mhlw-labor-conditions-notice-general-2.pdf, synthetic-context-package-deck.pdf, synthetic-context-package-deck-2.pdf, mhlw-r07-model-work-rules.pdf, mhlw-r07-model-work-rules-2.pdf, mhlw-r07-model-work-rules-3.pdf, mhlw-r07-model-work-rules-4.pdf, mhlw-r07-model-work-rules-5.pdf, mhlw-r07-model-work-rules-6.pdf, mhlw-r07-model-work-rules-7.pdf, mhlw-r07-model-work-rules-8.pdf, mhlw-r07-model-work-rules-9.pdf, mhlw-r07-model-work-rules-10.pdf, mhlw-r07-model-work-rules-11.pdf, mhlw-r07-model-work-rules-12.pdf, mhlw-r07-model-work-rules-13.pdf, mhlw-r07-model-work-rules-14.pdf, mhlw-r07-model-work-rules-15.pdf, mhlw-r07-model-work-rules-16.pdf, mhlw-r07-model-work-rules-17.pdf, mhlw-r07-model-work-rules-18.pdf, mhlw-r07-model-work-rules-19.pdf, mhlw-r07-model-work-rules-20.pdf, mhlw-r07-model-work-rules-21.pdf, mhlw-r07-model-work-rules-22.pdf, mhlw-r07-model-work-rules-23.pdf, mhlw-r07-model-work-rules-24.pdf, mhlw-r07-model-work-rules-25.pdf, mhlw-r07-model-work-rules-26.pdf, mhlw-r07-model-work-rules-27.pdf, mhlw-r07-model-work-rules-28.pdf, mhlw-r07-model-work-rules-29.pdf, mhlw-r07-model-work-rules-30.pdf, mhlw-r07-model-work-rules-31.pdf, mhlw-r07-model-work-rules-32.pdf, mhlw-r07-model-work-rules-33.pdf, mhlw-r07-model-work-rules-34.pdf, mhlw-r07-model-work-rules-35.pdf, mhlw-r07-model-work-rules-36.pdf, mhlw-r07-model-work-rules-37.pdf, mhlw-r07-model-work-rules-38.pdf, mhlw-r07-model-work-rules-39.pdf, mhlw-r07-model-work-rules-40.pdf, mhlw-r07-model-work-rules-41.pdf, mhlw-r07-model-work-rules-42.pdf, mhlw-r07-model-work-rules-43.pdf, mhlw-r07-model-work-rules-44.pdf, mhlw-r07-model-work-rules-45.pdf, mhlw-overtime-limit-guide.pdf, mhlw-overtime-limit-guide-2.pdf, mhlw-overtime-limit-guide-3.pdf, mhlw-overtime-limit-guide-4.pdf, mhlw-overtime-limit-guide-5.pdf, mhlw-overtime-limit-guide-6.pdf, mhlw-overtime-limit-guide-7.pdf, 給与計算チェックリスト.md
- [x] **bundle_has_guide**: guide present: true
- [x] **bundle_file_count_reasonable**: file count: 65 (expect >2, not guide-only)

## Verdict

**PASS** — budget truncation zero, payroll checklist in bundle.

## Notes

- Reduce LLM for missing/questions may fall back to deterministic dedupe (degraded banner). This is separate from budget truncation.
- Local verification uses `runContextPackageJob` (same path as dev server worker `POST /api/context-package/jobs/{jobId}/run`).

## Bundle files (first 20)

- `00-CONTEXT-PACKAGE-GUIDE.md`
- `mhlw-labor-conditions-notice-blank-scan.pdf`
- `mhlw-labor-conditions-notice-blank-scan-2.pdf`
- `mhlw-labor-conditions-notice-blank-scan-3.pdf`
- `mhlw-labor-conditions-notice-blank-scan-4.pdf`
- `mhlw-labor-conditions-notice-blank-scan-5.pdf`
- `mhlw-labor-conditions-notice-blank-scan-6.pdf`
- `mhlw-labor-conditions-notice-blank-scan-7.pdf`
- `mhlw-labor-conditions-notice-general.pdf`
- `mhlw-labor-conditions-notice-general-2.pdf`
- `synthetic-context-package-deck.pdf`
- `synthetic-context-package-deck-2.pdf`
- `mhlw-r07-model-work-rules.pdf`
- `mhlw-r07-model-work-rules-2.pdf`
- `mhlw-r07-model-work-rules-3.pdf`
- `mhlw-r07-model-work-rules-4.pdf`
- `mhlw-r07-model-work-rules-5.pdf`
- `mhlw-r07-model-work-rules-6.pdf`
- `mhlw-r07-model-work-rules-7.pdf`
- `mhlw-r07-model-work-rules-8.pdf`
- … and 45 more

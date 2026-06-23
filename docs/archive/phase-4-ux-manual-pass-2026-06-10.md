# Phase 4-UX Manual Pass — 2026-06-10

## Summary

P0 の Phase 4-UX ブラウザ手動通しを localhost で実施した。

- Target: `http://localhost:3000/context-package`
- Server command: `PORT=3000 GOOGLE_CLOUD_LOCATION=global NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED=false pnpm dev`
- Purpose:
  `税理・会計事務所の新入社員向けに、給与計算業務と顧客対応の基本を学べるAIアシスタントを作りたい。公開テンプレートと社内手順だけを使い、顧客個人情報は除外したい。`

## Evidence

Screenshots:

- `docs/phase-4-ux-evidence/2026-06-10/01-candidates-safety-review.png`
- `docs/phase-4-ux-evidence/2026-06-10/02-preview-docids-narrowed.png`
- `docs/phase-4-ux-evidence/2026-06-10/03-result-sync-success.png`

Server log highlights:

```text
POST /api/context-package/candidates 200 in 392ms
POST /api/context-package 200 in 8.4s
```

## Flow Checked

1. Opened `/context-package` on localhost.
2. Entered purpose.
3. Clicked `候補を表示`.
4. Confirmed candidate API result and Safety Review:
   - AI に渡せる候補: 30
   - 除外すべき: 3
   - 人間確認すべき: 6
   - 足りない情報: 1
5. Narrowed generation target through advanced Doc ID input:
   - `578a1e15-9fac-4d6e-9b6e-011907687606` — `給与計算チェックリスト.md`
   - `d2e75082-336b-4a76-97d6-e1911eb7b664` — `mhlw-labor-conditions-notice-general.pdf`
6. Confirmed pre-generation preview:
   - AI へ渡す予定: 2
   - 自動除外: 0
   - 要確認: 0
   - No acknowledgement was required for this narrowed safe selection.
7. Generated Context Package successfully.
8. Confirmed result panel:
   - Reviewed documents: 2
   - Included: 1
   - Safety Excluded: 0
   - Missing: 2
   - Review Questions: 1
9. Confirmed Markdown copy:
   - Clipboard content started with `# AI-Ready Context Package`
   - Clipboard length: 1507 characters
   - UI showed copy success state.
10. Confirmed Markdown download in Chrome:
    - Downloaded file:
      `/Users/makotomatuda/Downloads/context-package_税理・会計事務所の新入社員向けに_給与計算業務と顧客対応の基.md`
    - File size: 2727 bytes
    - File content starts with `# AI-Ready Context Package`
    - File content includes the purpose and `給与計算チェックリスト.md`

## Findings

### Passed

- Purpose-driven candidate discovery works from the browser.
- Safety Review clearly separates includable, restricted, human-review, and missing information.
- Advanced Doc ID narrowing updates the pre-generation preview before generation.
- Context Package generation succeeds when `GOOGLE_CLOUD_LOCATION=global` is used.
- Markdown result rendering and copy action work.
- Markdown download works in Chrome and writes a valid `.md` file to Downloads.

### Constraints / Follow-Up

- Codex in-app browser showed the download button and accepted the click without console errors, but did not write a file to `~/Downloads`; Chrome verified the actual browser download path.
- Async polling was not exercised through the local UI. With the local Cloud Tasks queue unset, the production async path is not available from localhost. This pass verified the synchronous UI generation path; async production smoke remains covered by the existing production async runbook/evidence path.
- First run with `.env.local` default `GOOGLE_CLOUD_LOCATION=asia-northeast1` failed because Vertex returned 404 for `gemini-3.5-flash` in `asia-northeast1`. Re-running with `GOOGLE_CLOUD_LOCATION=global` fixed generation.

## Verdict

P0 is cleared for the local synchronous browser UX path: purpose, candidates, Safety Review, preview, generation result, copy, and download were verified with evidence. UI-level async polling remains a production/Cloud Tasks environment check rather than a localhost check.

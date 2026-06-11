/**
 * P1-F acceptance: payroll scenario via async worker path (runContextPackageJob).
 *
 * Exercises coverage:"full" + enforceSyncBudget:false — the same path as
 * POST /api/context-package/jobs/{jobId}/run on the dev server.
 *
 * Usage (repo root, .env.local loaded):
 *   pnpm tsx scripts/verifyP1fPayrollAcceptance.ts
 *   pnpm tsx scripts/verifyP1fPayrollAcceptance.ts --write-evidence
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import './loadEnv';
import { defaultSelectedDocIds } from '../src/app/context-package/candidateSelectionUi';
import {
  createContextPackageJob,
  getContextPackageJob,
} from '../src/lib/contextPackageJobs/firestoreAdapter';
import { runContextPackageJob } from '../src/lib/contextPackageJobs/runJob';
import { readContextPackageJobResult } from '../src/lib/contextPackageJobs/resultStorage';
import { listInventoryDocumentsFromFirestore } from '../src/lib/inventoryFirestoreAdapter';
import { selectCandidates } from '../src/services/candidateSelection';

const PURPOSE =
  '新入社員向けに、月次の給与計算業務を安全に学べる NotebookLM を作りたい。公開テンプレートと社内手順だけを使い、顧客個人情報は除外したい。';

type SourceBundleFile = { fileName: string; content: string; role?: string };
type IncludedView = { parent?: { fileName?: string } };
type Payload = {
  markdown: string;
  sourceBundle?: { files: SourceBundleFile[] };
  budgetDroppedDocuments?: { fileName: string; droppedChunks: number }[];
  coverage?: { mode?: string; batches?: number };
  included?: IncludedView[];
  sourceDocumentsReviewed?: number;
};

type CheckResult = {
  name: string;
  pass: boolean;
  detail: string;
};

function hasBudgetTruncationSignal(text: string): boolean {
  return (
    text.includes('⚠️ Budget truncation:') ||
    text.includes('This package is INCOMPLETE') ||
    /Budget Truncation \(Incomplete Coverage\)\n\n- (?!None)/.test(text)
  );
}

function checksFromPayload(payload: Payload): CheckResult[] {
  const bundleFiles =
    payload.sourceBundle?.files.map((f) => f.fileName).filter(Boolean) ?? [];
  const dropped = payload.budgetDroppedDocuments ?? [];
  const markdownHasTruncation = hasBudgetTruncationSignal(payload.markdown);

  const guide = payload.sourceBundle?.files.find(
    (f) => f.fileName === '00-CONTEXT-PACKAGE-GUIDE.md',
  );
  const guideHasTruncation = guide
    ? hasBudgetTruncationSignal(guide.content)
    : false;

  const includedNames = [
    ...new Set(
      (payload.included ?? [])
        .map((row) => row.parent?.fileName)
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  const bundleHasPayrollChecklist = bundleFiles.some((n) =>
    (n ?? '').includes('給与計算チェックリスト'),
  );
  const includedHasPayrollChecklist = includedNames.some((n) =>
    n.includes('給与計算チェックリスト'),
  );

  return [
    {
      name: 'no_budget_dropped_documents',
      pass: dropped.length === 0,
      detail: `budgetDroppedDocuments: ${dropped.length}`,
    },
    {
      name: 'no_truncation_in_markdown',
      pass: !markdownHasTruncation,
      detail: markdownHasTruncation ? 'truncation markers present' : 'clean',
    },
    {
      name: 'no_truncation_in_bundle_guide',
      pass: !guideHasTruncation,
      detail: guideHasTruncation ? 'truncation markers in guide' : 'clean',
    },
    {
      name: 'full_coverage_mode',
      pass: payload.coverage?.mode === 'full',
      detail: `coverage.mode=${payload.coverage?.mode ?? 'missing'}, batches=${payload.coverage?.batches ?? 'n/a'}`,
    },
    {
      name: 'payroll_checklist_in_included',
      pass: includedHasPayrollChecklist,
      detail: `included fileNames: ${includedNames.join(', ') || '(none)'}`,
    },
    {
      name: 'payroll_checklist_in_bundle',
      pass: bundleHasPayrollChecklist,
      detail: `bundle files (${bundleFiles.length}): ${bundleFiles.join(', ')}`,
    },
    {
      name: 'bundle_has_guide',
      pass: bundleFiles[0] === '00-CONTEXT-PACKAGE-GUIDE.md',
      detail: `guide present: ${bundleFiles[0] === '00-CONTEXT-PACKAGE-GUIDE.md'}`,
    },
    {
      name: 'bundle_file_count_reasonable',
      pass: bundleFiles.length >= 3,
      detail: `file count: ${bundleFiles.length} (expect >2, not guide-only)`,
    },
  ];
}

async function loadJobPayload(
  job: NonNullable<Awaited<ReturnType<typeof getContextPackageJob>>>,
): Promise<Payload> {
  if (job.result) {
    return job.result as Payload;
  }
  if (job.resultRef) {
    const offloaded = await readContextPackageJobResult(job.resultRef, {
      tenantId: job.request.tenantId,
      jobId: job.jobId,
    });
    return offloaded as Payload;
  }
  throw new Error('job succeeded but no inline or offloaded result');
}

function jobIdFromArgv(): string | undefined {
  const arg = process.argv.find((value) => value.startsWith('--job-id='));
  return arg?.slice('--job-id='.length);
}

async function writeEvidenceFile(options: {
  jobId: string;
  docIdsCount: number;
  elapsedSec: string;
  payload: Payload;
  checks: CheckResult[];
  allPass: boolean;
}): Promise<void> {
  const date = '2026-06-10';
  const bundleFiles =
    options.payload.sourceBundle?.files.map((f) => f.fileName).filter(Boolean) ??
    [];
  const outPath = join(
    process.cwd(),
    'docs',
    'phase-4-ux-evidence',
    `p1f-payroll-acceptance-${date}.md`,
  );
  const body = [
    `# P1-F Payroll Acceptance — ${date}`,
    '',
    '## Summary',
    '',
    `Async worker path (\`coverage: full\`) with ${options.docIdsCount} include docIds.`,
    `Purpose: ${PURPOSE}`,
    '',
    `- jobId: \`${options.jobId}\``,
    `- elapsed: ${options.elapsedSec}s`,
    `- sourceDocumentsReviewed: ${options.payload.sourceDocumentsReviewed}`,
    `- included chunks: ${options.payload.included?.length ?? 0}`,
    `- coverage: ${options.payload.coverage?.mode ?? 'n/a'} / batches ${options.payload.coverage?.batches ?? 'n/a'}`,
    '',
    '## Checks',
    '',
    ...options.checks.map(
      (c) => `- [${c.pass ? 'x' : ' '}] **${c.name}**: ${c.detail}`,
    ),
    '',
    '## Verdict',
    '',
    options.allPass
      ? '**PASS** — budget truncation zero, payroll checklist in bundle.'
      : '**FAIL** — see checks above.',
    '',
    '## Notes',
    '',
    '- Reduce LLM for missing/questions may fall back to deterministic dedupe (degraded banner). This is separate from budget truncation.',
    '- Local verification uses `runContextPackageJob` (same path as dev server worker `POST /api/context-package/jobs/{jobId}/run`).',
    '',
    '## Bundle files (first 20)',
    '',
    ...(bundleFiles.length > 0
      ? bundleFiles
          .slice(0, 20)
          .map((name) => `- \`${name}\``)
          .concat(
            bundleFiles.length > 20
              ? [`- … and ${bundleFiles.length - 20} more`]
              : [],
          )
      : ['(no sourceBundle)']),
    '',
  ].join('\n');
  writeFileSync(outPath, body, 'utf8');
  console.log(`\n[wrote evidence] ${outPath}`);
}

async function verifyExistingJob(
  jobId: string,
  writeEvidence: boolean,
): Promise<void> {
  const finalJob = await getContextPackageJob(jobId);
  if (!finalJob || finalJob.status !== 'succeeded') {
    console.error('[p1f-acceptance] job not succeeded', finalJob?.status, finalJob?.error);
    process.exit(1);
  }
  const payload = await loadJobPayload(finalJob);
  const checks = checksFromPayload(payload);
  const allPass = checks.every((c) => c.pass);
  console.log('\n--- P1-F payroll acceptance checks (existing job) ---');
  for (const check of checks) {
    console.log(`${check.pass ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}`);
  }
  console.log(
    `jobId=${jobId}  reviewed=${payload.sourceDocumentsReviewed}  includedChunks=${payload.included?.length ?? 0}  batches=${payload.coverage?.batches ?? 'n/a'}`,
  );
  console.log(allPass ? '\nVERDICT: PASS' : '\nVERDICT: FAIL');
  if (writeEvidence) {
    await writeEvidenceFile({
      jobId,
      docIdsCount: finalJob.request.docIds?.length ?? 0,
      elapsedSec: 'n/a (re-check)',
      payload,
      checks,
      allPass,
    });
  }
  process.exit(allPass ? 0 : 1);
}

async function main(): Promise<void> {
  const writeEvidence = process.argv.includes('--write-evidence');
  const existingJobId = jobIdFromArgv();

  if (existingJobId) {
    await verifyExistingJob(existingJobId, writeEvidence);
    return;
  }

  console.log('[p1f-acceptance] loading inventory...');
  const documents = await listInventoryDocumentsFromFirestore(300);
  if (documents.length === 0) {
    throw new Error('no_inventory_documents');
  }

  const { candidates, missingHints } = selectCandidates(PURPOSE, documents, {
    responseLimit: 100,
  });
  const docIds = defaultSelectedDocIds(candidates);
  const includeCount = candidates.filter((c) => c.recommendation === 'include').length;

  console.log('[p1f-acceptance] candidates', {
    inventoryScanned: documents.length,
    candidatesReturned: candidates.length,
    includeRecommendations: includeCount,
    selectedDocIds: docIds.length,
    missingHints: missingHints.length,
  });

  if (docIds.length < 10) {
    throw new Error(`expected broad selection (>=10 include docIds), got ${docIds.length}`);
  }

  const job = await createContextPackageJob({
    purpose: PURPOSE,
    limit: 100,
    docIds,
    tenantId: 'acceptance-verify',
    actor: {
      userId: 'script:verifyP1fPayrollAcceptance',
      ipAddress: '127.0.0.1',
      userAgent: 'verifyP1fPayrollAcceptance',
    },
  });

  console.log('[p1f-acceptance] running worker path', { jobId: job.jobId });
  const startedAt = Date.now();
  const outcome = await runContextPackageJob(job.jobId);
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log('[p1f-acceptance] worker outcome', outcome, `elapsed=${elapsedSec}s`);

  const finalJob = await getContextPackageJob(job.jobId);
  if (!finalJob || finalJob.status !== 'succeeded') {
    console.error('[p1f-acceptance] job failed', finalJob?.error);
    process.exit(1);
  }

  const payload = await loadJobPayload(finalJob);
  const checks = checksFromPayload(payload);
  const allPass = checks.every((c) => c.pass);
  const bundleFiles = payload.sourceBundle?.files.map((f) => f.fileName) ?? [];

  console.log('\n--- P1-F payroll acceptance checks ---');
  for (const check of checks) {
    console.log(`${check.pass ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}`);
  }
  console.log('--------------------------------------');
  console.log(
    `jobId=${job.jobId}  reviewed=${payload.sourceDocumentsReviewed}  includedChunks=${payload.included?.length ?? 0}  batches=${payload.coverage?.batches ?? 'n/a'}`,
  );
  console.log(allPass ? '\nVERDICT: PASS' : '\nVERDICT: FAIL');

  if (writeEvidence) {
    await writeEvidenceFile({
      jobId: job.jobId,
      docIdsCount: docIds.length,
      elapsedSec,
      payload,
      checks,
      allPass,
    });
  }

  process.exit(allPass ? 0 : 1);
}

main().catch((error) => {
  console.error('[p1f-acceptance] fatal', error);
  process.exit(1);
});

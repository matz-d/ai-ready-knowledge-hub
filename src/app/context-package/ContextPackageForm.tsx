'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CandidateSelectionList } from './CandidateSelectionList';
import { PreGenerationPreviewPanel } from './PreGenerationPreviewPanel';
import { SafetyReviewPanel } from './SafetyReviewPanel';
import {
  previewRequiresAcknowledgement,
  projectPreGenerationPreview,
} from './preGenerationPreview';
import {
  canGenerateContextPackage,
  defaultSelectedDocIds,
  isCandidatesStale,
  resolveDocIdsForGeneration,
  type CandidateRow,
  type CandidatesApiResponse,
} from './candidateSelectionUi';

const MAX_PURPOSE = 2000;

/**
 * 非同期 job 経路（mode:"auto"）の有効化フラグ。Cloud Tasks queue が配線済みの環境
 * でだけ true にする。未配線環境で auto を送ると 503 になるため、既定は同期のまま。
 * 本番 Cloud Run では NEXT_PUBLIC_* が Docker build 時に焼き込まれる（runtime env では
 * 切り替え不可）。手順は docs/setup-gcp.md §Context Package 非同期。
 */
const ASYNC_ENABLED =
  process.env.NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED === 'true';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

type JobLifecycleStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

type JobAcceptedResponse = {
  jobId: string;
  status: JobLifecycleStatus;
  statusUrl: string;
  resultUrl: string;
  reason?: string;
  details?: string;
};

type JobStatusResponse = {
  jobId: string;
  status: JobLifecycleStatus;
  error?: { code?: string; message?: string };
  resultUrl?: string;
};

const JOB_STATUS_LABEL: Record<JobLifecycleStatus, string> = {
  queued: 'キューに登録しました（順番待ち）',
  running: '生成中…',
  succeeded: '完了しました',
  failed: '失敗しました',
  cancelled: 'キャンセルされました',
};

type ChunkSelection = {
  docId: string;
  chunkId: string;
  rationale: string;
  confidence?: number;
  reason?: string;
  chunk: { title?: string; sensitivity: string };
  parent: { fileName: string; documentType: string; businessDomain: string };
};

type SafetyExcludedChunk = {
  docId: string;
  chunkId: string;
  rationale: string;
  reason: string;
  chunk: { title?: string; sensitivity: string };
  parent: { fileName: string; documentType: string; businessDomain: string };
};

type ContextPackageResult = {
  purpose: string;
  generatedAt: string;
  sourceDocumentsReviewed: number;
  included: ChunkSelection[];
  excluded: ChunkSelection[];
  safetyExcluded: SafetyExcludedChunk[];
  missing: string[];
  humanReviewQuestions: string[];
  markdown: string;
  budgetDroppedDocuments: { docId: string; fileName: string; droppedChunks: number }[];
  counts: {
    included: number;
    excluded: number;
    safetyExcluded: number;
    missing: number;
    humanReviewQuestions: number;
  };
};

type DocIdsErrorDetails = {
  unknownDocIds: string[];
  nonTerminalDocIds: { docId: string; status: string }[];
};

type ApiErrorResponse = {
  error?: string;
  code?: string;
  details?: unknown;
  recommendation?: {
    hint?: string;
    suggestedDocIds?: string[];
  };
};

type UiState = 'idle' | 'loading' | 'polling' | 'done' | 'error';

type CandidatesFetchState = 'idle' | 'loading' | 'ready' | 'error';

export function parseDocIds(raw: string): string[] {
  return [...new Set(raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean))];
}

function downloadMarkdown(markdown: string, purpose: string) {
  const slug = purpose.slice(0, 30).replace(/[^\w\u3040-\u9fff]/g, '_');
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `context-package_${slug}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

export function ContextPackageForm() {
  const [purpose, setPurpose] = useState('');
  const [docIdsRaw, setDocIdsRaw] = useState('');
  const [uiState, setUiState] = useState<UiState>('idle');
  const [candidatesFetchState, setCandidatesFetchState] =
    useState<CandidatesFetchState>('idle');
  const [candidatesPurpose, setCandidatesPurpose] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [missingHints, setMissingHints] = useState<string[]>([]);
  const [inventoryScanned, setInventoryScanned] = useState(0);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(() => new Set());
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [docIdsErrorDetails, setDocIdsErrorDetails] = useState<DocIdsErrorDetails | null>(null);
  const [suggestedDocIds, setSuggestedDocIds] = useState<string[] | null>(null);
  const [result, setResult] = useState<ContextPackageResult | null>(null);
  const [jobStatus, setJobStatus] = useState<JobLifecycleStatus | null>(null);
  const [jobNote, setJobNote] = useState<string | null>(null);
  const [previewAcknowledged, setPreviewAcknowledged] = useState(false);

  const activeJobRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      activeJobRef.current = null;
    };
  }, []);

  const isBusy = uiState === 'loading' || uiState === 'polling';
  const isFetchingCandidates = candidatesFetchState === 'loading';
  const isFormDisabled = isBusy || isFetchingCandidates;
  const remaining = MAX_PURPOSE - purpose.length;
  const candidatesStale = isCandidatesStale(purpose, candidatesPurpose);
  const candidatesReady = candidatesFetchState === 'ready' && !candidatesStale;
  const docIdsForGeneration = useMemo(
    () => resolveDocIdsForGeneration(docIdsRaw, selectedDocIds, parseDocIds),
    [docIdsRaw, selectedDocIds],
  );
  const selectedDocIdsForGeneration = useMemo(
    () => new Set(docIdsForGeneration),
    [docIdsForGeneration],
  );
  const preGenerationPreview = useMemo(() => {
    if (!candidatesReady) return null;
    return projectPreGenerationPreview(candidates, selectedDocIdsForGeneration);
  }, [candidates, candidatesReady, selectedDocIdsForGeneration]);
  const previewNeedsAck =
    preGenerationPreview !== null &&
    previewRequiresAcknowledgement(preGenerationPreview);
  const generateEnabled =
    canGenerateContextPackage({
      purpose,
      candidatesReady,
      candidatesStale,
      isBusy,
      isFetchingCandidates,
      docIds: docIdsForGeneration,
    }) &&
    (preGenerationPreview === null ||
      !previewRequiresAcknowledgement(preGenerationPreview) ||
      previewAcknowledged);

  const invalidateCandidates = () => {
    setCandidatesFetchState('idle');
    setCandidates([]);
    setMissingHints([]);
    setInventoryScanned(0);
    setSelectedDocIds(new Set());
    setCandidatesPurpose(null);
    setCandidatesError(null);
    setPreviewAcknowledged(false);
  };

  const handlePurposeChange = (value: string) => {
    setPurpose(value);
    if (candidatesPurpose !== null && value.trim() !== candidatesPurpose) {
      invalidateCandidates();
      setResult(null);
      setUiState('idle');
      setErrorMessage(null);
      setDocIdsErrorDetails(null);
      setSuggestedDocIds(null);
    }
  };

  const applyDocIdSuggestion = (ids: string[]) => {
    setDocIdsRaw(ids.join('\n'));
    setSuggestedDocIds(null);
    setErrorMessage(null);
    setDocIdsErrorDetails(null);
    setPreviewAcknowledged(false);
    setUiState('idle');
  };

  const handleToggleCandidate = (docId: string, checked: boolean) => {
    setPreviewAcknowledged(false);
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(docId);
      else next.delete(docId);
      return next;
    });
  };

  const fetchCandidates = async () => {
    const trimmed = purpose.trim();
    if (!trimmed) return;

    setCandidatesError(null);
    setCandidatesFetchState('loading');
    setErrorMessage(null);

    try {
      const res = await fetch('/api/context-package/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: trimmed }),
      });

      if (!res.ok) {
        let message = '候補の取得に失敗しました。';
        try {
          const body = (await res.json()) as ApiErrorResponse;
          if (res.status === 400 && body.code === 'invalid_request') {
            message =
              typeof body.details === 'string'
                ? `入力エラー: ${body.details}`
                : '入力内容を確認してください。';
          } else if (res.status === 409 && body.code === 'no_inventory_documents') {
            message =
              '先に Inventory を取り込んでください（/upload または /import/google-sheets からドキュメントをインポートしてください）。';
          } else if (res.status === 502) {
            message =
              'サーバーエラーが発生しました。しばらくしてから再試行してください。';
          }
        } catch {
          /* ignore JSON parse */
        }
        setCandidatesError(message);
        setCandidatesFetchState('error');
        return;
      }

      const data = (await res.json()) as CandidatesApiResponse;
      setCandidates(data.candidates);
      setMissingHints(data.missingHints);
      setInventoryScanned(data.inventoryScanned);
      setSelectedDocIds(new Set(defaultSelectedDocIds(data.candidates)));
      setCandidatesPurpose(trimmed);
      setCandidatesFetchState('ready');
      setPreviewAcknowledged(false);
    } catch {
      setCandidatesError('ネットワークエラーが発生しました。');
      setCandidatesFetchState('error');
    }
  };

  const pollJob = async (accepted: JobAcceptedResponse) => {
    activeJobRef.current = accepted.jobId;
    setUiState('polling');
    setJobStatus(accepted.status);
    setJobNote(
      accepted.reason === 'sync_budget_exceeded'
        ? '対象が大きいためバックグラウンド生成に切り替えました。'
        : null,
    );

    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (activeJobRef.current === accepted.jobId) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (activeJobRef.current !== accepted.jobId) return;

      if (Date.now() > deadline) {
        setErrorMessage(
          '生成がタイムアウトしました。対象文書を絞って再試行してください。',
        );
        setUiState('error');
        return;
      }

      let statusRes: Response;
      try {
        statusRes = await fetch(accepted.statusUrl);
      } catch {
        continue;
      }
      if (activeJobRef.current !== accepted.jobId) return;
      if (!statusRes.ok) continue;

      const status = (await statusRes.json()) as JobStatusResponse;
      setJobStatus(status.status);

      if (status.status === 'succeeded') {
        const resultRes = await fetch(accepted.resultUrl);
        if (activeJobRef.current !== accepted.jobId) return;
        if (!resultRes.ok) {
          setErrorMessage('結果の取得に失敗しました。');
          setUiState('error');
          return;
        }
        const data = (await resultRes.json()) as ContextPackageResult;
        setResult(data);
        setUiState('done');
        return;
      }
      if (status.status === 'failed' || status.status === 'cancelled') {
        setErrorMessage(
          status.error?.message ??
            'バックグラウンド生成に失敗しました。対象を絞って再試行してください。',
        );
        setUiState('error');
        return;
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!generateEnabled) return;

    activeJobRef.current = null;
    setErrorMessage(null);
    setDocIdsErrorDetails(null);
    setSuggestedDocIds(null);
    setResult(null);
    setJobStatus(null);
    setJobNote(null);
    setUiState('loading');

    const docIds = docIdsForGeneration;

    try {
      const res = await fetch('/api/context-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose: purpose.trim(),
          docIds,
          ...(ASYNC_ENABLED ? { mode: 'auto' } : {}),
        }),
      });

      if (res.status === 202) {
        const accepted = (await res.json()) as JobAcceptedResponse;
        await pollJob(accepted);
        return;
      }

      if (res.ok) {
        const data = (await res.json()) as ContextPackageResult;
        setResult(data);
        setUiState('done');
        return;
      }

      let errMsg = 'エラーが発生しました。';
      try {
        const body = (await res.json()) as ApiErrorResponse;
        if (res.status === 400 && body.error === 'unknown_doc_ids') {
          const details = body.details as DocIdsErrorDetails | undefined;
          setDocIdsErrorDetails({
            unknownDocIds: details?.unknownDocIds ?? [],
            nonTerminalDocIds: details?.nonTerminalDocIds ?? [],
          });
          errMsg = '指定した docId に問題があります。下の詳細を確認してください。';
        } else if (res.status === 400 && body.error === 'non_terminal_doc_ids') {
          const details = body.details as DocIdsErrorDetails | undefined;
          setDocIdsErrorDetails({
            unknownDocIds: details?.unknownDocIds ?? [],
            nonTerminalDocIds: details?.nonTerminalDocIds ?? [],
          });
          errMsg = '指定した docId がまだ処理中です。下の詳細を確認してください。';
        } else if (res.status === 400) {
          const detail =
            typeof body.details === 'string'
              ? body.details
              : JSON.stringify(body.details);
          errMsg = `入力エラー: ${detail}`;
        } else if (
          res.status === 409 &&
          (body.error === 'no_inventory_documents' ||
            body.error === 'no_knowledge_chunks')
        ) {
          errMsg =
            '先に Inventory を取り込んでください（/upload または /import/google-sheets からドキュメントをインポートしてください）。';
        } else if (res.status === 502) {
          errMsg =
            'サーバーエラーが発生しました。しばらくしてから再試行してください。';
        } else if (
          res.status === 422 &&
          body.error === 'sync_budget_exceeded'
        ) {
          const detail =
            typeof body.details === 'string'
              ? body.details
              : '同期処理の制限を超えました。';
          const hint = body.recommendation?.hint;
          errMsg = hint ? `${detail} ${hint}` : detail;
          const suggested = body.recommendation?.suggestedDocIds;
          if (suggested && suggested.length > 0) {
            setSuggestedDocIds(suggested);
          }
        } else {
          errMsg = body.error ?? errMsg;
        }
      } catch {
        /* ignore JSON parse errors */
      }
      setErrorMessage(errMsg);
      setUiState('error');
    } catch {
      setErrorMessage('ネットワークエラーが発生しました。');
      setUiState('error');
    }
  };

  return (
    <div className="cp-layout">
      <form className="cp-form" onSubmit={handleSubmit}>
        <div className="cp-label-row">
          <label className="cp-label__text" htmlFor="cp-purpose">
            Purpose（目的）
          </label>
          <span
            className={`cp-char-count${remaining < 100 ? ' cp-char-count--warn' : ''}`}
          >
            {purpose.length} / {MAX_PURPOSE}
          </span>
        </div>
        <textarea
          id="cp-purpose"
          className="cp-textarea"
          name="purpose"
          value={purpose}
          onChange={(e) => handlePurposeChange(e.target.value)}
          disabled={isFormDisabled}
          maxLength={MAX_PURPOSE}
          rows={5}
          placeholder="例: 新入社員向けに給与計算業務を学べる AI を作りたい"
          required
        />

        <div className="cp-form-footer">
          <button
            type="button"
            className="cp-secondary"
            onClick={() => void fetchCandidates()}
            disabled={isFormDisabled || purpose.trim().length === 0}
          >
            {isFetchingCandidates ? (
              <>
                <span className="cp-spinner cp-spinner--dark" aria-hidden="true" />
                候補を取得中…
              </>
            ) : (
              '候補を表示'
            )}
          </button>
          <button
            type="submit"
            className="cp-submit"
            disabled={!generateEnabled}
            title={
              !candidatesReady
                ? '先に「候補を表示」で文書を選んでください'
                : previewNeedsAck && !previewAcknowledged
                  ? 'プレビューを確認し、チェックを入れてください'
                  : undefined
            }
          >
            {isBusy ? (
              <>
                <span className="cp-spinner" aria-hidden="true" />
                {uiState === 'polling' ? 'バックグラウンド生成中…' : '生成中…'}
              </>
            ) : (
              'Context Package を生成'
            )}
          </button>
        </div>

        {candidatesError ? (
          <div className="cp-candidates-error" role="alert">
            {candidatesError}
          </div>
        ) : null}

        {candidatesStale ? (
          <p className="cp-stale-hint" role="status">
            Purpose が変更されました。「候補を表示」を押してから生成してください。
          </p>
        ) : null}

        {candidatesReady ? (
          <>
            <SafetyReviewPanel
              candidates={candidates}
              missingHints={missingHints}
              selectedDocIds={selectedDocIdsForGeneration}
            />
            <CandidateSelectionList
              candidates={candidates}
              inventoryScanned={inventoryScanned}
              selectedDocIds={selectedDocIds}
              onToggle={handleToggleCandidate}
              disabled={isFormDisabled}
            />
          </>
        ) : null}

        <details className="cp-advanced">
          <summary className="cp-advanced-summary">
            上級者向け: Doc ID を直接指定
          </summary>
          <p className="cp-advanced-hint">
            入力がある場合はチェックボックス選択より優先して生成します（改行またはカンマ区切り・最大
            20 件）。
          </p>
          <textarea
            id="cp-doc-ids"
            className="cp-textarea"
            name="docIds"
            value={docIdsRaw}
            onChange={(e) => {
              setDocIdsRaw(e.target.value);
              setPreviewAcknowledged(false);
            }}
            disabled={isFormDisabled}
            rows={3}
            placeholder={'例:\ndoc-abc123\ndoc-def456'}
            spellCheck={false}
            aria-label="対象 Doc IDs（上級者向け）"
          />
        </details>

        {preGenerationPreview ? (
          <PreGenerationPreviewPanel
            preview={preGenerationPreview}
            acknowledged={previewAcknowledged}
            onAcknowledgedChange={setPreviewAcknowledged}
          />
        ) : null}
      </form>

      {uiState === 'polling' ? (
        <div className="cp-job-panel" role="status" aria-live="polite">
          <span className="cp-spinner" aria-hidden="true" />
          <div>
            <strong>
              {jobStatus ? JOB_STATUS_LABEL[jobStatus] : 'バックグラウンド生成中…'}
            </strong>
            {jobNote ? <p className="cp-job-note">{jobNote}</p> : null}
            <p className="cp-job-hint">
              この画面を開いたまま少しお待ちください（数秒ごとに状態を確認しています）。
            </p>
          </div>
        </div>
      ) : null}

      {uiState === 'error' && errorMessage ? (
        <div className="cp-error-panel" role="alert">
          <strong>エラー</strong>
          <p>{errorMessage}</p>
          {docIdsErrorDetails ? (
            <div className="cp-docids-error-details">
              {docIdsErrorDetails.unknownDocIds.length > 0 ? (
                <div>
                  <p className="cp-docids-error-label">存在しない docId:</p>
                  <ul className="cp-docids-error-list">
                    {docIdsErrorDetails.unknownDocIds.map((id) => (
                      <li key={id}>
                        <code>{id}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {docIdsErrorDetails.nonTerminalDocIds.length > 0 ? (
                <div>
                  <p className="cp-docids-error-label">処理中の docId:</p>
                  <ul className="cp-docids-error-list">
                    {docIdsErrorDetails.nonTerminalDocIds.map(({ docId, status }) => (
                      <li key={docId}>
                        <code>{docId}</code> — {status}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          {suggestedDocIds && suggestedDocIds.length > 0 ? (
            <div className="cp-suggested-docids">
              <p className="cp-docids-error-label">推奨 docIds（budget 内に収まるセット）:</p>
              <ul className="cp-docids-error-list">
                {suggestedDocIds.map((id) => (
                  <li key={id}>
                    <code>{id}</code>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="cp-apply-suggestion-btn"
                onClick={() => applyDocIdSuggestion(suggestedDocIds)}
              >
                この docIds を適用して再試行
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {uiState === 'done' && result ? (
        <div className="cp-result">
          <div className="cp-result-meta">
            <span>
              生成日時: {new Date(result.generatedAt).toLocaleString('ja-JP')}
            </span>
            <span>レビュー文書数: {result.sourceDocumentsReviewed}</span>
          </div>

          {result.budgetDroppedDocuments.length > 0 ? (
            <div className="cp-truncation-warning" role="alert">
              <strong>⚠️ この Context Package は不完全です</strong>
              <p>
                入力 budget の上限に収めるため、安全に使えるはずの chunk が
                {' '}
                {result.budgetDroppedDocuments.reduce(
                  (sum, d) => sum + d.droppedChunks,
                  0,
                )}
                {' '}
                件（
                {result.budgetDroppedDocuments.length}
                {' '}
                文書）除外されました。完全なカバレッジが必要な場合は、対象 Doc IDs
                を絞って再実行してください。
              </p>
              <ul className="cp-truncation-list">
                {result.budgetDroppedDocuments.map((d) => (
                  <li key={d.docId}>
                    {d.fileName} — {d.droppedChunks} chunk(s) dropped
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="cp-counts-grid">
            <div className="cp-count-card">
              <span>Included</span>
              <strong>{result.counts.included}</strong>
            </div>
            <div className="cp-count-card cp-count-card--excluded">
              <span>Excluded</span>
              <strong>{result.counts.excluded}</strong>
            </div>
            <div className="cp-count-card cp-count-card--safety">
              <span>Safety Excluded</span>
              <strong>{result.counts.safetyExcluded}</strong>
            </div>
            <div className="cp-count-card cp-count-card--missing">
              <span>Missing</span>
              <strong>{result.counts.missing}</strong>
            </div>
            <div className="cp-count-card cp-count-card--review">
              <span>Review Questions</span>
              <strong>{result.counts.humanReviewQuestions}</strong>
            </div>
          </div>

          {result.included.length > 0 ? (
            <section className="cp-section">
              <h2 className="cp-section-title cp-section-title--included">
                Included chunks ({result.counts.included})
              </h2>
              <ul className="cp-chunk-list">
                {result.included.map((c) => (
                  <li key={c.chunkId} className="cp-chunk-item">
                    <div className="cp-chunk-header">
                      <strong>{c.parent.fileName}</strong>
                      {c.chunk.title ? (
                        <span className="cp-chunk-title">{c.chunk.title}</span>
                      ) : null}
                      <span className="cp-chunk-sensitivity">
                        {c.chunk.sensitivity}
                      </span>
                    </div>
                    <p className="cp-chunk-rationale">{c.rationale}</p>
                    <p className="cp-chunk-meta">
                      {c.parent.documentType} · {c.parent.businessDomain}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {result.excluded.length > 0 ? (
            <section className="cp-section">
              <h2 className="cp-section-title cp-section-title--excluded">
                Excluded chunks ({result.counts.excluded})
              </h2>
              <ul className="cp-chunk-list">
                {result.excluded.map((c) => (
                  <li
                    key={c.chunkId}
                    className="cp-chunk-item cp-chunk-item--excluded"
                  >
                    <div className="cp-chunk-header">
                      <strong>{c.parent.fileName}</strong>
                      {c.chunk.title ? (
                        <span className="cp-chunk-title">{c.chunk.title}</span>
                      ) : null}
                      <span className="cp-chunk-sensitivity">
                        {c.chunk.sensitivity}
                      </span>
                    </div>
                    <p className="cp-chunk-rationale">{c.rationale}</p>
                    {c.reason ? (
                      <p className="cp-chunk-reason">理由: {c.reason}</p>
                    ) : null}
                    <p className="cp-chunk-meta">
                      {c.parent.documentType} · {c.parent.businessDomain}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {result.safetyExcluded.length > 0 ? (
            <section className="cp-section">
              <h2 className="cp-section-title cp-section-title--safety">
                Safety excluded chunks ({result.counts.safetyExcluded})
              </h2>
              <ul className="cp-chunk-list">
                {result.safetyExcluded.map((c) => (
                  <li
                    key={c.chunkId}
                    className="cp-chunk-item cp-chunk-item--safety"
                  >
                    <div className="cp-chunk-header">
                      <strong>{c.parent.fileName}</strong>
                      {c.chunk.title ? (
                        <span className="cp-chunk-title">{c.chunk.title}</span>
                      ) : null}
                      <span className="cp-chunk-sensitivity">
                        {c.chunk.sensitivity}
                      </span>
                    </div>
                    <p className="cp-chunk-rationale">{c.rationale}</p>
                    <p className="cp-chunk-reason">除外理由: {c.reason}</p>
                    <p className="cp-chunk-meta">
                      {c.parent.documentType} · {c.parent.businessDomain}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {result.missing.length > 0 ? (
            <section className="cp-section">
              <h2 className="cp-section-title cp-section-title--missing">
                Missing knowledge ({result.counts.missing})
              </h2>
              <ul className="cp-text-list">
                {result.missing.map((item, i) => (
                  <li key={`${i}-${item}`}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {result.humanReviewQuestions.length > 0 ? (
            <section className="cp-section">
              <h2 className="cp-section-title cp-section-title--review">
                Human review questions ({result.counts.humanReviewQuestions})
              </h2>
              <ul className="cp-text-list">
                {result.humanReviewQuestions.map((q, i) => (
                  <li key={`${i}-${q}`}>{q}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="cp-section">
            <h2 className="cp-section-title">Markdown preview</h2>
            <pre className="cp-markdown-pre">{result.markdown}</pre>
          </section>

          <div className="cp-download-row">
            <button
              type="button"
              className="cp-download-btn"
              onClick={() => downloadMarkdown(result.markdown, result.purpose)}
            >
              .md をダウンロード
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

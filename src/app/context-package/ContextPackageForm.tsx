'use client';

import { useState } from 'react';

const MAX_PURPOSE = 2000;

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
  details?: unknown;
  recommendation?: {
    hint?: string;
    suggestedDocIds?: string[];
  };
};

type UiState = 'idle' | 'loading' | 'done' | 'error';

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
  // 一部ブラウザで click() 直後に revoke すると download が取り消されることがあるため遅延する。
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

export function ContextPackageForm() {
  const [purpose, setPurpose] = useState('');
  const [docIdsRaw, setDocIdsRaw] = useState('');
  const [uiState, setUiState] = useState<UiState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [docIdsErrorDetails, setDocIdsErrorDetails] = useState<DocIdsErrorDetails | null>(null);
  const [suggestedDocIds, setSuggestedDocIds] = useState<string[] | null>(null);
  const [result, setResult] = useState<ContextPackageResult | null>(null);

  const isLoading = uiState === 'loading';
  const remaining = MAX_PURPOSE - purpose.length;

  const applyDocIdSuggestion = (ids: string[]) => {
    setDocIdsRaw(ids.join('\n'));
    setSuggestedDocIds(null);
    setErrorMessage(null);
    setDocIdsErrorDetails(null);
    setUiState('idle');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setDocIdsErrorDetails(null);
    setSuggestedDocIds(null);
    setResult(null);
    setUiState('loading');

    const docIds = parseDocIds(docIdsRaw);

    try {
      const res = await fetch('/api/context-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose,
          ...(docIds.length > 0 ? { docIds } : {}),
        }),
      });

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
          onChange={(e) => setPurpose(e.target.value)}
          disabled={isLoading}
          maxLength={MAX_PURPOSE}
          rows={5}
          placeholder="例: 新入社員向けオンボーディング資料を NotebookLM に渡して Q&A できるようにしたい"
          required
        />

        <div className="cp-label-row" style={{ marginTop: '1rem' }}>
          <label className="cp-label__text" htmlFor="cp-doc-ids">
            対象 Doc IDs（任意）
          </label>
          <span className="cp-char-count">
            改行またはカンマ区切り・最大 20 件
          </span>
        </div>
        <textarea
          id="cp-doc-ids"
          className="cp-textarea"
          name="docIds"
          value={docIdsRaw}
          onChange={(e) => setDocIdsRaw(e.target.value)}
          disabled={isLoading}
          rows={3}
          placeholder={"例:\na74b9520-5442-4579-adb8-2781dae8999b\nb3e21f04-..."}
          spellCheck={false}
        />

        <div className="cp-form-footer">
          <button
            type="submit"
            className="cp-submit"
            disabled={isLoading || purpose.trim().length === 0}
          >
            {isLoading ? (
              <>
                <span className="cp-spinner" aria-hidden="true" />
                生成中…
              </>
            ) : (
              'Context Package を生成'
            )}
          </button>
        </div>
      </form>

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
                      <li key={id}><code>{id}</code></li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {docIdsErrorDetails.nonTerminalDocIds.length > 0 ? (
                <div>
                  <p className="cp-docids-error-label">処理中の docId:</p>
                  <ul className="cp-docids-error-list">
                    {docIdsErrorDetails.nonTerminalDocIds.map(({ docId, status }) => (
                      <li key={docId}><code>{docId}</code> — {status}</li>
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
                  <li key={id}><code>{id}</code></li>
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

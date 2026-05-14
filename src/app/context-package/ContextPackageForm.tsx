'use client';

import { useState } from 'react';

const MAX_PURPOSE = 2000;

type ChunkSelection = {
  docId: string;
  chunkId: string;
  rationale: string;
  confidence?: number;
  reason?: string;
  chunk: { title?: string; text: string; sensitivity: string };
  parent: { fileName: string; documentType: string; businessDomain: string };
};

type SafetyExcludedChunk = {
  docId: string;
  chunkId: string;
  rationale: string;
  reason: string;
  chunk: { title?: string; text: string; sensitivity: string };
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
  counts: {
    included: number;
    excluded: number;
    safetyExcluded: number;
    missing: number;
    humanReviewQuestions: number;
  };
};

type ApiErrorResponse = {
  error?: string;
  details?: unknown;
};

type UiState = 'idle' | 'loading' | 'done' | 'error';

function downloadMarkdown(markdown: string, purpose: string) {
  const slug = purpose.slice(0, 30).replace(/[^\w\u3040-\u9fff]/g, '_');
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `context-package_${slug}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ContextPackageForm() {
  const [purpose, setPurpose] = useState('');
  const [uiState, setUiState] = useState<UiState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ContextPackageResult | null>(null);

  const isLoading = uiState === 'loading';
  const remaining = MAX_PURPOSE - purpose.length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setResult(null);
    setUiState('loading');

    try {
      const res = await fetch('/api/context-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose }),
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
        if (res.status === 400) {
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
                  <li key={i}>{item}</li>
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
                  <li key={i}>{q}</li>
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

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentUploadSuccessResponse } from '../../../lib/documents';
import { CuratorResultCard } from '../../upload/CuratorResultCard';
import { MaskerResultCard } from '../../upload/MaskerResultCard';

type UiStatus =
  | 'idle'
  | 'importing'
  | 'curating'
  | 'done'
  | 'error'
  | 'share_error';

/** デモ運用手順（リポジトリ docs/demo-runbook.md）のブラウザ向けリンク */
const DEMO_RUNBOOK_DOC_URL =
  process.env.NEXT_PUBLIC_DEMO_RUNBOOK_DOC_URL ??
  'https://github.com/matz-d/ai-ready-knowledge-hub/blob/main/docs/demo-runbook.md';

type ServiceAccountEmailState =
  | { status: 'loading' }
  | { status: 'ready'; email: string }
  | { status: 'error'; message: string };

type ImportApiErrorBody = {
  error?: string;
  serviceAccountEmail?: string;
  docId?: string;
};

const PROCESSING_INDICATOR_DELAY_MS = 400;

export function ImportForm() {
  const [saState, setSaState] = useState<ServiceAccountEmailState>({
    status: 'loading',
  });
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [status, setStatus] = useState<UiStatus>('idle');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorDocId, setErrorDocId] = useState<string | null>(null);
  const [shareErrorEmail, setShareErrorEmail] = useState<string | null>(null);
  const [success, setSuccess] = useState<DocumentUploadSuccessResponse | null>(
    null
  );
  const processingIndicatorDelayTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          '/api/import/google-sheets/service-account-email'
        );
        const data = (await res.json()) as {
          serviceAccountEmail?: string;
          code?: string;
          error?: string;
        };
        if (cancelled) return;
        if (res.ok && data.serviceAccountEmail) {
          setSaState({ status: 'ready', email: data.serviceAccountEmail });
        } else {
          setSaState({
            status: 'error',
            message:
              data.error ??
              data.code ??
              'サービスアカウントのメールアドレスを取得できませんでした。',
          });
        }
      } catch {
        if (!cancelled) {
          setSaState({
            status: 'error',
            message: 'サービスアカウント情報の取得に失敗しました。',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const clearProcessingIndicatorDelay = useCallback(() => {
    if (processingIndicatorDelayTimeoutRef.current) {
      clearTimeout(processingIndicatorDelayTimeoutRef.current);
      processingIndicatorDelayTimeoutRef.current = null;
    }
  }, []);

  const copyEmail = useCallback(async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      setCopyHint('クリップボードにコピーしました');
      setTimeout(() => setCopyHint(null), 2500);
    } catch {
      setCopyHint('コピーに失敗しました。手動で選択してください。');
      setTimeout(() => setCopyHint(null), 3500);
    }
  }, []);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    clearProcessingIndicatorDelay();
    setErrorCode(null);
    setErrorMessage(null);
    setErrorDocId(null);
    setShareErrorEmail(null);
    setSuccess(null);

    const form = e.currentTarget;
    const input = form.elements.namedItem('urlOrFileId') as HTMLInputElement;
    const urlOrFileId = input.value.trim();
    if (!urlOrFileId) {
      setStatus('error');
      setErrorCode('client_validation');
      setErrorMessage('URL または fileId を入力してください。');
      return;
    }

    setStatus('importing');
    processingIndicatorDelayTimeoutRef.current = setTimeout(() => {
      setStatus('curating');
    }, PROCESSING_INDICATOR_DELAY_MS);

    try {
      const res = await fetch('/api/import/google-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urlOrFileId }),
      });
      clearProcessingIndicatorDelay();

      if (res.ok) {
        const data = (await res.json()) as DocumentUploadSuccessResponse;
        setSuccess(data);
        setStatus('done');
        return;
      }

      const body = (await res.json()) as ImportApiErrorBody;
      const errorCode = body.error ?? `http_${res.status}`;
      const emailFromBody = body.serviceAccountEmail?.trim();

      if (res.status === 403 && body.error === 'sheet_not_shared') {
        setStatus('share_error');
        setErrorCode(body.error);
        setErrorMessage('スプレッドシートをサービスアカウントと共有してください。');
        setShareErrorEmail(
          emailFromBody ??
            (saState.status === 'ready' ? saState.email : null)
        );
        return;
      }

      setStatus('error');
      setErrorCode(errorCode);
      setErrorMessage(body.error ?? '取り込みに失敗しました。');
      setErrorDocId(body.docId ?? null);
    } catch {
      clearProcessingIndicatorDelay();
      setStatus('error');
      setErrorCode('network_error');
      setErrorMessage('ネットワークエラーが発生しました。');
      setErrorDocId(null);
    }
  };

  const saEmailForDisplay =
    saState.status === 'ready' ? saState.email : null;

  const statusLabel =
    status === 'importing'
      ? 'Drive からエクスポート中…'
      : status === 'curating'
        ? 'Curator / Masker が処理中…'
        : null;

  return (
    <div className="upload-layout import-sheets-layout">
      <section
        className="import-sa-panel"
        aria-labelledby="import-sa-heading"
      >
        <h2 id="import-sa-heading" className="import-sa-panel__title">
          サービスアカウント
        </h2>
        <p className="import-sa-panel__lead">
          <strong>スプレッドシートを次のメールアドレスと共有してください。</strong>
          共有がないと Drive API が 403 となり取り込めません。
        </p>
        {saState.status === 'loading' ? (
          <p className="import-sa-panel__status" role="status">
            メールアドレスを読み込み中…
          </p>
        ) : null}
        {saState.status === 'ready' ? (
          <div className="import-sa-panel__row">
            <code className="import-sa-panel__email" title="Service account email">
              {saState.email}
            </code>
            <button
              type="button"
              className="import-sa-panel__copy"
              onClick={() => copyEmail(saState.email)}
            >
              コピー
            </button>
          </div>
        ) : null}
        {saState.status === 'error' ? (
          <p className="import-sa-panel__warn" role="alert">
            {saState.message}
          </p>
        ) : null}
        {copyHint ? (
          <p className="import-sa-panel__hint" role="status">
            {copyHint}
          </p>
        ) : null}
      </section>

      <form className="upload-form import-sheets-form" onSubmit={onSubmit}>
        <label className="upload-file-label">
          <span className="upload-file-label__text">
            Google Sheets の URL または fileId
          </span>
          <input
            className="upload-file-input import-sheets-url-input"
            type="text"
            name="urlOrFileId"
            autoComplete="off"
            placeholder="https://docs.google.com/spreadsheets/d/… または fileId"
            disabled={status === 'importing' || status === 'curating'}
          />
        </label>
        <p className="import-sheets-note" role="note">
          特定タブの URL でも<strong>全シート</strong>を取り込みます（URL の{' '}
          <code>gid=</code> は無視されます）。
        </p>
        <button
          type="submit"
          className="upload-submit"
          disabled={status === 'importing' || status === 'curating'}
        >
          {status === 'importing' || status === 'curating'
            ? '処理中…'
            : '取り込む'}
        </button>
        {statusLabel ? (
          <p className="upload-status" role="status">
            {statusLabel}
          </p>
        ) : null}
      </form>

      {status === 'share_error' && errorCode ? (
        <div
          className="import-share-error-panel"
          role="alert"
          aria-live="polite"
        >
          <strong className="import-share-error-panel__title">
            共有が必要です（{errorCode}）
          </strong>
          <p>{errorMessage}</p>
          {shareErrorEmail ? (
            <div className="import-share-error-panel__email-block">
              <span className="import-share-error-panel__label">
                共有先のメールアドレス
              </span>
              <code className="import-share-error-panel__email">
                {shareErrorEmail}
              </code>
              <button
                type="button"
                className="import-sa-panel__copy import-share-error-panel__copy"
                onClick={() => copyEmail(shareErrorEmail)}
              >
                コピー
              </button>
            </div>
          ) : (
            <p className="import-share-error-panel__fallback">
              ページ上部のサービスアカウント欄に表示されているメールアドレスと共有してください。
            </p>
          )}
          <p className="import-share-error-panel__doc">
            <a href={DEMO_RUNBOOK_DOC_URL} target="_blank" rel="noopener noreferrer">
              デモ運用手順（docs/demo-runbook.md）
            </a>
            に共有手順があります。
          </p>
        </div>
      ) : null}

      {status === 'error' && errorCode ? (
        <div className="import-error-code-banner" role="alert">
          <strong>{errorCode}</strong>
          {errorMessage ? <p>{errorMessage}</p> : null}
          {errorDocId ? (
            <p className="upload-error-docid">
              <span>docId</span> <code>{errorDocId}</code>
            </p>
          ) : null}
        </div>
      ) : null}

      {status === 'done' && success ? (
        <>
          <CuratorResultCard result={success} />
          <MaskerResultCard result={success} />
        </>
      ) : null}
    </div>
  );
}

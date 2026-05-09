'use client';

import { useCallback, useRef, useState } from 'react';
import type { DocumentUploadSuccessResponse } from '../../lib/documents';
import { CuratorResultCard } from './CuratorResultCard';
import { MaskerResultCard } from './MaskerResultCard';

type UiStatus = 'idle' | 'uploading' | 'curating' | 'done' | 'error';

type ErrorBody = {
  error?: string;
  docId?: string;
};

/** アップロード送信直後は短い応答でも「処理中」がチラつくのを避ける UI 遅延（ms）。 */
const PROCESSING_INDICATOR_DELAY_MS = 400;

export function UploadForm() {
  const [status, setStatus] = useState<UiStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorDocId, setErrorDocId] = useState<string | null>(null);
  const [success, setSuccess] = useState<DocumentUploadSuccessResponse | null>(
    null
  );
  /** `PROCESSING_INDICATOR_DELAY_MS` 経過後に `curating` 表示へ切り替えるタイマー ID。 */
  const processingIndicatorDelayTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const clearProcessingIndicatorDelay = useCallback(() => {
    if (processingIndicatorDelayTimeoutRef.current) {
      clearTimeout(processingIndicatorDelayTimeoutRef.current);
      processingIndicatorDelayTimeoutRef.current = null;
    }
  }, []);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    clearProcessingIndicatorDelay();
    setErrorMessage(null);
    setErrorDocId(null);
    setSuccess(null);

    const form = e.currentTarget;
    const input = form.elements.namedItem('file') as HTMLInputElement;
    const selected = input.files?.[0];
    if (!selected) {
      setStatus('error');
      setErrorMessage('ファイルを選択してください。');
      return;
    }

    const formData = new FormData();
    formData.append('file', selected);

    setStatus('uploading');
    processingIndicatorDelayTimeoutRef.current = setTimeout(() => {
      setStatus('curating');
    }, PROCESSING_INDICATOR_DELAY_MS);

    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        body: formData,
      });
      clearProcessingIndicatorDelay();

      if (res.ok) {
        const data = (await res.json()) as DocumentUploadSuccessResponse;
        setSuccess(data);
        setStatus('done');
        return;
      }

      let message = 'アップロードに失敗しました。';
      let docId: string | null = null;
      try {
        const body = (await res.json()) as ErrorBody;
        if (body.error) message = body.error;
        if (body.docId) docId = body.docId;
      } catch {
        /* ignore */
      }
      setErrorMessage(message);
      setErrorDocId(docId);
      setStatus('error');
    } catch {
      clearProcessingIndicatorDelay();
      setErrorMessage('ネットワークエラーが発生しました。');
      setErrorDocId(null);
      setStatus('error');
    }
  };

  const statusLabel =
    status === 'uploading'
      ? 'アップロード中…'
      : status === 'curating'
        ? 'Curator / Masker が処理中…'
        : null;

  return (
    <div className="upload-layout">
      <form className="upload-form" onSubmit={onSubmit}>
        <label className="upload-file-label">
          <span className="upload-file-label__text">ファイル</span>
          <input
            className="upload-file-input"
            type="file"
            name="file"
            accept=".txt,.md,.csv,text/plain,text/markdown,text/csv"
            disabled={status === 'uploading' || status === 'curating'}
          />
        </label>
        <button
          type="submit"
          className="upload-submit"
          disabled={status === 'uploading' || status === 'curating'}
        >
          {status === 'uploading' || status === 'curating'
            ? '処理中…'
            : 'アップロードして分類'}
        </button>
        {statusLabel ? (
          <p className="upload-status" role="status">
            {statusLabel}
          </p>
        ) : null}
      </form>

      {status === 'error' && errorMessage ? (
        <div className="upload-error-panel" role="alert">
          <strong>エラー</strong>
          <p>{errorMessage}</p>
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

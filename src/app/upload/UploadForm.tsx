'use client';

import { useCallback, useRef, useState } from 'react';
import type { DocumentUploadSuccessResponse } from '../../lib/documents';
import { CuratorResultCard } from './CuratorResultCard';

type UiStatus = 'idle' | 'uploading' | 'curating' | 'done' | 'error';

type ErrorBody = {
  error?: string;
  docId?: string;
};

export function UploadForm() {
  const [status, setStatus] = useState<UiStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorDocId, setErrorDocId] = useState<string | null>(null);
  const [success, setSuccess] = useState<DocumentUploadSuccessResponse | null>(
    null
  );
  const curatingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCuratingTimer = useCallback(() => {
    if (curatingTimer.current) {
      clearTimeout(curatingTimer.current);
      curatingTimer.current = null;
    }
  }, []);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    clearCuratingTimer();
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
    curatingTimer.current = setTimeout(() => {
      setStatus('curating');
    }, 400);

    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        body: formData,
      });
      clearCuratingTimer();

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
      clearCuratingTimer();
      setErrorMessage('ネットワークエラーが発生しました。');
      setErrorDocId(null);
      setStatus('error');
    }
  };

  const statusLabel =
    status === 'uploading'
      ? 'アップロード中…'
      : status === 'curating'
        ? 'Curator が分類中…'
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
        <CuratorResultCard result={success} />
      ) : null}
    </div>
  );
}

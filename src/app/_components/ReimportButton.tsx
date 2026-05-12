'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentUploadSuccessResponse } from '../../lib/documents';

type ReimportStatus = 'idle' | 'loading' | 'done' | 'error';

type ToastState =
  | { type: 'overwritten' }
  | { type: 'skipped' }
  | { type: 'created' }
  | { type: 'error'; message: string };

type Props = {
  /** Google Drive fileId or webViewLink URL. */
  urlOrFileId: string;
  className?: string;
};

const TOAST_DURATION_MS = 4000;

export function ReimportButton({ urlOrFileId, className }: Props) {
  const [status, setStatus] = useState<ReimportStatus>('idle');
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearToastTimer = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearToastTimer();
  }, [clearToastTimer]);

  const scheduleToastDismiss = useCallback(() => {
    clearToastTimer();
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, TOAST_DURATION_MS);
  }, [clearToastTimer]);

  const handleClick = useCallback(async () => {
    if (status === 'loading') return;
    setStatus('loading');
    setToast(null);
    clearToastTimer();

    try {
      const res = await fetch('/api/import/google-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urlOrFileId }),
      });

      if (res.ok) {
        const data = (await res.json()) as DocumentUploadSuccessResponse;
        if (data.skipped) {
          setToast({ type: 'skipped' });
        } else if (data.kind === 'overwritten') {
          setToast({ type: 'overwritten' });
        } else {
          setToast({ type: 'created' });
        }
        setStatus('done');
      } else {
        let message = '再取り込みに失敗しました。';
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // ignore parse error
        }
        setToast({ type: 'error', message });
        setStatus('error');
      }
    } catch {
      setToast({ type: 'error', message: 'ネットワークエラーが発生しました。' });
      setStatus('error');
    }

    scheduleToastDismiss();
  }, [status, urlOrFileId, clearToastTimer, scheduleToastDismiss]);

  const isLoading = status === 'loading';

  return (
    <span className="reimport-wrapper">
      <button
        type="button"
        className={`reimport-btn${className ? ` ${className}` : ''}`}
        onClick={handleClick}
        disabled={isLoading}
        aria-label="Drive から再取り込み"
      >
        {isLoading ? '再取り込み中…' : '再取り込み'}
      </button>
      {toast ? (
        <span
          className={`reimport-toast reimport-toast--${toast.type}`}
          role="status"
          aria-live="polite"
        >
          {toast.type === 'overwritten' && '✓ 上書き取り込み完了（kind: overwritten）'}
          {toast.type === 'skipped' && '✓ 内容変更なし（skipped）'}
          {toast.type === 'created' && '✓ 新規取り込み完了'}
          {toast.type === 'error' && `✕ ${toast.message}`}
        </span>
      ) : null}
    </span>
  );
}

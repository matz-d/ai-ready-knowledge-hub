'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import type { DocumentUploadSuccessResponse } from '../../lib/documents';
import { CuratorResultCard } from './CuratorResultCard';
import { MaskerResultCard } from './MaskerResultCard';
import {
  MAX_UPLOAD_FILES,
  UPLOAD_CONCURRENCY,
  isFileTooLarge,
  maxFileSizeMessage,
  runWithConcurrency,
  tooManyFilesMessage,
  uploadSingleDocument,
} from './uploadQueue';

type ItemStatus = 'queued' | 'uploading' | 'succeeded' | 'failed';

type QueueItem = {
  id: string;
  file: File;
  status: ItemStatus;
  result?: DocumentUploadSuccessResponse;
  error?: string;
  docId?: string;
  /** Client-side rejection (oversize): re-uploading would just fail again. */
  rejectedLocally?: boolean;
};

const ACCEPT =
  '.txt,.md,.csv,.xlsx,.pdf,text/plain,text/markdown,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf';

const STATUS_LABEL: Record<ItemStatus, string> = {
  queued: '待機中',
  uploading: 'アップロード中…',
  succeeded: '完了',
  failed: '失敗',
};

export function UploadForm() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);
  /** Synchronous single-flight guard: a run may be in flight before React has
   *  re-rendered any item to `uploading`, so a ref (not derived state) is the
   *  reliable lock against overlapping runs / double-clicks. */
  const runningRef = useRef(false);
  const idCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isRunning = items.some(
    (it) => it.status === 'queued' || it.status === 'uploading'
  );
  const succeededCount = items.filter((it) => it.status === 'succeeded').length;
  const retryableFailedItems = items.filter(
    (it) => it.status === 'failed' && !it.rejectedLocally
  );

  const updateItem = (id: string, patch: Partial<QueueItem>) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it))
    );
  };

  const runItems = async (targets: QueueItem[]) => {
    if (runningRef.current || targets.length === 0) return;
    runningRef.current = true;
    try {
      await runWithConcurrency(targets, UPLOAD_CONCURRENCY, async (item) => {
        updateItem(item.id, { status: 'uploading', error: undefined });
        const outcome = await uploadSingleDocument(item.file);
        if (outcome.ok) {
          updateItem(item.id, {
            status: 'succeeded',
            result: outcome.data,
            docId: outcome.data.docId,
            error: undefined,
          });
        } else {
          updateItem(item.id, {
            status: 'failed',
            error: outcome.message,
            docId: outcome.docId,
          });
        }
      });
    } finally {
      runningRef.current = false;
    }
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (runningRef.current) return;
    setBatchError(null);

    const selected = Array.from(fileInputRef.current?.files ?? []);
    if (selected.length === 0) {
      setBatchError('ファイルを選択してください。');
      return;
    }
    if (selected.length > MAX_UPLOAD_FILES) {
      setBatchError(tooManyFilesMessage());
      return;
    }

    const nextItems: QueueItem[] = selected.map((file) => {
      const id = `upload-${idCounterRef.current++}`;
      if (isFileTooLarge(file)) {
        return {
          id,
          file,
          status: 'failed',
          error: maxFileSizeMessage(),
          rejectedLocally: true,
        };
      }
      return { id, file, status: 'queued' };
    });

    setItems(nextItems);
    // Reset the input so re-selecting the same files fires `change`/submit again.
    if (fileInputRef.current) fileInputRef.current.value = '';
    void runItems(nextItems.filter((it) => it.status === 'queued'));
  };

  const retryItem = (id: string) => {
    const item = items.find((it) => it.id === id);
    if (!item || item.rejectedLocally) return;
    void runItems([item]);
  };

  const retryAllFailed = () => {
    void runItems(retryableFailedItems);
  };

  return (
    <div className="upload-layout">
      <form className="upload-form" onSubmit={onSubmit}>
        <label className="upload-file-label">
          <span className="upload-file-label__text">ファイル（複数選択可）</span>
          <input
            ref={fileInputRef}
            className="upload-file-input"
            type="file"
            name="file"
            multiple
            accept={ACCEPT}
            disabled={isRunning}
          />
        </label>
        <button type="submit" className="upload-submit" disabled={isRunning}>
          {isRunning ? '処理中…' : 'アップロードして分類'}
        </button>
        {isRunning ? (
          <p className="upload-status" role="status">
            アップロード / Curator・Masker が処理中…
          </p>
        ) : null}
      </form>

      {batchError ? (
        <div className="upload-error-panel" role="alert">
          <strong>エラー</strong>
          <p>{batchError}</p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <section className="upload-queue" aria-label="アップロード一覧">
          <div className="upload-queue__head">
            <h2>
              アップロード（{succeededCount}/{items.length} 完了）
            </h2>
            {retryableFailedItems.length > 0 ? (
              <button
                type="button"
                className="upload-retry-all"
                onClick={retryAllFailed}
                disabled={isRunning}
              >
                失敗した {retryableFailedItems.length} 件を再試行
              </button>
            ) : null}
          </div>

          <ul className="upload-queue__list">
            {items.map((item) => (
              <li
                key={item.id}
                className={`upload-queue__item upload-queue__item--${item.status}`}
              >
                <div className="upload-queue__row">
                  <span
                    className={`upload-queue__badge upload-queue__badge--${item.status}`}
                  >
                    {STATUS_LABEL[item.status]}
                  </span>
                  <span className="upload-queue__name">{item.file.name}</span>
                  {item.status === 'failed' && !item.rejectedLocally ? (
                    <button
                      type="button"
                      className="upload-queue__retry"
                      onClick={() => retryItem(item.id)}
                      disabled={isRunning}
                    >
                      再試行
                    </button>
                  ) : null}
                </div>

                {item.status === 'failed' && item.error ? (
                  <p className="upload-queue__error" role="alert">
                    {item.error}
                    {item.docId ? (
                      <>
                        {' '}
                        <code>{item.docId}</code>
                      </>
                    ) : null}
                  </p>
                ) : null}

                {item.status === 'succeeded' && item.result ? (
                  <div className="upload-queue__result">
                    <CuratorResultCard result={item.result} />
                    <MaskerResultCard result={item.result} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          {succeededCount > 0 ? (
            <p className="upload-queue__cta">
              <Link href="/context-package">
                取り込んだ文書で Context Package を作成する →
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

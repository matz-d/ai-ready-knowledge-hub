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

type DemoSampleDocument = {
  fileName: string;
  docId?: string;
  status: 'imported' | 'already_present' | 'failed';
  lifecycleStatus?: string;
  error?: string;
};

type DemoSampleResponse = {
  imported: number;
  alreadyPresent: number;
  failed: number;
  documents: DemoSampleDocument[];
};

const ACCEPT =
  '.txt,.md,.csv,.xlsx,.pdf,text/plain,text/markdown,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf';

const STATUS_LABEL: Record<ItemStatus, string> = {
  queued: '待機中',
  uploading: 'アップロード中…',
  succeeded: '完了',
  failed: '失敗',
};

type UploadFormProps = {
  demoMode?: boolean;
};

export function UploadForm({ demoMode = false }: UploadFormProps) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [demoState, setDemoState] = useState<
    'idle' | 'loading' | 'done' | 'error'
  >('idle');
  const [demoResult, setDemoResult] = useState<DemoSampleResponse | null>(null);
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

  const importDemoSamples = async () => {
    if (demoState === 'loading') return;
    setBatchError(null);
    setDemoResult(null);
    setDemoState('loading');
    try {
      const res = await fetch('/api/demo/sample-documents', { method: 'POST' });
      const body = (await res.json().catch(() => null)) as
        | DemoSampleResponse
        | { error?: string }
        | null;
      if (!res.ok) {
        setBatchError(
          body && 'error' in body && body.error
            ? body.error
            : 'サンプル文書の取り込みに失敗しました。'
        );
        setDemoState('error');
        return;
      }
      setDemoResult(body as DemoSampleResponse);
      setDemoState('done');
    } catch {
      setBatchError('ネットワークエラーが発生しました。');
      setDemoState('error');
    }
  };

  if (demoMode) {
    return (
      <div className="upload-layout">
        <section className="demo-sample-panel" aria-labelledby="demo-sample-heading">
          <div>
            <p className="chapter-kicker">公開デモ</p>
            <h2 id="demo-sample-heading">合成サンプル文書を取り込む</h2>
            <p>
              公開デモでは任意ファイルのアップロードを無効化しています。
              判定済みの架空データだけを取り込み、目的入力から Context Package
              生成までを試せます。
            </p>
          </div>
          <button
            type="button"
            className="upload-submit"
            onClick={() => void importDemoSamples()}
            disabled={demoState === 'loading'}
          >
            {demoState === 'loading' ? '取り込み中…' : 'サンプル文書を取り込む'}
          </button>
        </section>

        {batchError ? (
          <div className="upload-error-panel" role="alert">
            <strong>エラー</strong>
            <p>{batchError}</p>
          </div>
        ) : null}

        {demoResult ? (
          <section className="upload-queue" aria-label="サンプル取り込み結果">
            <div className="upload-queue__head">
              <h2>
                サンプル取り込み（新規 {demoResult.imported} 件 / 既存{' '}
                {demoResult.alreadyPresent} 件）
              </h2>
            </div>
            <ul className="upload-queue__list">
              {demoResult.documents.map((doc) => (
                <li
                  key={doc.fileName}
                  className={`upload-queue__item upload-queue__item--${
                    doc.status === 'failed' ? 'failed' : 'succeeded'
                  }`}
                >
                  <div className="upload-queue__row">
                    <span
                      className={`upload-queue__badge upload-queue__badge--${
                        doc.status === 'failed' ? 'failed' : 'succeeded'
                      }`}
                    >
                      {doc.status === 'imported'
                        ? '取り込み'
                        : doc.status === 'already_present'
                          ? '登録済み'
                          : '失敗'}
                    </span>
                    <span className="upload-queue__name">{doc.fileName}</span>
                  </div>
                  {doc.error ? (
                    <p className="upload-queue__error" role="alert">
                      {doc.error}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            {demoResult.failed === 0 ? (
              <p className="upload-queue__cta">
                <Link href="/context-package">
                  サンプル文書で Context Package を作成する →
                </Link>
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    );
  }

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

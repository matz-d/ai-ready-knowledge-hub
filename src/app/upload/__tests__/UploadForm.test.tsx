/* @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UploadForm } from '../UploadForm';
import { MAX_UPLOAD_BYTES } from '../uploadQueue';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function successBody(docId: string, fileName: string) {
  return {
    docId,
    fileName,
    contentType: 'application/pdf',
    byteSize: 100,
    storagePath: `raw/${docId}/${fileName}`,
    status: 'curated',
    kind: 'created',
    curator: {
      documentType: 'メモ',
      businessDomain: '社内手順',
      sensitivity: 'Internal',
      freshness: 'current',
      isAuthoritativeCandidate: true,
      aiUsePolicy: 'direct',
      rationale: 'ok',
      completedAt: '2026-06-01T00:00:00.000Z',
      modelId: 'test-model',
    },
  };
}

function pdf(name: string): File {
  return new File(['content'], name, { type: 'application/pdf' });
}

function selectFiles(container: HTMLElement, files: File[]) {
  const input = container.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: files });
}

function submit(container: HTMLElement) {
  fireEvent.submit(container.querySelector('form') as HTMLFormElement);
}

describe('UploadForm multi-file queue', () => {
  it('uploads multiple files, continues past a failure, and shows per-file status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, successBody('doc-1', 'ok.pdf')))
      .mockResolvedValueOnce(
        jsonResponse(400, { error: '入力エラー', docId: 'doc-2' })
      );
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<UploadForm />);
    selectFiles(container, [pdf('ok.pdf'), pdf('bad.pdf')]);
    submit(container);

    await waitFor(() => {
      expect(screen.getByText('完了')).toBeTruthy();
      expect(screen.getByText('失敗')).toBeTruthy();
    });

    // Both files were attempted despite the first/second outcome differing.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/入力エラー/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '再試行' })).toBeTruthy();
    // Succeeded file renders the existing curator card.
    expect(screen.getByLabelText('Curator 分類結果')).toBeTruthy();
    // At least one success → CTA to the Context Package page.
    expect(
      screen.getByRole('link', { name: /Context Package を作成/ })
    ).toBeTruthy();
  });

  it('retries only the failed file and marks it succeeded', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, successBody('doc-1', 'ok.pdf')))
      .mockResolvedValueOnce(jsonResponse(500, { error: 'server error' }))
      .mockResolvedValueOnce(jsonResponse(200, successBody('doc-2', 'bad.pdf')));
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<UploadForm />);
    selectFiles(container, [pdf('ok.pdf'), pdf('bad.pdf')]);
    submit(container);

    await waitFor(() => expect(screen.getByText('失敗')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));

    await waitFor(() => expect(screen.queryByText('失敗')).toBeNull());
    await waitFor(() =>
      expect(screen.getAllByLabelText('Curator 分類結果')).toHaveLength(2)
    );
    // first batch (2) + one retry = 3 calls
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects an oversize file client-side without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<UploadForm />);
    const big = pdf('big.pdf');
    Object.defineProperty(big, 'size', { value: MAX_UPLOAD_BYTES + 1 });
    selectFiles(container, [big]);
    submit(container);

    await waitFor(() => expect(screen.getByText('失敗')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
    // Client-side rejection (oversize) offers no retry — re-upload would fail again.
    expect(screen.queryByRole('button', { name: '再試行' })).toBeNull();
    expect(
      screen.getByText('ファイルサイズは 5 MB 以下にしてください。')
    ).toBeTruthy();
  });
});

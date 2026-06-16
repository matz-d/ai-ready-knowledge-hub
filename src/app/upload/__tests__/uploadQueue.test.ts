/* @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import {
  isFileTooLarge,
  MAX_UPLOAD_BYTES,
  runWithConcurrency,
  uploadSingleDocument,
} from '../uploadQueue';

function fakeResponse(
  ok: boolean,
  body: unknown,
  opts: { throwJson?: boolean } = {}
): Response {
  return {
    ok,
    json: async () => {
      if (opts.throwJson) throw new Error('bad json');
      return body;
    },
  } as unknown as Response;
}

const sampleFile = () =>
  new File(['hello'], 'a.txt', { type: 'text/plain' });

describe('uploadSingleDocument', () => {
  it('returns ok with the parsed body on a 2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse(true, { docId: 'doc-1', fileName: 'a.txt' })
    );

    const outcome = await uploadSingleDocument(sampleFile(), fetchMock);

    expect(outcome).toEqual({
      ok: true,
      data: { docId: 'doc-1', fileName: 'a.txt' },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/documents');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('maps a non-2xx body with error + docId to a failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(fakeResponse(false, { error: '入力エラー', docId: 'doc-9' }));

    const outcome = await uploadSingleDocument(sampleFile(), fetchMock);

    expect(outcome).toEqual({
      ok: false,
      message: '入力エラー',
      docId: 'doc-9',
    });
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(fakeResponse(false, null, { throwJson: true }));

    const outcome = await uploadSingleDocument(sampleFile(), fetchMock);

    expect(outcome).toEqual({
      ok: false,
      message: 'アップロードに失敗しました。',
    });
  });

  it('maps a network rejection to a network-error failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));

    const outcome = await uploadSingleDocument(sampleFile(), fetchMock);

    expect(outcome).toEqual({
      ok: false,
      message: 'ネットワークエラーが発生しました。',
    });
  });

  it('fails (without throwing) when a 2xx body cannot be parsed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(fakeResponse(true, null, { throwJson: true }));

    const outcome = await uploadSingleDocument(sampleFile(), fetchMock);

    expect(outcome).toEqual({
      ok: false,
      message: 'アップロード結果の解析に失敗しました。',
    });
  });
});

describe('runWithConcurrency', () => {
  it('processes every item without exceeding the concurrency limit', async () => {
    const items = [1, 2, 3, 4, 5];
    const processed: number[] = [];
    let active = 0;
    let maxActive = 0;

    await runWithConcurrency(items, 2, async (n) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      processed.push(n);
      active -= 1;
    });

    expect([...processed].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(maxActive).toBeGreaterThan(1);
  });

  it('continues the batch when a worker throws (continue-on-failure)', async () => {
    const processed: number[] = [];

    await runWithConcurrency([1, 2, 3], 1, async (n) => {
      if (n === 2) throw new Error('boom');
      processed.push(n);
    });

    expect(processed).toEqual([1, 3]);
  });
});

describe('isFileTooLarge', () => {
  it('flags files over the shared MAX_UPLOAD_BYTES limit', () => {
    const file = new File(['x'], 'big.pdf');
    Object.defineProperty(file, 'size', { value: MAX_UPLOAD_BYTES + 1 });
    expect(isFileTooLarge(file)).toBe(true);
  });

  it('accepts files at or under the limit', () => {
    const file = new File(['x'], 'ok.pdf');
    Object.defineProperty(file, 'size', { value: MAX_UPLOAD_BYTES });
    expect(isFileTooLarge(file)).toBe(false);
  });
});

/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 保留中の microtask（fetch / .json() chain）と React 更新をフラッシュする。 */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** fake timer を act 内で進め、polling ループの 1 ステップを駆動する。 */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const RESULT_FIXTURE = {
  purpose: 'テスト用途',
  generatedAt: '2026-06-02T00:00:00.000Z',
  sourceDocumentsReviewed: 4,
  included: [],
  excluded: [],
  safetyExcluded: [],
  missing: [],
  humanReviewQuestions: [],
  markdown: '# Context Package\n\n生成済み',
  budgetDroppedDocuments: [],
  counts: {
    included: 0,
    excluded: 0,
    safetyExcluded: 0,
    missing: 0,
    humanReviewQuestions: 0,
  },
};

async function loadForm(asyncEnabled: boolean) {
  vi.resetModules();
  if (asyncEnabled) {
    process.env.NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED = 'true';
  } else {
    delete process.env.NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED;
  }
  return (await import('../ContextPackageForm')).ContextPackageForm;
}

function submit() {
  fireEvent.change(screen.getByLabelText('Purpose（目的）'), {
    target: { value: 'テスト用途' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Context Package を生成/ }));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED;
});

describe('ContextPackageForm async polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('async 有効時: 202 → status ポーリング → succeeded で result を表示する', async () => {
    let statusCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/context-package') {
        return Promise.resolve(
          jsonResponse(202, {
            jobId: 'job-1',
            status: 'queued',
            statusUrl: '/api/context-package/jobs/job-1',
            resultUrl: '/api/context-package/jobs/job-1/result',
            reason: 'sync_budget_exceeded',
          }),
        );
      }
      if (url === '/api/context-package/jobs/job-1') {
        statusCalls += 1;
        return Promise.resolve(
          jsonResponse(200, {
            jobId: 'job-1',
            status: statusCalls === 1 ? 'running' : 'succeeded',
          }),
        );
      }
      if (url === '/api/context-package/jobs/job-1/result') {
        return Promise.resolve(jsonResponse(200, RESULT_FIXTURE));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const ContextPackageForm = await loadForm(true);
    render(<ContextPackageForm />);
    submit();

    // POST を解決して polling 開始（最初の setTimeout 待ちへ）。
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/context-package',
      expect.objectContaining({ method: 'POST' }),
    );
    // auto を送っていること。
    const postBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(postBody.mode).toBe('auto');
    expect(screen.getByRole('status')).toBeTruthy();
    expect(
      (screen.getByLabelText('Purpose（目的）') as HTMLTextAreaElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText('対象 Doc IDs（任意）') as HTMLTextAreaElement)
        .disabled,
    ).toBe(true);

    // 1回目 status = running、2回目 = succeeded → result fetch。
    await advance(3000);
    await advance(3000);
    await flush();

    expect(screen.getByText('Markdown preview')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/context-package/jobs/job-1/result',
    );
  });

  it('async 無効時（既定）: mode を送らず同期 200 を表示する', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(jsonResponse(200, RESULT_FIXTURE)),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const ContextPackageForm = await loadForm(false);
    render(<ContextPackageForm />);
    submit();

    await flush();

    const postBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(postBody.mode).toBeUndefined();
    expect(screen.getByText('Markdown preview')).toBeTruthy();
  });
});

/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CANDIDATES_FIXTURE = {
  candidates: [
    {
      docId: 'doc-include',
      fileName: '給与計算チェックリスト.csv',
      documentType: '表',
      businessDomain: '給与計算',
      sensitivity: 'Internal',
      freshness: 'current',
      isAuthoritativeCandidate: true,
      status: 'curated',
      score: 0.82,
      recommendation: 'include',
      matchReason: '給与計算に関連',
    },
    {
      docId: 'doc-exclude',
      fileName: '顧問契約書.pdf',
      documentType: '契約書',
      businessDomain: '顧問契約管理',
      sensitivity: 'Restricted',
      freshness: 'current',
      isAuthoritativeCandidate: true,
      status: 'restricted',
      score: 0.1,
      recommendation: 'exclude',
      reasonLabel: 'Restricted 情報',
    },
    {
      docId: 'doc-review',
      fileName: '給与マニュアル旧版.pdf',
      documentType: 'マニュアル',
      businessDomain: '給与計算',
      sensitivity: 'Internal',
      freshness: 'superseded_candidate',
      isAuthoritativeCandidate: false,
      status: 'curated',
      score: 0.55,
      recommendation: 'needs_review',
      reasonLabel: '古い／上書き候補',
    },
  ],
  missingHints: ['給与計算領域に現行版の正本候補文書がありません'],
  inventoryScanned: 47,
};

const RESULT_FIXTURE = {
  purpose: 'テスト用途',
  generatedAt: '2026-06-02T00:00:00.000Z',
  sourceDocumentsReviewed: 1,
  included: [],
  excluded: [],
  safetyExcluded: [],
  missing: [],
  humanReviewQuestions: [],
  markdown: '# done',
  sourceBundle: {
    files: [
      {
        fileName: '00-CONTEXT-PACKAGE-GUIDE.md',
        content: '# Guide\n\nIncluded source files are separate.',
        contentType: 'text/markdown',
        role: 'guide',
      },
      {
        fileName: '給与計算チェックリスト.csv',
        originalFileName: '給与計算チェックリスト.csv',
        content: '項目,説明\n給与,月次給与計算',
        contentType: 'text/csv',
        role: 'included-source',
      },
    ],
  },
  budgetDroppedDocuments: [],
  counts: {
    included: 0,
    excluded: 0,
    safetyExcluded: 0,
    missing: 0,
    humanReviewQuestions: 0,
  },
};

function routeFetch(url: string, init?: RequestInit): Promise<Response> {
  if (url === '/api/context-package/candidates') {
    return Promise.resolve(jsonResponse(200, CANDIDATES_FIXTURE));
  }
  if (url === '/api/context-package') {
    return Promise.resolve(jsonResponse(200, RESULT_FIXTURE));
  }
  throw new Error(`unexpected fetch: ${url}`);
}

async function loadForm() {
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED;
  return (await import('../ContextPackageForm')).ContextPackageForm;
}

async function fetchCandidatesAndSubmit() {
  fireEvent.change(screen.getByLabelText('Purpose（目的）'), {
    target: { value: 'テスト用途' },
  });
  fireEvent.click(screen.getByRole('button', { name: '候補を表示' }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: /Context Package を生成/ }));
  await flush();
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ContextPackageForm candidate selection', () => {
  it('generate is disabled until candidates are fetched', async () => {
    const fetchMock = vi.fn(routeFetch);
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const ContextPackageForm = await loadForm();
    render(<ContextPackageForm />);

    fireEvent.change(screen.getByLabelText('Purpose（目的）'), {
      target: { value: 'テスト用途' },
    });

    const generateBtn = screen.getByRole('button', {
      name: /Context Package を生成/,
    }) as HTMLButtonElement;
    expect(generateBtn.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '候補を表示' }));
    await flush();

    expect(generateBtn.disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/context-package/candidates',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('pre-checks include, disables exclude, and leaves needs_review unchecked', async () => {
    vi.stubGlobal('fetch', vi.fn(routeFetch) as unknown as typeof fetch);
    const ContextPackageForm = await loadForm();
    render(<ContextPackageForm />);

    fireEvent.change(screen.getByLabelText('Purpose（目的）'), {
      target: { value: 'テスト用途' },
    });
    fireEvent.click(screen.getByRole('button', { name: '候補を表示' }));
    await flush();

    const panel = screen.getByTestId('cp-candidate-selection');
    const include = within(panel).getByLabelText(
      '給与計算チェックリスト.csv を Context Package に含める',
    ) as HTMLInputElement;
    const exclude = within(panel).getByLabelText(
      '顧問契約書.pdf を Context Package に含める',
    ) as HTMLInputElement;
    const review = within(panel).getByLabelText(
      '給与マニュアル旧版.pdf を Context Package に含める',
    ) as HTMLInputElement;

    expect(include.checked).toBe(true);
    expect(exclude.disabled).toBe(true);
    expect(exclude.checked).toBe(false);
    expect(review.checked).toBe(false);
    const safety = screen.getByTestId('cp-safety-review');
    expect(safety).toBeTruthy();
    expect(within(safety).getByText('Restricted 情報')).toBeTruthy();
    expect(within(safety).getByText('古い／上書き候補')).toBeTruthy();
    expect(screen.getByTestId('cp-safety-missing')).toBeTruthy();
    expect(
      screen.getByText('給与計算領域に現行版の正本候補文書がありません'),
    ).toBeTruthy();
  });

  it('invalidates selection when purpose changes and disables generate', async () => {
    vi.stubGlobal('fetch', vi.fn(routeFetch) as unknown as typeof fetch);
    const ContextPackageForm = await loadForm();
    render(<ContextPackageForm />);

    const purpose = screen.getByLabelText('Purpose（目的）');
    fireEvent.change(purpose, { target: { value: 'テスト用途' } });
    fireEvent.click(screen.getByRole('button', { name: '候補を表示' }));
    await flush();

    expect(screen.getByTestId('cp-candidate-selection')).toBeTruthy();

    fireEvent.change(purpose, { target: { value: 'テスト用途（変更）' } });
    expect(screen.queryByTestId('cp-candidate-selection')).toBeNull();
    expect(
      (screen.getByRole('button', {
        name: /Context Package を生成/,
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('requires preview acknowledgement when selection has warnings', async () => {
    vi.stubGlobal('fetch', vi.fn(routeFetch) as unknown as typeof fetch);
    const ContextPackageForm = await loadForm();
    render(<ContextPackageForm />);

    fireEvent.change(screen.getByLabelText('Purpose（目的）'), {
      target: { value: 'テスト用途' },
    });
    fireEvent.click(screen.getByRole('button', { name: '候補を表示' }));
    await flush();

    const generateBtn = screen.getByRole('button', {
      name: /Context Package を生成/,
    }) as HTMLButtonElement;
    expect(generateBtn.disabled).toBe(false);

    fireEvent.click(
      within(screen.getByTestId('cp-candidate-selection')).getByLabelText(
        '給与マニュアル旧版.pdf を Context Package に含める',
      ),
    );
    expect(generateBtn.disabled).toBe(true);
    expect(screen.getByTestId('cp-preview-ack')).toBeTruthy();

    const ack = screen.getByTestId('cp-preview-ack').querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    fireEvent.click(ack);
    expect(generateBtn.disabled).toBe(false);
  });

  it('allows generate without acknowledgement when only safe includes are selected', async () => {
    vi.stubGlobal('fetch', vi.fn(routeFetch) as unknown as typeof fetch);
    const ContextPackageForm = await loadForm();
    render(<ContextPackageForm />);

    fireEvent.change(screen.getByLabelText('Purpose（目的）'), {
      target: { value: 'テスト用途' },
    });
    fireEvent.click(screen.getByRole('button', { name: '候補を表示' }));
    await flush();

    expect(screen.getByTestId('cp-preview-ack-optional')).toBeTruthy();
    expect(
      (screen.getByRole('button', {
        name: /Context Package を生成/,
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('posts selected docIds from checkboxes to context-package', async () => {
    const fetchMock = vi.fn(routeFetch);
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const ContextPackageForm = await loadForm();
    render(<ContextPackageForm />);
    await fetchCandidatesAndSubmit();

    const contextPackageCall = fetchMock.mock.calls.find(
      (c) => c[0] === '/api/context-package',
    );
    expect(contextPackageCall).toBeTruthy();
    const body = JSON.parse((contextPackageCall![1] as RequestInit).body as string);
    expect(body.docIds).toEqual(['doc-include']);
    expect(body.purpose).toBe('テスト用途');
  });

  it('suppresses immediate double-submit while generation is in flight', async () => {
    let resolveContextPackage: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/context-package/candidates') {
        return Promise.resolve(jsonResponse(200, CANDIDATES_FIXTURE));
      }
      if (url === '/api/context-package') {
        return new Promise<Response>((resolve) => {
          resolveContextPackage = resolve;
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const ContextPackageForm = await loadForm();
    const { container } = render(<ContextPackageForm />);

    fireEvent.change(screen.getByLabelText('Purpose（目的）'), {
      target: { value: 'テスト用途' },
    });
    fireEvent.click(screen.getByRole('button', { name: '候補を表示' }));
    await flush();

    const form = container.querySelector('form');
    expect(form).toBeTruthy();
    act(() => {
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    const contextPackageCalls = fetchMock.mock.calls.filter(
      (c) => c[0] === '/api/context-package',
    );
    expect(contextPackageCalls).toHaveLength(1);

    resolveContextPackage?.(jsonResponse(200, RESULT_FIXTURE));
    await flush();
  });

  it('allows submitting again after generation settles', async () => {
    const pendingResponses: ((response: Response) => void)[] = [];
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/context-package/candidates') {
        return Promise.resolve(jsonResponse(200, CANDIDATES_FIXTURE));
      }
      if (url === '/api/context-package') {
        return new Promise<Response>((resolve) => {
          pendingResponses.push(resolve);
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const ContextPackageForm = await loadForm();
    render(<ContextPackageForm />);

    fireEvent.change(screen.getByLabelText('Purpose（目的）'), {
      target: { value: 'テスト用途' },
    });
    fireEvent.click(screen.getByRole('button', { name: '候補を表示' }));
    await flush();

    const generateButton = screen.getByRole('button', {
      name: /Context Package を生成/,
    });
    fireEvent.click(generateButton);
    expect(
      fetchMock.mock.calls.filter((c) => c[0] === '/api/context-package'),
    ).toHaveLength(1);

    pendingResponses.shift()?.(jsonResponse(200, RESULT_FIXTURE));
    await flush();

    fireEvent.click(generateButton);
    expect(
      fetchMock.mock.calls.filter((c) => c[0] === '/api/context-package'),
    ).toHaveLength(2);

    pendingResponses.shift()?.(jsonResponse(200, RESULT_FIXTURE));
    await flush();
  });

  it('downloads the source bundle as a NotebookLM zip', async () => {
    const fetchMock = vi.fn(routeFetch);
    const createObjectURL = vi.fn((object: Blob | MediaSource) => {
      void object;
      return 'blob:source-bundle';
    });
    const revokeObjectURL = vi.fn((url: string) => {
      void url;
    });
    const OriginalURL = URL;

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    vi.stubGlobal(
      'URL',
      class extends OriginalURL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
      },
    );
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    const ContextPackageForm = await loadForm();
    render(<ContextPackageForm />);
    await fetchCandidatesAndSubmit();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'NotebookLM 用 bundle をダウンロード',
      }),
    );

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/zip');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('advanced docIds override checkbox selection', async () => {
    const fetchMock = vi.fn(routeFetch);
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const ContextPackageForm = await loadForm();
    render(<ContextPackageForm />);

    fireEvent.change(screen.getByLabelText('Purpose（目的）'), {
      target: { value: 'テスト用途' },
    });
    fireEvent.click(screen.getByRole('button', { name: '候補を表示' }));
    await flush();

    fireEvent.click(screen.getByText('上級者向け: Doc ID を直接指定'));
    fireEvent.change(screen.getByLabelText('対象 Doc IDs（上級者向け）'), {
      target: { value: 'doc-manual-1' },
    });
    await flush();

    const ack = screen.getByTestId('cp-preview-ack').querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    fireEvent.click(ack);

    fireEvent.click(screen.getByRole('button', { name: /Context Package を生成/ }));
    await flush();

    const contextPackageCall = fetchMock.mock.calls.find(
      (c) => c[0] === '/api/context-package',
    );
    const body = JSON.parse((contextPackageCall![1] as RequestInit).body as string);
    expect(body.docIds).toEqual(['doc-manual-1']);
  });
});

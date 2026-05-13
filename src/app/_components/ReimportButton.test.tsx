/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReimportButton } from './ReimportButton';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ReimportButton', () => {
  it('maps API error codes to human-readable copy', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, { error: 'sheet_not_shared' }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    render(<ReimportButton urlOrFileId="sheet-file-id" />);

    fireEvent.click(screen.getByRole('button', { name: 'Drive から再取り込み' }));

    await waitFor(() =>
      expect(
        screen.getByText(
          /Drive の共有設定を確認してください。サービスアカウントに閲覧権限が必要です。/
        )
      ).toBeTruthy()
    );
  });
});

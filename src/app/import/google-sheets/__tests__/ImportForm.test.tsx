/* @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportForm } from '../ImportForm';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function submitWithErrorResponse(
  status: number,
  body: Record<string, string>,
  serviceAccountEmail = 'panel@example.iam.gserviceaccount.com'
) {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      jsonResponse(200, {
        serviceAccountEmail,
      })
    )
    .mockResolvedValueOnce(jsonResponse(status, body));
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

  render(<ImportForm />);

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/import/google-sheets/service-account-email'
    )
  );

  fireEvent.change(
    screen.getByRole('textbox', {
      name: 'Google Sheets の URL または fileId',
    }),
    {
      target: {
        value: 'https://docs.google.com/spreadsheets/d/test-sheet-id/edit#gid=0',
      },
    }
  );

  fireEvent.click(screen.getByRole('button', { name: '取り込む' }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/import/google-sheets',
      expect.objectContaining({
        method: 'POST',
      })
    )
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ImportForm error handling', () => {
  it('shows share_error panel and service account email for sheet_not_shared', async () => {
    await submitWithErrorResponse(403, {
      error: 'sheet_not_shared',
      serviceAccountEmail: 'sa@example.iam.gserviceaccount.com',
    });

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('共有が必要です（sheet_not_shared）')).toBeTruthy();
    expect(within(alert).getByText('sa@example.iam.gserviceaccount.com')).toBeTruthy();
  });

  it('shows regular error banner with API error identifier', async () => {
    await submitWithErrorResponse(502, {
      error: 'drive_export_failed',
    });

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText('drive_export_failed', { selector: 'strong' })
    ).toBeTruthy();
  });

  it('shows docId in regular error banner when provided', async () => {
    await submitWithErrorResponse(500, {
      error: 'curator_failed',
      docId: 'abc',
    });

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText('curator_failed', { selector: 'strong' })
    ).toBeTruthy();
    expect(within(alert).getByText('abc')).toBeTruthy();
  });
});

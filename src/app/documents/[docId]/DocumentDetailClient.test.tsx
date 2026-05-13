/* @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentDetailClient } from './DocumentDetailClient';
import type { InventoryDocument } from '../../../lib/inventory';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const baseDoc: InventoryDocument = {
  id: 'doc-1',
  fileName: 'sheet.xlsx',
  status: 'curated',
  documentType: 'その他',
  businessDomain: 'その他',
  sensitivity: 'Internal',
  freshness: 'current',
  isAuthoritativeCandidate: false,
  aiUsePolicy: 'direct',
  rationale: 'r',
  sensitivitySource: 'curator',
  sourceKind: 'google_workspace',
  externalSourceFileId: 'sheet-file-id',
  externalSourceWebViewLink: 'https://docs.google.com/spreadsheets/d/sheet-file-id/edit',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DocumentDetailClient freshness badge', () => {
  it('renders "最新" when Drive modifiedTime matches saved', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          isStale: false,
          savedModifiedTime: '2026-05-10T01:02:03.000Z',
          latestModifiedTime: '2026-05-10T01:02:03.000Z',
        })
      )
    );

    render(<DocumentDetailClient doc={baseDoc} />);

    await waitFor(() =>
      expect(screen.getByText(/✓ 最新/)).toBeTruthy()
    );
  });

  it('renders "Drive 上で更新されています" when isStale=true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          isStale: true,
          savedModifiedTime: '2026-05-09T00:00:00.000Z',
          latestModifiedTime: '2026-05-10T01:02:03.000Z',
        })
      )
    );

    render(<DocumentDetailClient doc={baseDoc} />);

    await waitFor(() =>
      expect(screen.getByText(/Drive 上で更新されています/)).toBeTruthy()
    );
  });

  it('renders inaccessible badge when API returns 200 + code=drive_forbidden', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          isStale: false,
          savedModifiedTime: '2026-05-10T01:02:03.000Z',
          latestModifiedTime: '',
          code: 'drive_forbidden',
        })
      )
    );

    render(<DocumentDetailClient doc={baseDoc} />);

    await waitFor(() =>
      expect(
        screen.getByText(/Drive へのアクセス権がありません/)
      ).toBeTruthy()
    );
  });

  it('renders inaccessible badge when API returns 200 + code=drive_not_found', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          isStale: false,
          savedModifiedTime: '2026-05-10T01:02:03.000Z',
          latestModifiedTime: '',
          code: 'drive_not_found',
        })
      )
    );

    render(<DocumentDetailClient doc={baseDoc} />);

    await waitFor(() =>
      expect(
        screen.getByText(/Drive 上のファイルが見つかりません/)
      ).toBeTruthy()
    );
  });

  it('renders unknown badge when API returns 200 + code=latest_modified_time_unknown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          isStale: false,
          savedModifiedTime: '2026-05-10T01:02:03.000Z',
          latestModifiedTime: '',
          code: 'latest_modified_time_unknown',
        })
      )
    );

    render(<DocumentDetailClient doc={baseDoc} />);

    await waitFor(() =>
      expect(screen.getByText(/鮮度：不明/)).toBeTruthy()
    );
  });
});

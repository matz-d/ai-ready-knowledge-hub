/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreGenerationPreviewPanel } from '../PreGenerationPreviewPanel';
import type { PreGenerationPreview as PreviewModel } from '../preGenerationPreview';

const previewFixture: PreviewModel = {
  willSend: [
    {
      docId: 'doc-a',
      fileName: '給与.csv',
      sensitivity: 'Internal',
      status: 'curated',
      recommendation: 'include',
      disposition: 'will_send',
      note: 'AI に渡す予定です',
    },
  ],
  autoExcluded: [
    {
      docId: 'doc-r',
      fileName: '契約.pdf',
      sensitivity: 'Restricted',
      status: 'restricted',
      recommendation: 'exclude',
      disposition: 'auto_excluded',
      note: 'Restricted のため安全装置が自動で除外します（AI には渡りません）',
      reasonCode: 'restricted_sensitivity',
    },
  ],
  warnings: [
    {
      docId: 'doc-s',
      fileName: '旧版.pdf',
      sensitivity: 'Internal',
      status: 'curated',
      recommendation: 'needs_review',
      disposition: 'stale_warning',
      note: '古い／上書き候補です。内容を確認してから生成してください',
      reasonCode: 'superseded_or_stale',
    },
  ],
  unknownDocIds: ['ghost-doc'],
  counts: { willSend: 1, autoExcluded: 1, warnings: 1, unknownDocIds: 1 },
  hasAutoExcluded: true,
  hasWarnings: true,
};

afterEach(() => {
  cleanup();
});

describe('PreGenerationPreviewPanel', () => {
  it('renders projection buckets and requires acknowledgement checkbox', () => {
    const onAck = vi.fn();
    render(
      <PreGenerationPreviewPanel
        preview={previewFixture}
        acknowledged={false}
        onAcknowledgedChange={onAck}
      />,
    );

    const panel = screen.getByTestId('cp-pre-generation-preview');
    expect(within(panel).getByText('AI へ渡す予定')).toBeTruthy();
    expect(within(panel).getByText('自動除外（AI には渡らない）')).toBeTruthy();
    expect(within(panel).getByText('AI に渡す予定です')).toBeTruthy();
    expect(
      within(panel).getByText(
        'Restricted のため安全装置が自動で除外します（AI には渡りません）',
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('cp-preview-unknown')).toBeTruthy();
    expect(screen.getByTestId('cp-preview-ack')).toBeTruthy();
    expect(screen.queryByTestId('cp-preview-ack-optional')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(onAck).toHaveBeenCalledWith(true);
  });

  it('shows optional message when acknowledgement is not required', () => {
    const cleanPreview: PreviewModel = {
      willSend: previewFixture.willSend,
      autoExcluded: [],
      warnings: [],
      unknownDocIds: [],
      counts: { willSend: 1, autoExcluded: 0, warnings: 0, unknownDocIds: 0 },
      hasAutoExcluded: false,
      hasWarnings: false,
    };

    render(
      <PreGenerationPreviewPanel
        preview={cleanPreview}
        acknowledged={false}
        onAcknowledgedChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('cp-preview-ack-optional')).toBeTruthy();
    expect(screen.queryByTestId('cp-preview-ack')).toBeNull();
  });
});

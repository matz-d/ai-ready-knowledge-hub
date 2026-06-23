import Link from 'next/link';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import './styles.css';
import { wasPromotedByMasker } from '../agents/masker/upgrade';
import { adaptW1SnapshotEntries, type InventoryDocument } from '../lib/inventory';
import {
  countDocumentsByStatusFromFirestore,
  listInventoryDocumentsFromFirestore,
} from '../lib/inventoryFirestoreAdapter';
import {
  AI_USE_POLICY_LABELS,
  DOCUMENT_STATUS_LABELS,
  SENSITIVITY_LABELS,
} from '../lib/displayLabels';
import {
  aggregatePipelineDocumentCounts,
  aiReadyDocumentCount,
  protectedDocumentCount,
  readyPercentFromCounts,
  totalDocumentCount,
  type PipelineStatusCounts,
} from '../lib/pipelineStatusCounts';
import type { Sensitivity } from '../agents/curator/schema';
import { ReimportButton } from './_components/ReimportButton';
import { PipelineFunnel } from './_components/PipelineFunnel';

export const dynamic = 'force-dynamic';

type InventorySectionState = {
  source: 'firestore' | 'w1-fallback';
  documents: InventoryDocument[];
  kicker: string;
  note: string;
  fallbackReason?: string;
};

function buildInventoryState(args: {
  source: InventorySectionState['source'];
  documents: InventoryDocument[];
  purpose: string;
  kicker: string;
  note: string;
  fallbackReason?: string;
}): InventorySectionState {
  return args;
}

function readW1InventoryFallback(
  fallbackReason: string
): InventorySectionState | null {
  try {
    const snapshotPath = join(
      process.cwd(),
      'docs/archive/w1-artifacts/inventory.snapshot.json'
    );
    const raw = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
    const documents = adaptW1SnapshotEntries(raw);
    return buildInventoryState({
      source: 'w1-fallback',
      documents,
      purpose:
        'Fallback demo: W1 snapshot adapted from docs/archive/w1-artifacts because Firestore inventory was unavailable',
      kicker: 'デモ表示',
      note:
        '実データに接続できなかったため、デモ用スナップショットを表示しています。実際の文書とは同期していません。',
      fallbackReason,
    });
  } catch {
    return null;
  }
}

async function readInventorySection(): Promise<InventorySectionState | null> {
  try {
    const documents = await listInventoryDocumentsFromFirestore();
    return buildInventoryState({
      source: 'firestore',
      documents,
      purpose: 'Firestore documents inventory - effective metadata for AI-ready review',
      kicker: 'ライブ一覧',
      note:
        'アップロード済みの文書を、Curator の分類と Masker の判定結果つきで一覧表示しています。',
    });
  } catch (e) {
    const fallbackReason = e instanceof Error ? e.message : String(e);
    console.error('[inventory] Firestore inventory read failed', e);
    return readW1InventoryFallback(fallbackReason);
  }
}

async function readPipelineStatusCounts(): Promise<PipelineStatusCounts | null> {
  try {
    return await countDocumentsByStatusFromFirestore();
  } catch (e) {
    console.error('[inventory] pipeline status count read failed', e);
    return null;
  }
}

function sensitivityPillClass(sensitivity: Sensitivity): string {
  switch (sensitivity) {
    case 'Restricted':
      return 'sensitivity-pill sensitivity-restricted';
    case 'Confidential':
      return 'sensitivity-pill sensitivity-confidential';
    case 'Internal':
      return 'sensitivity-pill sensitivity-internal';
    case 'Public':
      return 'sensitivity-pill sensitivity-public';
  }
}

function statusBadgeClass(status: InventoryDocument['status']): string {
  const suffix = status.replace('_', '-');
  return `document-flow-status-badge document-flow-status-badge--${suffix}`;
}

export default async function Home() {
  const [inventoryState, liveStatusCounts] = await Promise.all([
    readInventorySection(),
    readPipelineStatusCounts(),
  ]);
  const documents = inventoryState?.documents ?? [];

  // KPI は live 件数を優先する。ただし W1 fallback 一覧と Firestore の live 件数は混ぜない。
  const canUseLiveCounts =
    liveStatusCounts !== null && inventoryState?.source !== 'w1-fallback';
  const effectiveCounts =
    canUseLiveCounts
      ? liveStatusCounts
      : aggregatePipelineDocumentCounts(documents);
  const totalDocuments = totalDocumentCount(effectiveCounts);
  const aiReadyCount = aiReadyDocumentCount(effectiveCounts);
  const protectedCount = protectedDocumentCount(effectiveCounts);
  const maskedCount = effectiveCounts.ai_safe;
  const readyPercent = readyPercentFromCounts(effectiveCounts);

  const protectedDocuments = documents.filter(
    (doc) => doc.status === 'restricted' || doc.status === 'blocked'
  );

  return (
    <main className="page-shell dashboard-shell">
      <section className="dashboard-topbar" aria-label="ワークスペース">
        <div>
          <p className="workspace-label">ワークスペース: サンプル会計事務所</p>
          <h1 className="dashboard-title">ダッシュボード</h1>
          <p className="dashboard-lead">
            散らばった社内文書を分類・マスキングし、目的別に AI へ渡せる Context
            Package に変換します。
          </p>
        </div>
        <div className="dashboard-actions">
          <Link className="secondary-action" href="/import/google-sheets">
            Google Sheets 連携
          </Link>
          <Link className="primary-action" href="/upload">
            アップロード
          </Link>
        </div>
      </section>

      <PipelineFunnel
        initialCounts={canUseLiveCounts ? liveStatusCounts : null}
        initialReadyPercent={readyPercent}
      />

      <section className="dashboard-kpi-grid" aria-label="文書の状態サマリー">
        <div className="dashboard-kpi">
          <span>登録文書</span>
          <strong>{totalDocuments}</strong>
          <p>アップロード・取り込み済みの文書の合計</p>
        </div>
        <div className="dashboard-kpi">
          <span>AI利用可</span>
          <strong>{aiReadyCount}</strong>
          <p>そのまま、またはマスキング済みで AI に渡せる文書</p>
        </div>
        <div className="dashboard-kpi">
          <span>マスキング実施</span>
          <strong>{maskedCount}</strong>
          <p>Masker が個人情報を処理して利用可能化した文書</p>
        </div>
        <div className="dashboard-kpi dashboard-kpi--warn">
          <span>保護中（AI除外）</span>
          <strong>{protectedCount}</strong>
          <p>機密のため AI 利用から保護されている文書</p>
        </div>
      </section>

      {inventoryState ? (
        <section
          className="dashboard-grid inventory-demo-section"
          aria-labelledby="inventory-demo-heading"
        >
          <div className="inventory-workbench">
            <div className="panel-heading-row">
              <div>
                <p className="chapter-kicker">{inventoryState.kicker}</p>
                <h2 id="inventory-demo-heading">文書一覧</h2>
              </div>
              <Link className="secondary-action" href="/context-package">
                Context Packageへ
              </Link>
            </div>

            <p className="inventory-demo-note">
              {inventoryState.note}
              {inventoryState.fallbackReason ? (
                <>
                  <br />
                  <span>接続エラー: {inventoryState.fallbackReason}</span>
                </>
              ) : null}
            </p>

            {documents.length > 0 ? (
              <div className="inventory-table-wrap dashboard-table-wrap">
                <table className="inventory-table dashboard-table">
                  <thead>
                    <tr>
                      <th>ドキュメント名</th>
                      <th>業務領域</th>
                      <th>機密度</th>
                      <th>AI利用方針</th>
                      <th>状態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.slice(0, 8).map((doc) => (
                      <tr
                        className={wasPromotedByMasker(doc) ? 'promoted-row' : ''}
                        key={doc.id}
                      >
                        <td>
                          <Link
                            href={`/documents/${doc.id}`}
                            className="inventory-card-title-link"
                          >
                            {doc.fileName}
                          </Link>
                          <span>
                            {doc.documentType} · {doc.businessDomain}
                          </span>
                          {wasPromotedByMasker(doc) ? (
                            <span className="promotion-note">
                              マスキングで利用可能化
                            </span>
                          ) : null}
                        </td>
                        <td>{doc.businessDomain}</td>
                        <td>
                          <span
                            className={sensitivityPillClass(doc.sensitivity)}
                            title={`機密度: ${doc.sensitivity}`}
                          >
                            {SENSITIVITY_LABELS[doc.sensitivity]}
                          </span>
                        </td>
                        <td className="policy-text">
                          {AI_USE_POLICY_LABELS[doc.aiUsePolicy]}
                        </td>
                        <td>
                          <span className={statusBadgeClass(doc.status)}>
                            {DOCUMENT_STATUS_LABELS[doc.status]}
                          </span>
                          {doc.sourceKind === 'google_workspace' &&
                          (doc.externalSourceWebViewLink ??
                            doc.externalSourceFileId) ? (
                            <ReimportButton
                              urlOrFileId={
                                doc.externalSourceWebViewLink ??
                                doc.externalSourceFileId!
                              }
                              className="inventory-card-reimport"
                            />
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="inventory-empty-state">
                <h3>文書がまだ登録されていません</h3>
                <p>
                  アップロードすると、分類とマスキングの結果がここに表示されます。まずは{' '}
                  <Link href="/upload">アップロード</Link> から始めてください。
                </p>
              </div>
            )}
          </div>

          <aside className="review-column" aria-label="保護中の文書とContext Package">
            <section className="side-panel">
              <div className="panel-heading-row">
                <h2>保護中の文書</h2>
                <Link href="/context-package">すべて見る</Link>
              </div>
              <div className="review-list">
                {protectedDocuments.slice(0, 3).map((doc) => (
                  <article key={doc.id} className="review-item">
                    <span
                      className={sensitivityPillClass(doc.sensitivity)}
                      title={`機密度: ${doc.sensitivity}`}
                    >
                      {SENSITIVITY_LABELS[doc.sensitivity]}
                    </span>
                    <strong>{doc.fileName}</strong>
                    <small>
                      {doc.businessDomain} · {AI_USE_POLICY_LABELS[doc.aiUsePolicy]}
                    </small>
                  </article>
                ))}
                {protectedDocuments.length === 0 ? (
                  <p className="empty-side-note">
                    保護対象の文書はありません。
                  </p>
                ) : null}
              </div>
            </section>

            <section className="side-panel package-panel">
              <div className="panel-heading-row">
                <h2>Context Package</h2>
              </div>
              <p className="package-panel-note">
                目的を入力すると、AI利用可の文書から「使える・除外・足りない・確認質問」を整理した
                Context Package を生成します。
              </p>
              <Link className="primary-action package-action" href="/context-package">
                Context Packageを生成
              </Link>
            </section>
          </aside>
        </section>
      ) : null}
    </main>
  );
}

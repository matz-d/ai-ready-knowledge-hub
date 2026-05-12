import Link from 'next/link';
import { notFound } from 'next/navigation';
import '../../styles.css';
import { getFirestoreClient } from '../../../lib/firestore';
import { parseFirestoreDocumentData } from '../../../lib/parseFirestoreDocumentData';
import {
  adaptFirestoreDocumentToInventory,
} from '../../../lib/inventoryFirestoreAdapter';
import { wasPromotedByMasker } from '../../../agents/masker/upgrade';
import type { InventoryDocument } from '../../../lib/inventory';
import { DocumentDetailClient } from './DocumentDetailClient';

export const dynamic = 'force-dynamic';

async function fetchDocument(docId: string): Promise<InventoryDocument | null> {
  try {
    const db = getFirestoreClient();
    const snapshot = await db.collection('documents').doc(docId).get();
    if (!snapshot.exists) return null;
    const parsed = parseFirestoreDocumentData({
      id: snapshot.id,
      ...snapshot.data(),
    });
    return adaptFirestoreDocumentToInventory(snapshot.id, parsed);
  } catch {
    return null;
  }
}

function sensitivityPillClass(sensitivity: string): string {
  const key = sensitivity.toLowerCase();
  return `sensitivity-pill sensitivity-${key}`;
}

function statusBadgeClass(status: InventoryDocument['status']): string {
  const suffix = status.replace('_', '-');
  return `document-flow-status-badge document-flow-status-badge--${suffix}`;
}

type Props = { params: Promise<{ docId: string }> };

export default async function DocumentDetailPage({ params }: Props) {
  const { docId } = await params;
  const doc = await fetchDocument(docId);

  if (!doc) {
    notFound();
  }

  return (
    <main className="page-shell">
      <nav className="doc-detail-breadcrumb">
        <Link href="/">← Inventory 一覧</Link>
      </nav>

      <article className="doc-detail-article">
        <header className="doc-detail-header">
          <div className="doc-detail-header__meta">
            <span
              className={sensitivityPillClass(doc.sensitivity)}
              title="sensitivity"
            >
              {doc.sensitivity}
            </span>
            <span className={statusBadgeClass(doc.status)}>{doc.status}</span>
          </div>
          <h1 className="doc-detail-title">{doc.fileName}</h1>
          <p className="doc-detail-sub">
            {doc.documentType} · {doc.businessDomain}
          </p>
        </header>

        {/* Workspace freshness badge + re-import button (client-side) */}
        <DocumentDetailClient doc={doc} />

        <section className="doc-detail-section">
          <h2>分類情報</h2>
          <dl className="doc-detail-dl">
            <div>
              <dt>Document type</dt>
              <dd>{doc.documentType}</dd>
            </div>
            <div>
              <dt>Business domain</dt>
              <dd>{doc.businessDomain}</dd>
            </div>
            <div>
              <dt>Sensitivity</dt>
              <dd>{doc.sensitivity}</dd>
            </div>
            <div>
              <dt>Freshness</dt>
              <dd>{doc.freshness}</dd>
            </div>
            <div>
              <dt>AI policy</dt>
              <dd>{doc.aiUsePolicy}</dd>
            </div>
            <div>
              <dt>Authoritative</dt>
              <dd>{doc.isAuthoritativeCandidate ? 'Yes' : 'No'}</dd>
            </div>
            <div>
              <dt>Sensitivity source</dt>
              <dd>{doc.sensitivitySource}</dd>
            </div>
            {doc.sensitivityReason ? (
              <div>
                <dt>Sensitivity reason</dt>
                <dd>{doc.sensitivityReason}</dd>
              </div>
            ) : null}
            {doc.originalCuratorSensitivity ? (
              <div>
                <dt>Original curator sensitivity</dt>
                <dd>{doc.originalCuratorSensitivity}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        {doc.curator?.rationale ? (
          <section className="doc-detail-section">
            <h2>Curator 判定理由</h2>
            <p className="doc-detail-rationale">{doc.curator.rationale}</p>
          </section>
        ) : null}

        {wasPromotedByMasker(doc) ? (
          <p className="inventory-masker-promo" role="status">
            Masker により Restricted へ格上げ（原本 Curator:{' '}
            {doc.originalCuratorSensitivity ?? '—'}）
          </p>
        ) : null}

        <section className="doc-detail-section">
          <h2>ストレージ情報</h2>
          <dl className="doc-detail-dl">
            <div>
              <dt>Doc ID</dt>
              <dd><code>{doc.id}</code></dd>
            </div>
            {doc.storagePath ? (
              <div>
                <dt>Storage path</dt>
                <dd><code>{doc.storagePath}</code></dd>
              </div>
            ) : null}
            {doc.aiSafeStoragePath ? (
              <div>
                <dt>AI-safe path</dt>
                <dd><code>{doc.aiSafeStoragePath}</code></dd>
              </div>
            ) : null}
            {doc.createdAt ? (
              <div>
                <dt>Created at</dt>
                <dd>{new Date(doc.createdAt).toLocaleString('ja-JP')}</dd>
              </div>
            ) : null}
            {doc.updatedAt ? (
              <div>
                <dt>Updated at</dt>
                <dd>{new Date(doc.updatedAt).toLocaleString('ja-JP')}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        {doc.externalSourceFileId ? (
          <section className="doc-detail-section">
            <h2>Drive ソース情報</h2>
            <dl className="doc-detail-dl">
              <div>
                <dt>File ID</dt>
                <dd><code>{doc.externalSourceFileId}</code></dd>
              </div>
              {doc.externalSourceWebViewLink ? (
                <div>
                  <dt>Drive URL</dt>
                  <dd>
                    <a
                      href={doc.externalSourceWebViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="doc-detail-drive-link"
                    >
                      Drive で開く ↗
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>
        ) : null}
      </article>
    </main>
  );
}

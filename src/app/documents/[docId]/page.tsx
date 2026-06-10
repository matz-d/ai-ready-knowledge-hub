import Link from 'next/link';
import { notFound } from 'next/navigation';
import '../../styles.css';
import { getFirestoreClient } from '../../../lib/firestore';
import { parseFirestoreDocumentSnapshot } from '../../../lib/parseFirestoreDocumentData';
import {
  adaptFirestoreDocumentToInventory,
} from '../../../lib/inventoryFirestoreAdapter';
import { wasPromotedByMasker } from '../../../agents/masker/upgrade';
import {
  AI_USE_POLICY_LABELS,
  DOCUMENT_STATUS_LABELS,
  SENSITIVITY_LABELS,
} from '../../../lib/displayLabels';
import type { InventoryDocument } from '../../../lib/inventory';
import { DocumentDetailClient } from './DocumentDetailClient';

export const dynamic = 'force-dynamic';

async function fetchDocument(docId: string): Promise<InventoryDocument | null> {
  try {
    const db = getFirestoreClient();
    const snapshot = await db.collection('documents').doc(docId).get();
    if (!snapshot.exists) return null;
    const parsed = parseFirestoreDocumentSnapshot(snapshot);
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
              title={`機密度: ${doc.sensitivity}`}
            >
              {SENSITIVITY_LABELS[doc.sensitivity]}
            </span>
            <span className={statusBadgeClass(doc.status)}>
              {DOCUMENT_STATUS_LABELS[doc.status]}
            </span>
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
              <dt>文書種別</dt>
              <dd>{doc.documentType}</dd>
            </div>
            <div>
              <dt>業務領域</dt>
              <dd>{doc.businessDomain}</dd>
            </div>
            <div>
              <dt>機密度</dt>
              <dd>{SENSITIVITY_LABELS[doc.sensitivity]}</dd>
            </div>
            <div>
              <dt>鮮度</dt>
              <dd>{doc.freshness}</dd>
            </div>
            <div>
              <dt>AI利用方針</dt>
              <dd>{AI_USE_POLICY_LABELS[doc.aiUsePolicy]}</dd>
            </div>
            <div>
              <dt>正本候補</dt>
              <dd>{doc.isAuthoritativeCandidate ? 'はい' : 'いいえ'}</dd>
            </div>
            <div>
              <dt>機密度の根拠</dt>
              <dd>{doc.sensitivitySource}</dd>
            </div>
            {doc.sensitivityReason ? (
              <div>
                <dt>機密度判定理由</dt>
                <dd>{doc.sensitivityReason}</dd>
              </div>
            ) : null}
            {doc.originalCuratorSensitivity ? (
              <div>
                <dt>Curator の元判定</dt>
                <dd>{SENSITIVITY_LABELS[doc.originalCuratorSensitivity]}</dd>
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
            Masker により厳重管理へ格上げ（Curator の元判定:{' '}
            {doc.originalCuratorSensitivity
              ? SENSITIVITY_LABELS[doc.originalCuratorSensitivity]
              : '—'}
            ）
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
                <dt>原本保存パス</dt>
                <dd><code>{doc.storagePath}</code></dd>
              </div>
            ) : null}
            {doc.aiSafeStoragePath ? (
              <div>
                <dt>AI利用用パス</dt>
                <dd><code>{doc.aiSafeStoragePath}</code></dd>
              </div>
            ) : null}
            {doc.createdAt ? (
              <div>
                <dt>作成日時</dt>
                <dd>{new Date(doc.createdAt).toLocaleString('ja-JP')}</dd>
              </div>
            ) : null}
            {doc.updatedAt ? (
              <div>
                <dt>更新日時</dt>
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
